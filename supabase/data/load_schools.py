"""Turns a cleaned EMIS school list into the JSON rows public.schools loads.

Usage: python3 supabase/data/load_schools.py ec_schools_clean.csv EC > supabase/data/schools_ec.json

Load it with the SQL in supabase/data/README.md.

The CSV is the cleaned provincial list (see the notes in the project files):
coordinates fixed, towns canonical, contact details already removed. ECD
centres are skipped: players represent primary and high schools only.
"""
import csv
import json
import re
import sys

SMALL = {"of", "and", "the", "for", "de", "van", "der"}


def nice(name: str) -> str:
    """BALENI JUNIOR SECONDARY SCHOOL -> Baleni Junior Secondary School."""
    words = []
    for i, w in enumerate(name.lower().split()):
        w = re.sub(r"(^|[-(/])([a-z])", lambda m: m.group(1) + m.group(2).upper(), w)
        if i and w.lower() in SMALL:
            w = w.lower()
        words.append(w)
    return " ".join(words)


path, province = sys.argv[1], sys.argv[2]
rows = []
with open(path, newline="") as f:
    for r in csv.DictReader(f):
        if r["phase"] == "Ecd":
            continue
        special = r["phase"].startswith("Special")
        primary = r["phase"] in ("Primary School", "Combined School") or special
        matric = r["has_matric"] == "True" or special
        quint = r["quintile"][1:] if re.fullmatch(r"Q[1-5]", r["quintile"] or "") else ""
        rows.append({
            "emis": r["emis"], "name": nice(r["name"]), "town": nice(r["town"]) or None, "province": province,
            "district": nice(r["district"]) or None, "no_fee": r["fee"] == "No Fee",
            "quintile": int(quint) if quint else None, "offers_primary": primary, "offers_matric": matric,
            "lat": float(r["lat"]) if r["lat"] else None, "lon": float(r["lon"]) if r["lon"] else None,
            "learners": int(float(r["learners_2025"])) if r["learners_2025"] else None,
            "source": f"EMIS {province} school list 2025",
        })

json.dump(rows, sys.stdout, separators=(",", ":"), ensure_ascii=False)
print()
