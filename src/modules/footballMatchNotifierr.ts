import { ReplyParameters, TelegramBot } from "typescript-telegram-bot-api";
import dotenv from "dotenv";
import { ResultsFootballApi } from "../modules/resultsFootballApi";
import { ResultDatabase } from "../database/resultDatabase";
import { FootballMatch } from "hkjc-api";
import { sleep } from "../utils";
import { destination, Logger, pino } from "pino";
import { JSDOM } from "jsdom";

export class FootballMatchNotifier {
  private channelId: string;
  private bot: TelegramBot;
  private footballApi: ResultsFootballApi;
  private db: ResultDatabase;
  private logger: Logger;

  constructor() {
    dotenv.config({ path: ".env" });

    const botToken = process.env.TELEGRAM_BOT_TOKEN ?? "";
    this.channelId = process.env.TELEGRAM_CHANNEL_ID ?? "";

    if (!botToken) throw new Error("Missing TELEGRAM_BOT_TOKEN in .env");
    if (!this.channelId) throw new Error("Missing TELEGRAM_CHANNEL_ID in .env");

    this.bot = new TelegramBot({ botToken });
    this.footballApi = new ResultsFootballApi();
    this.db = new ResultDatabase();
    this.logger = pino(
      {
        name: "Notifier",
        level: process.env.LOG_LEVEL || "debug",
        timestamp: pino.stdTimeFunctions.isoTime,
        base: { pid: process.pid },
      },
      destination("./logs.log"),
    );
  }

  private async botSendMessage(opts: {
    text: string;
    reply_messageId?: number | null;
  }): Promise<number> {
    const payload: any = {
      text: opts.text,
      chat_id: this.channelId,
    };

    if (opts.reply_messageId && opts.reply_messageId > 0) {
      payload.reply_parameters = {
        message_id: opts.reply_messageId,
        allow_sending_without_reply: true,
      } satisfies ReplyParameters;
    }

    const message = await this.bot.sendMessage(payload);
    this.logger.info(
      `Sent message [${opts.text}, with reply id: ${opts.reply_messageId}]`,
    );
    return message.message_id;
  }

  private async getLiveMatchTime(frontEndId: string): Promise<number> {
    const res = await fetch(`https://g10oal.com/match/${frontEndId}/info`);
    const text = await res.text();
    const doc = new JSDOM(text);
    const timeStr = doc.window.document
      .getElementsByClassName("live-status-live")
      .item(0)?.textContent;

    const regexMatch = timeStr?.match(/\d+/);
    return regexMatch ? parseInt(regexMatch[0], 10) : -1;
  }

  private constructAlertMessage(
    match: FootballMatch,
    matchTime: number,
    oddsType: string,
    odds: number,
    condition?: string,
  ): string {
    let messageText = "";
    switch (oddsType) {
      case "FCH": {
        messageText = `[角球]${matchTime}' ${match.homeTeam.name_ch} vs ${match.awayTeam.name_ch} ${condition}角大 ${odds}`;
        break;
      }
      case "HIL":
      case "FHL": {
        messageText = `${matchTime}' ${match.homeTeam.name_ch} vs ${match.awayTeam.name_ch} ${condition}大 ${odds}`;
        break;
      }
    }

    const homeResults = this.db
      .getNotifications({
        homeTeamId: match.homeTeam.id,
        oddsType,
        condition,
        resultIsNull: false,
        numberRecords: 100,
      })
      .concat(
        this.db.getNotifications({
          awayTeamId: match.homeTeam.id,
          oddsType,
          condition,
          resultIsNull: false,
          numberRecords: 100,
        }),
      );

    const awayResults = this.db
      .getNotifications({
        homeTeamId: match.awayTeam.id,
        oddsType,
        condition,
        resultIsNull: false,
        numberRecords: 100,
      })
      .concat(
        this.db.getNotifications({
          awayTeamId: match.awayTeam.id,
          oddsType,
          condition,
          resultIsNull: false,
          numberRecords: 100,
        }),
      );

    const tournamentResults = this.db.getNotifications({
      tournamentId: match.tournament.id,
      oddsType,
      condition,
      resultIsNull: false,
      numberRecords: 100,
    });

    const recentDateRange = new Date(match.kickOffTime);
    recentDateRange.setDate(recentDateRange.getDate() - 5);
    const recentMatchesResults = this.db.getNotifications({
      createTimeAfter: recentDateRange.toISOString(),
      oddsType,
      condition,
      resultIsNull: false,
      numberRecords: 10,
    });

    if (homeResults.length > 10) {
      const total = homeResults.length;
      const wins = homeResults
        .map((rec) => rec.result ?? (0 as number))
        .reduce((sum, cr) => sum + cr);
      messageText += `\n主隊近${total}場成功率: ${((wins / total) * 100).toFixed(1)}%`;
    }

    if (awayResults.length > 10) {
      const total = awayResults.length;
      const wins = awayResults
        .map((rec) => rec.result ?? (0 as number))
        .reduce((sum, cr) => sum + cr);
      messageText += `\n客隊近${total}場成功率: ${((wins / total) * 100).toFixed(1)}%`;
    }

    if (tournamentResults.length > 10) {
      const total = tournamentResults.length;
      const wins = tournamentResults
        .map((rec) => rec.result ?? (0 as number))
        .reduce((sum, cr) => sum + cr);
      messageText += `\n是次聯賽近${total}場成功率: ${((wins / total) * 100).toFixed(1)}%`;
    }

    if (recentMatchesResults.length > 0) {
      messageText += `\n近${recentMatchesResults.length}場通知結果:`;
      messageText += recentMatchesResults
        .map((rec) => (rec.result ? "✅" : "❌"))
        .join();
    }

    return messageText;
  }

  public async scanGoal(match: FootballMatch, oddsType: string) {
    const pool = match.foPools.find((p) => p.oddsType === oddsType);
    if (pool) {
      const line = pool.lines.find((l) => l.condition === "0.5/1.0");
      if (!line) return;

      const oddsStr = line?.combinations.find(
        (c) => c.str === "H",
      )?.currentOdds;
      if (!oddsStr) return;

      const odds = parseFloat(oddsStr ?? "0");
      this.logger.debug(
        `${oddsType} Goal line 0.75 odds with odds ${odds} found for match ${match.id}|${match.frontEndId}.`,
      );

      if (line && odds >= 2.0 && odds <= 2.2) {
        const matchTime = await this.getLiveMatchTime(match.frontEndId);
        const { alertKey } = this.db.upsertNotification({
          matchId: match.id,
          oddsType,
          condition: line.condition,
          matchTime,
          homeTeamId: match.homeTeam.id,
          awayTeamId: match.awayTeam.id,
          tournamentId: match.tournament.id,
        });

        const existing = this.db.getNotificationByAlertKey(alertKey);
        if (!existing?.message_id) {
          const text = this.constructAlertMessage(
            match,
            matchTime,
            oddsType,
            odds,
            line.condition,
          );
          const messageId = await this.botSendMessage({ text });
          this.db.updateNotificationMessageId(alertKey, messageId);
          this.logger.info(
            `Alert key for GOAL line [${alertKey}] processed for match ${match.id}|${match.frontEndId}.`,
          );
        }
      }
    }
  }

  public async scanCorner(match: FootballMatch, oddsType: string) {
    const pool = match.foPools.find((p) => p.oddsType === oddsType);
    if (pool) {
      const lines = pool.lines.filter(
        (l) => l.condition === "1.5" || l.condition === "2.5",
      );

      if (lines.length === 0) return;

      for (const line of lines) {
        const oddsStr = line?.combinations.find(
          (c) => c.str === "H",
        )?.currentOdds;
        if (!oddsStr) return;

        const odds = parseFloat(oddsStr);
        this.logger.debug(
          `${oddsType} Corner line ${line.condition} with odds ${odds} found for match ${match.id}|${match.frontEndId}.`,
        );

        if (line && odds >= 2 && odds <= 2.25) {
          const matchTime = await this.getLiveMatchTime(match.frontEndId);
          const { alertKey } = this.db.upsertNotification({
            matchId: match.id,
            oddsType,
            condition: line.condition,
            matchTime,
            homeTeamId: match.homeTeam.id,
            awayTeamId: match.awayTeam.id,
            tournamentId: match.tournament.id,
          });

          const existing = this.db.getNotificationByAlertKey(alertKey);
          if (!existing?.message_id) {
            const text = this.constructAlertMessage(
              match,
              matchTime,
              oddsType,
              odds,
              line.condition,
            );
            const messageId = await this.botSendMessage({ text });
            this.db.updateNotificationMessageId(alertKey, messageId);
            console.log("sent:", alertKey);
            this.logger.info(
              `Alert key for CORNER line [${alertKey}] processed for match ${match.id}|${match.frontEndId}.`,
            );
          }
        }
      }
    }
  }

  public async scanAndSendOnce() {
    this.logger.debug("Scanning...");

    const allMatches = await this.footballApi.getAllFootballMatches({
      oddsTypes: ["FHL", "HIL", "FCH"],
    });

    for (const match of allMatches) {
      if (match.poolInfo.inplayPools.length <= 0) continue;
      if (
        (match.runningResult?.awayScore ?? 1) > 0 &&
        (match.runningResult?.homeScore ?? 1) > 0 &&
        (match.runningResult?.corner ?? 2) >= 2
      )
        continue;

      await this.scanGoal(match, "HIL");
      await this.scanGoal(match, "FHL");
      await this.scanCorner(match, "FCH");
    }

    this.logger.debug("Scanning finished.");

    const filteredMatches = allMatches.filter(
      (m) =>
        m.poolInfo.inplayPools.length > 0 &&
        (m.runningResult?.awayScore ?? 0) === 0 &&
        (m.runningResult?.homeScore ?? 0) === 0,
    );

    if (filteredMatches.length === 0) {
      return 60_000;
    }

    const currentTime = new Date();
    const timeDiffToNextMatch =
      Date.parse(filteredMatches[0]?.kickOffTime ?? "0") -
      currentTime.getTime();
    let sleepTime = Math.max(60_000, timeDiffToNextMatch - 60_000);
    sleepTime = Math.min(sleepTime, 60 * 60_000); // max 60 minutes
    this.logger.debug(
      `Next match starts at ${timeDiffToNextMatch / 1000}s. Sleep for ${sleepTime}.`,
    );
    return sleepTime;
  }

  public async checkResultsAndUpdate() {
    this.logger.debug("Checking results");
    const nullResultMatches = this.db.getNotifications({ resultIsNull: true });
    if (nullResultMatches.length === 0) {
      this.logger.debug("No result need to be checked.");
      return;
    }

    const matchResults = (
      await this.footballApi.getAllFootballMatchesResults()
    ).filter(
      (m) =>
        m.status.toLowerCase() === "inplaymatchended" ||
        m.status.toLowerCase() === "firsthalfcompleted",
    );
    for (const record of nullResultMatches) {
      try {
        this.logger.info(`Checking result for match record ${record.match_id}`);
        const alertKey = record.alert_key;
        const matchResult = matchResults.find((m) => m.id === record.match_id);

        if (!matchResult) {
          if (
            new Date(record.created_at ?? 0).getTime() <
            Date.now() - 3 * 24 * 60 * 60_000
          ) {
            this.logger.info(
              `Match record ${record.match_id} is too old and unable to retrieve result, setting to false.`,
            );
            this.db.updateNotificationResult(alertKey, false);
          }
          continue;
        }

        switch (record.odds_type) {
          case "HIL": {
            const ftResult = matchResult.results.find(
              (r) => r.stageId === 5 && r.resultType === 1,
            );

            if (!ftResult) continue;

            const ftResultValue =
              (ftResult?.homeResult ?? 0) > 0 ||
              (ftResult?.awayResult ?? 0) > 0;
            this.logger.info(
              `Setting match ${record.match_id} record's result to ${ftResultValue}`,
            );
            this.db.updateNotificationResult(alertKey, ftResultValue);

            await this.botSendMessage({
              text: `${matchResult.homeTeam.name_ch} 對 ${matchResult.awayTeam.name_ch} 全場大${ftResultValue ? "✅" : "❌"}`,
              reply_messageId: record.message_id,
            });
            continue;
          }

          case "FHL": {
            const htResult = matchResult.results.find(
              (r) => r.stageId === 3 && r.resultType === 1,
            );

            if (!htResult) continue;

            const htResultValue =
              (htResult?.homeResult ?? 0) > 0 ||
              (htResult?.awayResult ?? 0) > 0;
            this.logger.info(
              `Setting match ${record.match_id} record's result to ${htResultValue}`,
            );
            this.db.updateNotificationResult(alertKey, htResultValue);

            await this.botSendMessage({
              text: `${matchResult.homeTeam.name_ch} 對 ${matchResult.awayTeam.name_ch} 半場大${htResultValue ? "✅" : "❌"}`,
              reply_messageId: record.message_id,
            });
            continue;
          }
          case "FCH": {
            const cornerResult = matchResult.results.find(
              (r) => r.stageId === 3 && r.resultType === 2,
            );

            if (!cornerResult) continue;

            const htCorners =
              (cornerResult?.homeResult ?? 0) + (cornerResult?.awayResult ?? 0);
            const line = parseFloat(record.condition ?? "999");
            const cornerResultValue = htCorners > line;
            this.logger.info(
              `Setting match ${record.match_id} record's result to ${cornerResultValue}`,
            );
            this.db.updateNotificationResult(alertKey, cornerResultValue);

            await this.botSendMessage({
              text: `${matchResult.homeTeam.name_ch} 對 ${matchResult.awayTeam.name_ch} 半場角球大${cornerResultValue ? "✅" : "❌"}`,
              reply_messageId: record.message_id,
            });
            continue;
          }
        }
      } finally {
        // Prevent message sending too quickly.
        await sleep(500);
      }
    }
    this.logger.debug("Result checking finished");
  }
}
