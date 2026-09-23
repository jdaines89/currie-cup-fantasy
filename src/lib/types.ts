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
export interface Member { user_id: string; email: string; display_name: string; is_admin: boolean; email_reminders: boolean }
export interface ChatMessage { id: number; author_id: string; body: string; created_at: string }
export interface Entry { id: number; user_id: string; season: string; team_name: string }
export interface Prediction { entry_id: number; match_id: string; home_score: number; away_score: number; is_banker: boolean }
export interface StandingRow {
  team_id: string; played: number; won: number; drawn: number; lost: number;
  points_for: number; points_against: number; diff: number;
  log_points: number; points_exact: boolean; position: number;
}
export interface LeaderRow {
  entry_id: number; team_name: string; manager: string;
  total_points: number; right_results: number; exact_scores: number; rounds_scored: number;
}
