import { ResultsFootballApi } from "../src/modules/resultsFootballApi";
import { destination, pino } from "pino";
import { JSDOM } from "jsdom";

const api = new ResultsFootballApi();

async function main() {
  /*
  const results = await api.getAllFootballMatches({
    oddsTypes: ["FHL", "HIL", "FCH"],
  });
  console.log(results[0]);
  */

  /*
  const logger = pino(
    {
      name: "testing",
      level: process.env.LOG_LEVEL || "debug",
      timestamp: pino.stdTimeFunctions.isoTime,
      base: { pid: process.pid },
    },
    destination("./logs.log"),
  );

  for (let i = 0; i < 30; i++) {
    logger.info("Testing123");
  }
  */

  const res = await fetch("https://g10oal.com/match/FB4904/info");
  const text = await res.text();
  const doc = new JSDOM(text);
  const timeStr = doc.window.document
    .getElementsByClassName("live-status-live")
    .item(0)?.textContent;

  const regexMatch = timeStr?.match(/\d+/);
  const time = regexMatch ? parseInt(regexMatch[0], 10) : null;
  console.log(time);
}

main();
