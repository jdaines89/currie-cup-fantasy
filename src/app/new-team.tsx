import { createEntry } from "@/lib/actions";

export function NewTeamForm({ heading = "Start a team" }: { heading?: string }) {
  return (
    <div className="card">
      <h2>{heading}</h2>
      <p className="sub">
        One entry plays both games: the union pool and the player squad. Add more
        entries to play against someone.
      </p>
      <form action={createEntry} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input name="manager" placeholder="Your name" required />
        <input name="team_name" placeholder="Team name" required />
        <button type="submit">Create</button>
      </form>
    </div>
  );
}
