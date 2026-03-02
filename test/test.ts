import { ResultsFootballApi } from "../src/modules/resultsFootballApi";

const api = new ResultsFootballApi();

async function main() {
  const results = await api.getAllFootballMatches({
    oddsTypes: ["FHL", "HIL", "FCH"],
  });
  console.log(results[0]);
}

main();
