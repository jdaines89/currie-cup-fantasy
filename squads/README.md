# Squad files

No free sports API publishes Currie Cup rosters, so squads are loaded from CSV.

```
npm run import:roster -- squads/lions.csv
```

Columns are `team,name,position`. The `team` column accepts either spelling the
database knows: the feed's name (`Golden Lions`) or the 2026 competition name
(`Lions`). Positions are free text — `Loosehead Prop`, `8th Man`, `Flyhalf/Fullback`
all work, and get mapped onto a fantasy position group.

Three squads already ship in `data/seed/rosters-2026.json` and load with
`npm run seed`:

| Union            | Players | Read from                                   |
|------------------|---------|---------------------------------------------|
| Cheetahs         | 35      | fscheetahs.co.za/players                    |
| Griquas          | 34      | griquasrugby.co.za/players                  |
| Boland Cavaliers | 46      | en.wikipedia.org/wiki/Boland_Cavaliers      |

The other five unions' sites sit behind bot checks, so their squads have to be
copied by hand. Each union publishes a `/players` page; pasting it into a
spreadsheet and saving as CSV takes a couple of minutes per side.
