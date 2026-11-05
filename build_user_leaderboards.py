"""Build compact user-level leaderboard summaries from Nv2 Stats.xlsx."""

from __future__ import annotations

import json
import math
from collections import Counter
from pathlib import Path

from openpyxl import load_workbook


ROOT = Path(__file__).resolve().parent
WORKBOOK_PATH = ROOT / "Nv2 Stats.xlsx"
OUTPUT_PATH = ROOT / "site" / "user_leaderboards.json"
DETAILS_OUTPUT_PATH = ROOT / "site" / "user_level_details.json"
SHEET_NAME = "Level Data"


def clean_name(value: object) -> str:
    return "" if value is None else str(value).strip()


def numeric_frame(value: object) -> int | float | None:
    if value is None or isinstance(value, bool) or str(value).strip() == "":
        return None
    try:
        frame = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(frame):
        return None
    return int(frame) if frame.is_integer() else frame


def export() -> tuple[int, int, int, int]:
    workbook = load_workbook(WORKBOOK_PATH, read_only=True, data_only=True)
    stats: dict[str, dict[str, object]] = {}
    seen_levels: set[int] = set()
    duplicate_levels = 0

    try:
        sheet = workbook[SHEET_NAME]
        for row in sheet.iter_rows(min_row=2, min_col=1, max_col=21, values_only=True):
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

            # B, D, ..., T contain the names for places 0 through 9. Numeric
            # scores are used only for the requested frames-behind-0th detail.
            # S is checked only for blankness for the Elite Levels rule.
            names = [clean_name(row[1 + place * 2]) for place in range(10)]
            score9_is_blank = row[18] is None or str(row[18]).strip() == ""
            second_place_is_blank = names[1] == ""
            zero_frames = numeric_frame(row[2])

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
                    "placeCounts": [0] * 10,
                    "eliteEntries": [],
                    "loneWolfLevels": [],
                })
                profile["names"][name] += 1
                profile["boards"] += 1
                profile["points"] += 10 - place
                profile["placeTotal"] += place
                profile["placeCounts"][place] += 1
                if place == 0:
                    profile["zeroes"] += 1
                    if second_place_is_blank:
                        profile["loneWolfs"] += 1
                        profile["loneWolfLevels"].append(level_id)
                if score9_is_blank:
                    profile["eliteLevels"] += 1
                    player_frames = numeric_frame(row[2 + place * 2])
                    behind_zero = player_frames - zero_frames if player_frames is not None and zero_frames is not None else None
                    profile["eliteEntries"].append({
                        "levelId": level_id,
                        "place": place,
                        "framesBehindZero": behind_zero,
                    })

    finally:
        workbook.close()

    players = []
    level_details = {}
    for profile in stats.values():
        variants = profile.pop("names")
        profile["name"] = sorted(variants.items(), key=lambda item: (-item[1], item[0].casefold(), item[0]))[0][0]
        boards = profile["boards"]
        profile["averagePlace"] = profile.pop("placeTotal") / boards if boards else None
        profile["eliteEntries"].sort(key=lambda entry: entry["levelId"])
        profile["loneWolfLevels"].sort()
        if profile["eliteEntries"] or profile["loneWolfLevels"]:
            level_details[profile["key"]] = {
                "elite": [[entry["levelId"], entry["place"], entry["framesBehindZero"]] for entry in profile.pop("eliteEntries")],
                "wolves": profile.pop("loneWolfLevels"),
            }
        else:
            profile.pop("eliteEntries")
            profile.pop("loneWolfLevels")
        players.append(profile)

    players.sort(key=lambda player: (player["key"], player["name"].casefold()))
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT_PATH.open("w", encoding="utf-8", newline="\n") as output_file:
        json.dump({"levels": len(seen_levels), "players": players}, output_file, ensure_ascii=False, separators=(",", ":"))
        output_file.write("\n")
    with DETAILS_OUTPUT_PATH.open("w", encoding="utf-8", newline="\n") as output_file:
        json.dump({"players": level_details}, output_file, ensure_ascii=False, separators=(",", ":"))
        output_file.write("\n")

    return len(seen_levels), len(players), duplicate_levels, len(level_details)


if __name__ == "__main__":
    level_count, player_count, duplicate_count, detail_count = export()
    print(f"Saved {OUTPUT_PATH} and {DETAILS_OUTPUT_PATH}")
    print(f"User levels: {level_count:,}; players: {player_count:,}; duplicate level rows skipped: {duplicate_count:,}")
    print(f"Summary size: {OUTPUT_PATH.stat().st_size:,} bytes")
    print(f"Players with level details: {detail_count:,}; level details size: {DETAILS_OUTPUT_PATH.stat().st_size:,} bytes")
