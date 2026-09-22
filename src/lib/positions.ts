export const POSITION_GROUPS = [
  "FRONT_ROW",
  "LOCK",
  "LOOSE",
  "HALVES",
  "CENTRE",
  "BACK_THREE",
] as const;

export type PositionGroup = (typeof POSITION_GROUPS)[number];

export const GROUP_LABELS: Record<PositionGroup, string> = {
  FRONT_ROW: "Front row",
  LOCK: "Lock",
  LOOSE: "Loose forward",
  HALVES: "Halfback",
  CENTRE: "Centre",
  BACK_THREE: "Back three",
};

/** How many of each group a legal starting XV needs. */
export const STARTING_XV: Record<PositionGroup, number> = {
  FRONT_ROW: 3,
  LOCK: 2,
  LOOSE: 3,
  HALVES: 2,
  CENTRE: 2,
  BACK_THREE: 3,
};

export const BENCH_SIZE = 4;
export const SALARY_CAP = 100;

/**
 * Unions publish positions in whatever shape they like: "Loosehead Prop",
 * "Flyhalf/Fullback", "8th Man", "10/12/15". Map the first thing we recognise.
 */
export function toPositionGroup(raw: string): PositionGroup {
  const s = raw.toLowerCase();
  const rules: [RegExp, PositionGroup][] = [
    [/prop|hooker|loosehead|tighthead|\bfront row\b/, "FRONT_ROW"],
    [/lock|second row/, "LOCK"],
    [/flank|loose ?forward|number ?8|8th ?man|eighthman|no\.? ?8/, "LOOSE"],
    [/scrum ?-?half|fly ?-?half|flyhalf|scrumhalf|half ?back|\b9\b|\b10\b/, "HALVES"],
    [/centre|center|\b12\b|\b13\b/, "CENTRE"],
    [/wing|full ?-?back|fullback|back ?three|\b11\b|\b14\b|\b15\b/, "BACK_THREE"],
  ];
  for (const [re, group] of rules) if (re.test(s)) return group;
  // Unknown positions land in the loose forwards, the most forgiving slot.
  return "LOOSE";
}
