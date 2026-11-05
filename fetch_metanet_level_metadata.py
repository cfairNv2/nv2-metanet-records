"""Fetch all Metanet level names and their wiki images for the static site."""
from __future__ import annotations

import json
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any
from urllib.parse import quote

import requests


ROOT = Path(__file__).resolve().parent
SITE_DIR = ROOT / "site"
IMAGE_DIR = SITE_DIR / "images"
METADATA_PATH = SITE_DIR / "metanet_level_metadata.json"
API_URL = "https://nv2.fandom.com/api.php"
USER_AGENT = "Nv2MetanetRecords/1.0 (static leaderboard metadata fetcher)"
IMAGE_ACCEPT = "image/avif,image/webp,image/apng,image/*,*/*;q=0.8"
LEVEL_COUNT = 600
API_BATCH_SIZE = 50
IMAGE_WORKERS = 6
LEVEL_LINE = re.compile(r"^\s*\*\s+\[\[([0-9a-z]{2}-[0-4])(?:\|[^\]]+)?\]\]\s*-?\s*(.*?)\s*$", re.IGNORECASE)
MIME_EXTENSIONS = {
    "image/png": ".png",
    "image/webp": ".webp",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
}


def level_display_id(level_number: int) -> str:
    episode = (level_number - 1) // 5
    alphabet = "0123456789abcdefghijklmnopqrstuvwxyz"
    episode_prefix = alphabet[episode // 10]
    episode_suffix = episode % 10
    stage = (level_number - 1) % 5
    return f"{episode_prefix}{episode_suffix}-{stage}"


def request_json(session: requests.Session, params: dict[str, str]) -> dict[str, Any]:
    last_error: Exception | None = None
    for attempt in range(4):
        try:
            response = session.get(API_URL, params=params, timeout=40)
            response.raise_for_status()
            payload = response.json()
            if "error" in payload:
                raise RuntimeError(f"Wiki API error: {payload['error']}")
            return payload
        except (requests.RequestException, ValueError, RuntimeError) as exc:
            last_error = exc
            if attempt < 3:
                time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"Wiki API request failed after retries: {last_error}")


def level_names(session: requests.Session) -> dict[str, str]:
    payload = request_json(session, {
        "action": "parse",
        "page": "List_of_levels",
        "prop": "wikitext",
        "format": "json",
    })
    wikitext = payload.get("parse", {}).get("wikitext", {}).get("*")
    if not isinstance(wikitext, str):
        raise RuntimeError("The wiki did not return the level list text.")

    names: dict[str, str] = {}
    for line in wikitext.splitlines():
        match = LEVEL_LINE.match(line)
        if not match:
            continue
        display_id, name = match.groups()
        name = name.replace("\u00a0", " ").strip()
        name = re.sub(r"\s*\[edit\].*$", "", name, flags=re.IGNORECASE).strip()
        name = re.sub(r"\s+\(by\s+[^)]+\)\s*$", "", name, flags=re.IGNORECASE).strip()
        if name:
            names[display_id.lower()] = name

    expected = {level_display_id(number) for number in range(1, LEVEL_COUNT + 1)}
    missing = sorted(expected - names.keys())
    if missing:
        raise RuntimeError(f"The wiki level list is missing {len(missing)} names: {', '.join(missing[:12])}")
    return {display_id: names[display_id] for display_id in sorted(expected)}


def chunks(values: list[str], size: int):
    for start in range(0, len(values), size):
        yield values[start:start + size]


def choose_image(page_title: str, images: list[dict[str, str]]) -> dict[str, str] | None:
    if not images:
        return None
    slug = page_title.lower()
    matching = [image for image in images if Path(image.get("title", "")).stem.lower() == slug]
    return (matching or images)[0]


def page_images(session: requests.Session, titles: list[str]) -> dict[str, str]:
    result: dict[str, str] = {}
    for title_batch in chunks(titles, API_BATCH_SIZE):
        payload = request_json(session, {
            "action": "query",
            "titles": "|".join(title_batch),
            "prop": "images",
            "imlimit": "50",
            "format": "json",
        })
        for page in payload.get("query", {}).get("pages", {}).values():
            title = str(page.get("title", "")).lower()
            display_id = title.replace(" ", "_")
            image = choose_image(display_id, page.get("images", []))
            if image:
                result[display_id] = image["title"]
        print(f"Found wiki images for {min(len(result), len(titles))}/{len(titles)} levels.")
    return result


def image_details(session: requests.Session, file_titles: list[str]) -> dict[str, dict[str, str]]:
    result: dict[str, dict[str, str]] = {}
    for title_batch in chunks(file_titles, API_BATCH_SIZE):
        payload = request_json(session, {
            "action": "query",
            "titles": "|".join(title_batch),
            "prop": "imageinfo",
            "iiprop": "url|mime|size",
            "format": "json",
        })
        for page in payload.get("query", {}).get("pages", {}).values():
            info = (page.get("imageinfo") or [{}])[0]
            if info.get("url"):
                result[str(page.get("title", "")).lower()] = {
                    "url": info["url"],
                    "mime": info.get("mime", ""),
                    "descriptionurl": info.get("descriptionurl", ""),
                }
    return result


def image_extension(content: bytes, content_type: str, fallback_mime: str) -> str:
    if content.startswith(b"RIFF") and content[8:12] == b"WEBP":
        return ".webp"
    if content.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if content.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if content.startswith((b"GIF87a", b"GIF89a")):
        return ".gif"
    mime = content_type.split(";", 1)[0].strip().lower() or fallback_mime.lower()
    if mime in MIME_EXTENSIONS:
        return MIME_EXTENSIONS[mime]
    raise RuntimeError(f"Unsupported image type: {mime or 'unknown'}")


def download_image(display_id: str, file_title: str, details: dict[str, str]) -> tuple[str, str, int]:
    response = requests.get(
        details["url"],
        headers={"User-Agent": USER_AGENT, "Accept": IMAGE_ACCEPT},
        timeout=60,
    )
    response.raise_for_status()
    content = response.content
    extension = image_extension(content, response.headers.get("Content-Type", ""), details.get("mime", ""))
    path = IMAGE_DIR / f"{display_id}{extension}"
    path.write_bytes(content)
    return display_id, path.relative_to(SITE_DIR).as_posix(), len(content)


def fetch() -> tuple[int, int, int]:
    SITE_DIR.mkdir(parents=True, exist_ok=True)
    IMAGE_DIR.mkdir(parents=True, exist_ok=True)
    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})

    names = level_names(session)
    display_ids = [level_display_id(number) for number in range(1, LEVEL_COUNT + 1)]
    image_by_level = page_images(session, display_ids)
    missing_images = sorted(set(display_ids) - image_by_level.keys())
    if missing_images:
        raise RuntimeError(f"The wiki has no image entry for {len(missing_images)} levels: {', '.join(missing_images[:12])}")

    file_titles = sorted(set(image_by_level.values()))
    details_by_file = image_details(session, file_titles)
    missing_details = sorted(title for title in set(file_titles) if title.lower() not in details_by_file)
    if missing_details:
        raise RuntimeError(f"The wiki returned no image URLs for {len(missing_details)} files: {', '.join(missing_details[:12])}")

    metadata: dict[str, dict[str, str]] = {}
    total_bytes = 0
    errors: list[str] = []
    with ThreadPoolExecutor(max_workers=IMAGE_WORKERS) as executor:
        futures = {
            executor.submit(download_image, display_id, image_by_level[display_id], details_by_file[image_by_level[display_id].lower()]): display_id
            for display_id in display_ids
        }
        for completed, future in enumerate(as_completed(futures), start=1):
            display_id = futures[future]
            try:
                _, image_path, size = future.result()
                total_bytes += size
                file_title = image_by_level[display_id]
                file_info = details_by_file[file_title.lower()]
                metadata[str(display_ids.index(display_id) + 1).zfill(6)] = {
                    "name": names[display_id],
                    "image": image_path,
                    "wiki": f"https://nv2.fandom.com/wiki/{quote(display_id, safe='-')}",
                    "imageSource": file_info["descriptionurl"] or f"https://nv2.fandom.com/wiki/{quote(file_title.replace(' ', '_'), safe=':-_')}" ,
                }
            except Exception as exc:  # Keep processing so the full set of failures is reported.
                errors.append(f"{display_id}: {exc}")
            if completed % 50 == 0 or completed == LEVEL_COUNT:
                print(f"Downloaded {completed}/{LEVEL_COUNT} level images.")

    if errors:
        raise RuntimeError(f"Failed to download {len(errors)} level images:\n" + "\n".join(errors[:20]))
    if len(metadata) != LEVEL_COUNT:
        raise RuntimeError(f"Expected {LEVEL_COUNT} metadata entries, got {len(metadata)}.")

    ordered_metadata = {level_id: metadata[level_id] for level_id in sorted(metadata)}
    with METADATA_PATH.open("w", encoding="utf-8", newline="\n") as metadata_file:
        json.dump(ordered_metadata, metadata_file, ensure_ascii=False, indent=2)
        metadata_file.write("\n")

    return len(metadata), len(file_titles), total_bytes


if __name__ == "__main__":
    level_count, image_file_count, byte_count = fetch()
    print(f"Saved metadata for {level_count} levels.")
    print(f"Downloaded {image_file_count} unique wiki images ({byte_count:,} bytes).")
    print(f"Metadata: {METADATA_PATH}")
    print(f"Images: {IMAGE_DIR}")
