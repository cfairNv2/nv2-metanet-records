"""Update the date displayed by the static site after a data refresh."""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path


def update_last_updated(metadata_path: Path) -> str:
    last_updated = datetime.now().strftime("%m/%d/%y")
    metadata_path.parent.mkdir(parents=True, exist_ok=True)
    with metadata_path.open("w", encoding="utf-8", newline="\n") as metadata_file:
        json.dump({"lastUpdated": last_updated}, metadata_file, separators=(",", ":"))
        metadata_file.write("\n")
    return last_updated
