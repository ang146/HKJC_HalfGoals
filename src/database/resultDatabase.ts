import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export interface NotificationRecord {
  alert_key: string;
  created_at: string;
  match_id: string;
  odds_type: string | null;
  condition: string | null;
  result: 0 | 1 | null; // SQLite boolean-ish
  message_id: number | null;
}

export type UpsertNotificationOptions = {
  // these fields are required to identify the alert
  matchId: string; // cannot be null
  oddsType: string; // cannot be null
  condition: string; // e.g. "0.5/1.0"

  // optional explicit override
  alertKey?: string;

  // optional updates
  result?: boolean | null;
  messageId?: number | null;

  // optional createdAt override (default now)
  createdAt?: string;
};

export class ResultDatabase {
  private dataDir = path.resolve("data");
  private db: Database.Database;

  // prepared statements (created after tables exist)
  private upsertNotificationStmt!: Database.Statement;
  private getLatestByMatchOddsStmt!: Database.Statement;
  private getByAlertKeyStmt!: Database.Statement;
  private getByResultIsNullStmt!: Database.Statement;
  private updateResultStmt!: Database.Statement;
  private updateMessageIdStmt!: Database.Statement;

  constructor() {
    if (!fs.existsSync(this.dataDir)) fs.mkdirSync(this.dataDir);
    this.db = new Database(path.join(this.dataDir, "app.db"));

    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");

    this.initializeDatabase();
    this.migrateDatabase();
    this.prepareStatements();
  }

  private initializeDatabase() {
    // versions table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS versions (
        version INTEGER PRIMARY KEY,
        created_at TEXT NOT NULL
      );
    `);

    // Ensure there is at least version 0 record (meaning: legacy / no migrations applied)
    const hasAnyVersion = this.db
      .prepare(`SELECT 1 FROM versions LIMIT 1`)
      .get();

    if (!hasAnyVersion) {
      this.db
        .prepare(`INSERT INTO versions (version, created_at) VALUES (?, ?)`)
        .run(0, new Date().toISOString());
    }

    // NOTE: do NOT create notifications table here yet; let migration decide.
  }

  /**
   * Schema migration runner.
   *
   * Current plan:
   * - version 0 -> version 1
   *   1) Create notifications table
   *   2) Copy sent_alerts into notifications (best-effort parse match_id + odds_type from alert_key)
   *   3) Insert version 1 record
   */
  private migrateDatabase() {
    const currentVersionRow = this.db
      .prepare(`SELECT MAX(version) AS v FROM versions`)
      .get() as { v: number | null };

    const currentVersion = currentVersionRow.v ?? 0;

    if (currentVersion >= 1) {
      // Ensure notifications table exists even if someone manually inserted versions
      this.ensureNotificationsTable();
      return;
    }

    if (currentVersion === 0) {
      const tx = this.db.transaction(() => {
        this.ensureNotificationsTable();

        const checkIfSentAlertsTableExists = this.db
          .prepare(
            `SELECT name FROM sqlite_master WHERE type='table' AND name='sent_alerts'`,
          )
          .get();

        if (!checkIfSentAlertsTableExists) {
          // If sent_alerts doesn't exist, no need to migrate
          this.db
            .prepare(`INSERT INTO versions (version, created_at) VALUES (?, ?)`)
            .run(1, new Date().toISOString());
          return;
        }

        // Copy legacy rows from sent_alerts -> notifications
        // We try to parse match_id and odds_type from alert_key:
        // old key likely looked like: `${matchId}|${oddsType}|${condition}|${side}`
        // If parsing fails, we still copy but set match_id to the whole key (last resort),
        // so the NOT NULL constraint is satisfied.
        const legacyRows = this.db
          .prepare(`SELECT alert_key, created_at FROM sent_alerts`)
          .all() as Array<{ alert_key: string; created_at: string }>;

        const insertNotif = this.db.prepare(`
          INSERT INTO notifications (
            alert_key, created_at, match_id, odds_type, condition, result, message_id
          ) VALUES (
            @alert_key, @created_at, @match_id, @odds_type, @condition, @result, @message_id
          )
          ON CONFLICT(alert_key) DO NOTHING
        `);

        for (const r of legacyRows) {
          const { matchId, oddsType, condition } = this.parseLegacyAlertKey(
            r.alert_key,
          );

          insertNotif.run({
            alert_key: r.alert_key,
            created_at: r.created_at,
            match_id: matchId ?? r.alert_key, // last resort fallback
            odds_type: oddsType ?? null,
            condition: condition ?? null,
            result: null,
            message_id: null,
          });
        }

        // Write version 1
        this.db
          .prepare(`INSERT INTO versions (version, created_at) VALUES (?, ?)`)
          .run(1, new Date().toISOString());

        this.db.exec(`DROP TABLE IF EXISTS sent_alerts;`);
      });

      tx();
    }
  }

  private ensureNotificationsTable() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS notifications (
        alert_key  TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        match_id   TEXT NOT NULL,
        odds_type  TEXT,
        condition  TEXT,
        result     INTEGER,  -- 0/1, nullable
        message_id INTEGER      -- nullable
      );

      CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_match_odds_cond
      ON notifications(match_id, odds_type, condition);

      CREATE INDEX IF NOT EXISTS idx_notifications_created_at
      ON notifications (created_at);
    `);
  }

  private parseLegacyAlertKey(alertKey: string): {
    matchId: string | null;
    oddsType: string | null;
    condition: string | null;
  } {
    // Expected old format: matchId|oddsType|condition|side
    // Best-effort parsing only.
    const parts = alertKey
      .split("|")
      .map((x) => x.trim())
      .filter(Boolean);
    if (parts.length >= 3) {
      return {
        matchId: parts[0] ?? null,
        oddsType: parts[1] ?? null,
        condition: parts[2] ?? null,
      };
    }
    // No delimiter: cannot parse reliably
    return { matchId: null, oddsType: null, condition: null };
  }

  private prepareStatements() {
    // Upsert: insert if new; if exists, update only fields that are provided (result/message_id)
    this.upsertNotificationStmt = this.db.prepare(`
      INSERT INTO notifications (
        alert_key, created_at, match_id, odds_type, condition, result, message_id
      ) VALUES (
        @alert_key, @created_at, @match_id, @odds_type, @condition, @result, @message_id
      )
      ON CONFLICT(alert_key) DO UPDATE SET
        -- keep original created_at / match_id / odds_type / condition
        result     = COALESCE(excluded.result, notifications.result),
        message_id = COALESCE(excluded.message_id, notifications.message_id)
    `);

    this.getLatestByMatchOddsStmt = this.db.prepare(`
      SELECT alert_key, created_at, match_id, odds_type, condition, result, message_id
      FROM notifications
      WHERE match_id = ? AND (odds_type IS ? OR odds_type = ?) AND (condition IS ? OR condition = ?)
      ORDER BY created_at DESC
      LIMIT 1
    `);

    this.getByAlertKeyStmt = this.db.prepare(`
      SELECT alert_key, created_at, match_id, odds_type, condition, result, message_id
      FROM notifications
      WHERE alert_key = ?
      LIMIT 1
    `);

    this.getByResultIsNullStmt = this.db.prepare(`
      SELECT alert_key, created_at, match_id, odds_type, condition, result, message_id
      FROM notifications
      WHERE result IS NULL
    `);

    this.updateResultStmt = this.db.prepare(`
      UPDATE notifications
      SET result = ?
      WHERE alert_key = ?
    `);

    this.updateMessageIdStmt = this.db.prepare(`
      UPDATE notifications
      SET message_id = ?
      WHERE alert_key = ?
    `);
  }

  public buildAlertKey(opts: {
    matchId: string;
    oddsType?: string | null;
    condition?: string | null;
  }): string {
    const parts = [opts.matchId, opts.oddsType ?? "", opts.condition ?? ""];
    return parts.join("|");
  }

  /**
   * Unified insert/update entry point:
   * - Generates alert_key (unless provided)
   * - Inserts notifications row
   * - If already exists, can optionally update result/message_id (only if you pass them)
   *
   * Returns: { alertKey, insertedOrUpdated: boolean }
   */
  upsertNotification(options: UpsertNotificationOptions): { alertKey: string } {
    const createdAt = options.createdAt ?? new Date().toISOString();
    const alertKey =
      options.alertKey ??
      this.buildAlertKey({
        matchId: options.matchId,
        oddsType: options.oddsType ?? null,
        condition: options.condition ?? null,
      });

    this.upsertNotificationStmt.run({
      alert_key: alertKey,
      created_at: createdAt,
      match_id: options.matchId,
      odds_type: options.oddsType ?? null,
      condition: options.condition ?? null,
      result:
        options.result === undefined
          ? null
          : options.result === null
            ? null
            : options.result
              ? 1
              : 0,
      message_id: options.messageId ?? null,
    });

    return { alertKey };
  }

  getNotificationByAlertKey(alertKey: string): NotificationRecord | null {
    const row = this.getByAlertKeyStmt.get(alertKey) as
      | NotificationRecord
      | undefined;
    return row ?? null;
  }

  getLatestNotification(
    matchId: string,
    oddsType?: string | null,
    condition?: string | null,
  ): NotificationRecord | null {
    const row = this.getLatestByMatchOddsStmt.get(
      matchId,
      oddsType ?? null,
      oddsType ?? null,
      condition ?? null,
      condition ?? null,
    ) as NotificationRecord | undefined;

    return row ?? null;
  }

  getNotificationsWithNullResult(): NotificationRecord[] {
    const rows = this.getByResultIsNullStmt.all() as
      | NotificationRecord[]
      | undefined;
    return rows ?? [];
  }

  updateNotificationResult(alertKey: string, result: boolean | null) {
    this.updateResultStmt.run(
      result === null ? null : result ? 1 : 0,
      alertKey,
    );
  }

  updateNotificationMessageId(alertKey: string, messageId: number | null) {
    this.updateMessageIdStmt.run(messageId, alertKey);
  }
}
