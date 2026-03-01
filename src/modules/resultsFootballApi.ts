import { defaultClient, FootballAPI, HKJCClient } from "hkjc-api";
import {
  MatchResultsQueryResponse,
  type FootballMatchResult,
} from "../type/footballResults";
import { footballMatchesResultsQuery } from "../query/footballMatchesResultsQuery";

interface FootballMatchesResultsResponse {
  matches: FootballMatchResult[];
}

export interface FootballMatchesResultsOptions {
  startDate?: string | null;
  endDate?: string | null;
  startIndex?: number | null;
  endIndex?: number | null;
  teamId?: string | null;
}

export class ResultsFootballApi extends FootballAPI {
  // Assign new client as module property set to private.
  protected newClient: HKJCClient;
  constructor(client?: HKJCClient) {
    super(client);
    this.newClient = client || defaultClient;
  }

  /**
   * Get all football matches results
   * @param options Optional parameters to filter matches
   * @returns A list of football matches results
   */
  async getAllFootballMatchesResults(
    options: FootballMatchesResultsOptions = {},
  ): Promise<FootballMatchResult[]> {
    const {
      startDate = null,
      endDate = null,
      startIndex = null,
      endIndex = null,
      teamId = null,
    } = options;
    try {
      const response = await this.newClient.request<MatchResultsQueryResponse>(
        footballMatchesResultsQuery,
        {
          startDate,
          endDate,
          startIndex,
          endIndex,
          teamId,
        },
      );
      return response && response.matches ? response.matches : [];
    } catch (error) {
      console.error("Error fetching football matches:", error);
      return [];
    }
  }
}
