import { teamBrand, showOfficialLogos } from "@/lib/team-brand";

interface TeamLike { id: string; display_name: string; short_name: string }

/** The union's crest: the official badge, or a jersey-colour disc with its initials. */
export function Crest({ team, size = 26 }: { team: TeamLike; size?: number }) {
  const brand = teamBrand(team.id);
  const style = { width: size, height: size };
  if (brand.badge && showOfficialLogos()) {
    return <img className="crest" src={brand.badge} alt="" style={style} loading="lazy" />;
  }
  return (
    <span
      className="crest disc"
      style={{ ...style, background: brand.primary, color: brand.ink, fontSize: size * 0.36 }}
      aria-hidden
    >
      {team.short_name}
    </span>
  );
}

/** Crest plus name, with the name on the side the crest should sit. */
export function Team({ team, align = "left", bold = true }: {
  team: TeamLike | undefined; align?: "left" | "right"; bold?: boolean;
}) {
  if (!team) return null;
  const name = bold ? <strong>{team.display_name}</strong> : <span>{team.display_name}</span>;
  return (
    <span className={`team ${align}`}>
      {align === "right" ? <>{name}<Crest team={team} /></> : <><Crest team={team} />{name}</>}
    </span>
  );
}

/** Inline style giving a row a stripe in the team's jersey colour. */
export function stripe(id: string) {
  return { boxShadow: `inset 4px 0 0 ${teamBrand(id).primary}` };
}
