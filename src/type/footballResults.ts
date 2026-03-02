import { type FootballTeam } from "hkjc-api";

export interface TimeOffsetResult {
  fb: number;
}

export interface MatchNumByDateResult {
  total: number;
}

export interface TournamentResult {
  code: string;
  name_en: string;
  name_ch: string;
}

export interface Result {
  homeResult: number;
  awayResult: number;
  ttlCornerResult: number;
  resultConfirmType: number;
  payoutConfirmed: boolean;
  stageId: number; // 2: first half, 3: half-time, 4: second half, 5: full-time
  resultType: number; // 1: HAD, 2: Corner, 4: Redcard number
  sequence: number;
}

export interface NgsInfoResult {
  str: string;
  name_en: string;
  name_ch: string;
  instNo: number;
}

export interface AgsInfoResult {
  str: string;
  name_en: string;
  name_ch: string;
}

export interface PoolInfoResult {
  payoutRefundPools: string[];
  refundPools: string[];
  ntsInfo: string[];
  entInfo: string[];
  definedPools: string[];
  ngsInfo: NgsInfoResult;
  agsInfo: AgsInfoResult;
}

export interface FootballMatchResult {
  id: string;
  status: string;
  frontEndId: string;
  matchDayOfWeek: number;
  matchNumber: number;
  matchDate: string;
  kickOffTime: string;
  sequence: string;
  homeTeam: FootballTeam;
  awayTeam: FootballTeam;
  tournament: TournamentResult;
  results: Result[];
  poolInfo: PoolInfoResult;
}

export interface MatchResultsQueryResponse {
  timeOffset: TimeOffsetResult;
  matchNumByDate: MatchNumByDateResult;
  matches: FootballMatchResult[];
}
