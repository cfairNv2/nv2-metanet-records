"""Build compact user-level leaderboard summaries from Nv2 Stats.xlsx."""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

from openpyxl import load_workbook


ROOT = Path(__file__).resolve().parent
WORKBOOK_PATH = ROOT / "Nv2 Stats.xlsx"
OUTPUT_PATH = ROOT / "site" / "user_leaderboards.json"
SHEET_NAME = "Level Data"


def clean_name(value: object) -> str:
    return "" if value is None else str(value).strip()


def export() -> tuple[int, int, int]:
    workbook = load_workbook(WORKBOOK_PATH, read_only=True, data_only=True)
    stats: dict[str, dict[str, object]] = {}
    seen_levels: set[int] = set()
    duplicate_levels = 0

    try:
        sheet = workbook[SHEET_NAME]
        for row in sheet.iter_rows(min_row=2, min_col=1, max_col=20, values_only=True):
            raw_level = row[0]
            if raw_level is None or str(raw_level).strip() == "":
                continue
            try:
                level_id = int(raw_level)
            except (TypeError, ValueError):
                continue
            if level_id < 1000:
                continue
            if level_id in seen_levels:
                duplicate_levels += 1
                continue
            seen_levels.add(level_id)

            # B, D, ..., T contain the player names for places 0 through 9.
            # The score values are deliberately ignored. S is checked only for
            # blankness because the workbook's requested Elite Levels rule uses it.
            names = [clean_name(row[1 + place * 2]) for place in range(10)]
            score9_is_blank = row[18] is None or str(row[18]).strip() == ""
            second_place_is_blank = names[1] == ""

            # Count each player once per level if a malformed row repeats a name.
            ranks_for_level: dict[str, tuple[str, int]] = {}
            for place, name in enumerate(names):
                if not name:
                    continue
                key = name.casefold()
                current = ranks_for_level.get(key)
                if current is None or place < current[1]:
                    ranks_for_level[key] = (name, place)

            for key, (name, place) in ranks_for_level.items():
                profile = stats.setdefault(key, {
                    "key": key,
                    "names": Counter(),
                    "zeroes": 0,
                    "boards": 0,
                    "points": 0,
                    "placeTotal": 0,
                    "eliteLevels": 0,
                    "loneWolfs": 0,
                })
                profile["names"][name] += 1
                profile["boards"] += 1
                profile["points"] += 10 - place
                profile["placeTotal"] += place
                if place == 0:
                    profile["zeroes"] += 1
                    if second_place_is_blank:
                        profile["loneWolfs"] += 1
                if score9_is_blank:
                    profile["eliteLevels"] += 1

    finally:
        workbook.close()

    players = []
    for profile in stats.values():
        variants = profile.pop("names")
        profile["name"] = sorted(variants.items(), key=lambda item: (-item[1], item[0].casefold(), item[0]))[0][0]
        boards = profile["boards"]
        profile["averagePlace"] = profile.pop("placeTotal") / boards if boards else None
        players.append(profile)

    players.sort(key=lambda player: (player["key"], player["name"].casefold()))
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT_PATH.open("w", encoding="utf-8", newline="\n") as output_file:
        json.dump({"levels": len(seen_levels), "players": players}, output_file, ensure_ascii=False, separators=(",", ":"))
        output_file.write("\n")

    return len(seen_levels), len(players), duplicate_levels


if __name__ == "__main__":
    level_count, player_count, duplicate_count = export()
    print(f"Saved {OUTPUT_PATH}")
    print(f"User levels: {level_count:,}; players: {player_count:,}; duplicate level rows skipped: {duplicate_count:,}")
    print(f"Summary size: {OUTPUT_PATH.stat().st_size:,} bytes")
