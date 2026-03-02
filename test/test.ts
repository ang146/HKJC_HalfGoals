import { ResultsFootballApi } from "../src/modules/resultsFootballApi";
import { destination, pino } from "pino";

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
}

main();
