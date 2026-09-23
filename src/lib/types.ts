export interface Season { id: string; name: string; is_replay: boolean }
export interface Team {
  id: string; display_name: string; short_name: string; stadium: string | null;
  colour: string | null; colour_ink: string | null; badge_url: string | null;
}
export interface Match {
  id: string; season: string; round: number; kickoff_at: string;
  home_team_id: string; away_team_id: string;
  home_score: number | null; away_score: number | null;
  venue: string | null; status: string;
}
export interface Member { user_id: string; email: string; display_name: string; is_admin: boolean }
export interface Entry { id: number; user_id: string; season: string; team_name: string }
export interface PoolPick { entry_id: number; round: number; team_id: string; is_captain: boolean }
export interface Prediction { entry_id: number; match_id: string; home_score: number; away_score: number }
export interface StandingRow {
  team_id: string; played: number; won: number; drawn: number; lost: number;
  points_for: number; points_against: number; diff: number;
  log_points: number; points_exact: boolean; position: number;
}
export interface LeaderRow {
  entry_id: number; team_name: string; manager: string;
  pool_points: number; predict_points: number; total_points: number; rounds_scored: number;
}
