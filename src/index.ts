import { sleep } from "./utils";
import { FootballMatchNotifier } from "./modules/footballMatchNotifierr";
import { destination, pino } from "pino";

const logger = pino(
  {
    name: "index",
    level: process.env.LOG_LEVEL || "debug",
    timestamp: pino.stdTimeFunctions.isoTime,
    base: { pid: process.pid },
  },
  destination("./logs.log"),
);

const notifier = new FootballMatchNotifier();

async function resultLoop() {
  while (true) {
    try {
      const timeNow = new Date().getMinutes();
      if (timeNow % 15 === 0) {
        await notifier.checkResultsAndUpdate();
        await sleep(13 * 60_000);
      }
    } catch (e) {
      logger.error(`Result loop error: ${e}`);
      console.error("result loop error:", e);
    }
    await sleep(15_000);
  }
}

async function scanLoop() {
  while (true) {
    let sleepTime = 30_000; // 30 seconds
    try {
      sleepTime = await notifier.scanAndSendOnce();
    } catch (e) {
      logger.error(`Scanning loop error: ${e}`);
      console.error("scan error:", e);
    }
    await sleep(sleepTime);
  }
}

async function main() {
  await Promise.all([scanLoop(), resultLoop()]);
}

main().catch(console.error);
