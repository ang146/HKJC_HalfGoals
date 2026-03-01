import { ResultsFootballApi } from "./modules/resultsFootballApi";

const api = new ResultsFootballApi();

async function main() {
  const results = await api.getAllFootballMatchesResults();
  console.log(results);
}

main();
