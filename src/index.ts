import { ReplyParameters, TelegramBot } from "typescript-telegram-bot-api";
import dotenv from "dotenv";

import { ResultsFootballApi } from "./modules/resultsFootballApi";
import { ResultDatabase } from "./database/resultDatabase";

dotenv.config({ path: ".env" });

const botToken = process.env.TELEGRAM_BOT_TOKEN ?? "";
const channelId = process.env.TELEGRAM_CHANNEL_ID ?? "";

if (!botToken) throw new Error("Missing TELEGRAM_BOT_TOKEN in .env");
if (!channelId) throw new Error("Missing TELEGRAM_CHANNEL_ID in .env");

const bot = new TelegramBot({ botToken });

const footballApi = new ResultsFootballApi();
const db = new ResultDatabase();

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

async function botSendMessage(opts: {
  text: string;
  reply_messageId?: number | null;
}): Promise<number> {
  const payload: any = {
    text: opts.text,
    chat_id: channelId,
  };

  if (opts.reply_messageId && opts.reply_messageId > 0) {
    payload.reply_parameters = {
      message_id: opts.reply_messageId,
      allow_sending_without_reply: true,
    } satisfies ReplyParameters;
  }

  const message = await bot.sendMessage(payload);
  return message.message_id;
}

async function scanAndSendOnce() {
  console.log(`[${new Date().toISOString()}] scanning...`);

  const allMatches = await footballApi.getAllFootballMatches();

  for (const match of allMatches) {
    if (match.poolInfo.inplayPools.length <= 0) continue;
    if (
      (match.runningResult?.awayScore ?? 1) > 0 ||
      (match.runningResult?.homeScore ?? 1) > 0
    )
      continue;
    if (
      !match.poolInfo.inplayPools.includes("FHL") &&
      !match.poolInfo.inplayPools.includes("HIL") &&
      !match.poolInfo.inplayPools.includes("FCH")
    )
      continue;

    const matchId = match.id;

    const hilPool = match.foPools.find((pool) => pool.oddsType === "HIL");
    const fhlPool = match.foPools.find((pool) => pool.oddsType === "FHL");
    const fchPool = match.foPools.find((pool) => pool.oddsType === "FCH");

    // HIL 全場
    if (hilPool) {
      const line = hilPool.lines.find((l) => l.condition === "0.5/1.0");
      const oddsStr = line?.combinations.find(
        (c) => c.str === "H",
      )?.currentOdds;
      const odds = parseFloat(oddsStr ?? "0");

      if (line && odds >= 2.0 && odds <= 2.2) {
        const { alertKey } = db.upsertNotification({
          matchId,
          oddsType: "HIL",
          condition: line.condition,
        });

        const existing = db.getNotificationByAlertKey(alertKey);
        if (!existing?.message_id) {
          const text = `${match.homeTeam.name_ch} vs ${match.awayTeam.name_ch} 全場 ${line.condition}大 ${odds}`;
          const messageId = await botSendMessage({ text });
          db.updateNotificationMessageId(alertKey, messageId);
          console.log("sent:", alertKey);
        }
      }
    }

    // FHL 半場
    if (fhlPool) {
      const line = fhlPool.lines.find((l) => l.condition === "0.5/1.0");
      const oddsStr = line?.combinations.find(
        (c) => c.str === "H",
      )?.currentOdds;
      const odds = parseFloat(oddsStr ?? "0");

      if (line && odds >= 2.0 && odds <= 2.2) {
        const { alertKey } = db.upsertNotification({
          matchId,
          oddsType: "FHL",
          condition: line.condition,
        });

        const existing = db.getNotificationByAlertKey(alertKey);
        if (!existing?.message_id) {
          const text = `${match.homeTeam.name_ch} vs ${match.awayTeam.name_ch} 半場 ${line.condition}大 ${odds}`;
          const messageId = await botSendMessage({ text });
          db.updateNotificationMessageId(alertKey, messageId);
          console.log("sent:", alertKey);
        }
      }
    }

    // FCH 半場角球
    if (fchPool) {
      const lines = fchPool.lines.filter(
        (l) => l.condition === "1.5" || l.condition === "2.5",
      );

      for (const line of lines) {
        const oddsStr = line?.combinations.find(
          (c) => c.str === "H",
        )?.currentOdds;
        const odds = parseFloat(oddsStr ?? "0");

        if (line && odds >= 2 && odds <= 2.25) {
          const { alertKey } = db.upsertNotification({
            matchId,
            oddsType: "FCH",
            condition: line.condition,
          });

          const existing = db.getNotificationByAlertKey(alertKey);
          if (!existing?.message_id) {
            const text = `[角球]${match.homeTeam.name_ch} vs ${match.awayTeam.name_ch} 半場 ${line.condition}角大 ${odds}`;
            const messageId = await botSendMessage({ text });
            db.updateNotificationMessageId(alertKey, messageId);
            console.log("sent:", alertKey);
          }
        }
      }
    }
  }

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
    Date.parse(filteredMatches[0]?.kickOffTime ?? "0") - currentTime.getTime();
  let sleepTime = Math.max(60_000, timeDiffToNextMatch - 60_000);
  sleepTime = Math.min(sleepTime, 60 * 60_000); // max 60 minutes
  return sleepTime;
}

async function checkResultsAndUpdate() {
  const nullResultMatches = db.getNotificationsWithNullResult();
  if (nullResultMatches.length === 0) return;

  const matchResults = await footballApi.getAllFootballMatchesResults();
  for (const record of nullResultMatches) {
    try {
      const alertKey = record.alert_key;
      const matchResult = matchResults.find((m) => m.id === record.match_id);

      if (!matchResult) {
        if (
          new Date(record.created_at ?? 0).getTime() <
          Date.now() - 3 * 24 * 60 * 60_000
        ) {
          db.updateNotificationResult(alertKey, false);
        }
        continue;
      }

      switch (record.odds_type) {
        case "HIL": {
          const ftResult = matchResult.results.find(
            (r) => r.stageId === 5 && r.resultType === 1,
          );
          const result =
            (ftResult?.homeResult ?? 0) > 0 || (ftResult?.awayResult ?? 0) > 0;
          db.updateNotificationResult(alertKey, result);

          await botSendMessage({
            text: `${matchResult.homeTeam.name_ch} 對 ${matchResult.awayTeam.name_ch} 全場大${result ? "✅" : "❌"}`,
            reply_messageId: record.message_id,
          });
          continue;
        }

        case "FHL": {
          const htResult = matchResult.results.find(
            (r) => r.stageId === 3 && r.resultType === 1,
          );
          const htResultValue =
            (htResult?.homeResult ?? 0) > 0 || (htResult?.awayResult ?? 0) > 0;
          db.updateNotificationResult(alertKey, htResultValue);

          await botSendMessage({
            text: `${matchResult.homeTeam.name_ch} 對 ${matchResult.awayTeam.name_ch} 半場大${htResultValue ? "✅" : "❌"}`,
            reply_messageId: record.message_id,
          });
          continue;
        }
        case "FCH": {
          const cornerResult = matchResult.results.find(
            (r) => r.stageId === 3 && r.resultType === 2,
          );

          const htCorners =
            (cornerResult?.homeResult ?? 0) + (cornerResult?.awayResult ?? 0);
          const line = parseFloat(record.condition ?? "999");
          const cornerResultValue = htCorners > line;
          db.updateNotificationResult(alertKey, cornerResultValue);

          await botSendMessage({
            text: `${matchResult.homeTeam.name_ch} 對 ${matchResult.awayTeam.name_ch} 半場角球大${cornerResultValue ? "✅" : "❌"}`,
            reply_messageId: record.message_id,
          });
          continue;
        }
      }
    } finally {
      // Prevent message sending too quickly.
      await sleep(100);
    }
  }
}

async function resultLoop() {
  await sleep(Math.random() * 15_000 + 5);
  while (true) {
    try {
      await checkResultsAndUpdate();
    } catch (e) {
      console.error("result loop error:", e);
    }
    await sleep(60 * 60_000); // check every hour
  }
}

async function scanLoop() {
  while (true) {
    let sleepTime = 60_000; // 1 minute
    try {
      sleepTime = await scanAndSendOnce();
    } catch (e) {
      console.error("scan error:", e);
    }
    await sleep(sleepTime);
  }
}

async function main() {
  await Promise.all([scanLoop(), resultLoop()]);
}

main().catch(console.error);
