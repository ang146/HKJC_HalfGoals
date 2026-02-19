import { FootballAPI } from "hkjc-api";
import { TelegramBot } from "typescript-telegram-bot-api";
import dotenv from "dotenv";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

dotenv.config({ path: ".env" });

const botToken = process.env.TELEGRAM_BOT_TOKEN ?? "";
const channelId = process.env.TELEGRAM_CHANNEL_ID ?? "";

if (!botToken) throw new Error("Missing TELEGRAM_BOT_TOKEN in .env");
if (!channelId) throw new Error("Missing TELEGRAM_CHANNEL_ID in .env");

const bot = new TelegramBot({ botToken });

const footballApi = new FootballAPI();

const dataDir = path.resolve("data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);
const db = new Database(path.join(dataDir, "app.db"));

db.exec(`
  CREATE TABLE IF NOT EXISTS sent_alerts (
    alert_key TEXT PRIMARY KEY,
    created_at TEXT NOT NULL
  );
`);

const insertAlertStmt = db.prepare(
  `INSERT INTO sent_alerts (alert_key, created_at) VALUES (?, ?)`
);

function tryMarkAsSent(alertKey: string): boolean {
  try {
    insertAlertStmt.run(alertKey, new Date().toISOString());
    return true;
  } catch {
    return false;
  }
}

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

function buildAlertKey(opts: {
  matchId: string | number;
  oddsType: "HIL" | "FHL";
  condition: string;  // e.g. "0.5/1.0"
  side: string;       // e.g. "H"
}) {
  return `${opts.matchId}|${opts.oddsType}|${opts.condition}|${opts.side}`;
}

async function scanAndSendOnce() {
  console.log(`[${new Date().toISOString()}] scanning...`);

  const allMatches = await footballApi.getAllFootballMatches();

  for (const match of allMatches) {
    if (match.poolInfo.inplayPools.length <= 0) continue;
    if ((match.runningResult?.awayScore ?? 1) > 0 || (match.runningResult?.homeScore ?? 1) > 0) continue;
    if (!match.poolInfo.inplayPools.includes("FHL") && !match.poolInfo.inplayPools.includes("HIL")) continue;

    const matchId = match.id;

    const hilPool = match.foPools.find((pool) => pool.oddsType === "HIL");
    const fhlPool = match.foPools.find((pool) => pool.oddsType === "FHL");

    // HIL
    if (hilPool) {
      const line = hilPool.lines.find((l) => l.condition === "0.5/1.0");
      const oddsStr = line?.combinations.find((c) => c.str === "H")?.currentOdds;
      const odds = parseFloat(oddsStr ?? "0");

      if (line && odds >= 2.0 && odds <= 2.2) {
        const alertKey = buildAlertKey({
          matchId,
          oddsType: "HIL",
          condition: line.condition,
          side: "H",
        });

        if (tryMarkAsSent(alertKey)) {
          const text = `Match ${match.homeTeam.name_ch} vs ${match.awayTeam.name_ch} 全場 ${line.condition}大 ${odds}`;
          await bot.sendMessage({ chat_id: channelId, text });
          console.log("sent:", alertKey);
        }
      }
    }

    // FHL
    if (fhlPool) {
      const line = fhlPool.lines.find((l) => l.condition === "0.5/1.0");
      const oddsStr = line?.combinations.find((c) => c.str === "H")?.currentOdds;
      const odds = parseFloat(oddsStr ?? "0");

      if (line && odds >= 2.0 && odds <= 2.2) {
        const alertKey = buildAlertKey({
          matchId,
          oddsType: "FHL",
          condition: line.condition,
          side: "H",
        });

        if (tryMarkAsSent(alertKey)) {
          const text = `Match ${match.homeTeam.name_ch} vs ${match.awayTeam.name_ch} 半場 ${line.condition}大 ${odds}`;
          await bot.sendMessage({ chat_id: channelId, text });
          console.log("sent:", alertKey);
        }
      }
    }
  }
}

async function runForever() {
  while (true) {
    try {
      await scanAndSendOnce();
    } catch (e) {
      console.error("scan error:", e);
    }
    await sleep(60_000);
  }
}

runForever().catch(console.error);
