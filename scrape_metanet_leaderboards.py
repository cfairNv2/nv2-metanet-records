"""Download the top ten leaderboard entries for the 600 Metanet campaign levels.

The CSV is normalized to one row per leaderboard entry. Levels with no entries
still get a row so the output always represents all 600 requested levels.
"""

import argparse
import csv
import shutil
import subprocess
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import requests


FIRST_LEVEL = 1
LAST_LEVEL = 600
LEADERBOARD_LIMIT = 10
DEFAULT_OUTPUT = Path(__file__).with_name("metanet_leaderboards.csv")
SITE_OUTPUT = Path(__file__).with_name("site") / "metanet_leaderboards.csv"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
}

thread_local = threading.local()


def level_to_path(level: int) -> str:
    """Convert a level number to the six-digit path used by the game server."""
    level_id = f"{level:06d}"
    return f"{level_id[0]}/{level_id[1:3]}/{level_id[3:6]}.txt"


def decode_leaderboard_bytes(data: bytes) -> list[tuple[str, int]]:
    """Read player names and frame counts, skipping user IDs."""
    entries = []
    offset = 0

    while offset + 7 < len(data):
        frames = int.from_bytes(data[offset:offset + 3], "big")
        offset += 7

        name_bytes = []
        while offset < len(data) and data[offset] > 0x1F:
            name_bytes.append(data[offset])
            offset += 1

        player = bytes(name_bytes).decode("utf-8", errors="replace")
        entries.append((player, frames))

    return entries[:LEADERBOARD_LIMIT]


def get_session() -> requests.Session:
    session = getattr(thread_local, "session", None)
    if session is None:
        session = requests.Session()
        session.headers.update(HEADERS)
        thread_local.session = session
    return session


def fetch_level(level: int, retries: int = 3) -> tuple[int, list[tuple[str, int]], str]:
    url = f"http://nserver.thewayoftheninja.org/highscores/{level_to_path(level)}"
    last_error = "request_error"

    for attempt in range(retries + 1):
        try:
            response = get_session().get(url, timeout=(5, 20))
            if response.status_code == 200:
                entries = decode_leaderboard_bytes(response.content) if response.content else []
                return level, entries, "ok" if entries else "empty"

            if response.status_code == 429 or response.status_code >= 500:
                last_error = f"http_{response.status_code}"
                if attempt < retries:
                    time.sleep(min(2 ** attempt, 8))
                    continue
            return level, [], f"http_{response.status_code}"
        except requests.RequestException as exc:
            last_error = type(exc).__name__
            if attempt < retries:
                time.sleep(min(2 ** attempt, 8))
                continue

    return level, [], last_error


def rows_for_level(
    level: int, entries: list[tuple[str, int]], status: str
) -> list[dict[str, str | int]]:
    level_id = f"{level:06d}"
    if not entries:
        return [{
            "level_id": level_id,
            "rank": "",
            "player": "",
            "frames": "",
            "is_0th": "false",
            "fetch_status": status,
        }]

    rows = []
    for place_index, (player, frames) in enumerate(entries):
        rows.append({
            "level_id": level_id,
            "rank": place_index,
            "player": player,
            "frames": frames,
            "is_0th": "true" if place_index == 0 else "false",
            "fetch_status": status,
        })
    return rows


def publish_updated_csv(output_path: Path) -> bool:
    """Commit updated CSV files and push them so GitHub Pages can redeploy."""
    project_dir = Path(__file__).resolve().parent
    files_to_publish = [SITE_OUTPUT.resolve().relative_to(project_dir).as_posix()]

    try:
        output_relative = output_path.resolve().relative_to(project_dir).as_posix()
        if output_relative not in files_to_publish:
            files_to_publish.append(output_relative)
    except ValueError:
        # A custom CSV path outside the project is saved locally but not tracked.
        pass

    try:
        subprocess.run(
            ["git", "rev-parse", "--is-inside-work-tree"],
            cwd=project_dir,
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        subprocess.run(
            ["git", "add", "--", *files_to_publish],
            cwd=project_dir,
            check=True,
        )
    except (OSError, subprocess.CalledProcessError) as exc:
        print(f"Could not stage website data for publishing: {exc}")
        return False

    changed = subprocess.run(
        ["git", "diff", "--cached", "--quiet", "--", *files_to_publish],
        cwd=project_dir,
        check=False,
    )
    if changed.returncode == 1:
        commit = subprocess.run(
            [
                "git",
                "-c",
                "commit.gpgsign=false",
                "commit",
                "--only",
                "-m",
                "Refresh Metanet leaderboard data",
                "--",
                *files_to_publish,
            ],
            cwd=project_dir,
            check=False,
        )
        if commit.returncode != 0:
            print("Could not create a Git commit for the updated website data.")
            return False
    elif changed.returncode != 0:
        print("Could not check whether the website data changed.")
        return False
    else:
        print("Leaderboard CSV files did not change; checking for pending commits to publish.")

    push = subprocess.run(["git", "push"], cwd=project_dir, check=False)
    if push.returncode != 0:
        print("CSV files are updated locally, but GitHub did not accept the push.")
        return False

    print("GitHub Pages update requested. The site will refresh after the deployment workflow finishes.")
    return True


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Pull leaderboard data for Metanet campaign levels 000001–000600."
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT,
        help=f"CSV output path (default: {DEFAULT_OUTPUT})",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=10,
        help="Number of concurrent requests (default: 10)",
    )
    args = parser.parse_args()

    if args.workers < 1:
        parser.error("--workers must be at least 1")

    fetched: dict[int, tuple[list[tuple[str, int]], str]] = {}
    print(f"Fetching Metanet leaderboards for levels {FIRST_LEVEL:06d}-{LAST_LEVEL:06d}...")

    with ThreadPoolExecutor(max_workers=args.workers) as executor:
        futures = {
            executor.submit(fetch_level, level): level
            for level in range(FIRST_LEVEL, LAST_LEVEL + 1)
        }
        for completed, future in enumerate(as_completed(futures), start=1):
            level, entries, status = future.result()
            fetched[level] = (entries, status)
            if completed % 50 == 0 or completed == LAST_LEVEL:
                print(f"Fetched {completed}/{LAST_LEVEL} levels")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = ["level_id", "rank", "player", "frames", "is_0th", "fetch_status"]
    failed = 0
    empty = 0
    with args.output.open("w", newline="", encoding="utf-8-sig") as csv_file:
        writer = csv.DictWriter(csv_file, fieldnames=fieldnames)
        writer.writeheader()
        for level in range(FIRST_LEVEL, LAST_LEVEL + 1):
            entries, status = fetched[level]
            writer.writerows(rows_for_level(level, entries, status))
            failed += status not in ("ok", "empty")
            empty += status == "empty"

    print(f"CSV saved: {args.output}")
    print(f"Levels written: {LAST_LEVEL - FIRST_LEVEL + 1}")
    print(f"Levels with leaderboard entries: {sum(bool(entries) for entries, _ in fetched.values())}")
    print(f"Levels with no entries: {empty}")
    print(f"Levels with fetch errors: {failed}")
    if failed == 0:
        SITE_OUTPUT.parent.mkdir(parents=True, exist_ok=True)
        if args.output.resolve() != SITE_OUTPUT.resolve():
            shutil.copyfile(args.output, SITE_OUTPUT)
        print(f"Website data updated: {SITE_OUTPUT}")
        published = publish_updated_csv(args.output)
    else:
        print("Website data was left unchanged because some level requests failed.")
        published = False
    return 1 if failed or not published else 0


if __name__ == "__main__":
    raise SystemExit(main())
