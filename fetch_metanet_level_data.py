"""Copy the wiki's Metanet import strings to individual static text files."""
from __future__ import annotations

import html
import re
import time
from pathlib import Path

import requests

from fetch_metanet_level_metadata import chunks, level_display_id, request_json, USER_AGENT


OUTPUT = Path(__file__).resolve().parent / 'site' / 'level-data'


def extract_level_data(wikitext: str, display_id: str) -> str:
    section = re.search(r'^==\s*Level data\s*==\s*$(.*?)(?=^==[^=]|\Z)', wikitext, re.I | re.M | re.S)
    # Some source pages omit </code> before their category tags. The import
    # string is one line ending in #, so exclude any trailing wiki markup.
    code = re.search(rf'<code\b[^>]*>\s*([%$]?{re.escape(display_id)}:[^\r\n]*#)', section[1], re.I) if section else None
    if not code:
        raise ValueError(f'No Level data code block found on {display_id}.')
    value = html.unescape(code[1]).strip()
    # The wiki contains both %...#...# and $...#metanet#Nv2#...# formats.
    # Preserve the published string instead of converting either format.
    if not re.match(rf'^[%$]?{re.escape(display_id)}:', value, re.I) or not value.endswith('#') or value.count('#') < 2 or len(value) < 700:
        raise ValueError(f'Unexpected import-string format on {display_id}.')
    if '\n' in value or '\r' in value or '<code' in value.lower():
        raise ValueError(f'Unexpected markup or line breaks in {display_id} import data.')
    return value


def fetch() -> None:
    session = requests.Session()
    session.headers.update({'User-Agent': USER_AGENT})
    titles = [level_display_id(i) for i in range(1, 601)]
    strings = {}
    errors = []
    for batch in chunks(titles, 50):
        payload = request_json(session, {
            'action':'query', 'titles':'|'.join(batch), 'prop':'revisions',
            'rvprop':'content', 'rvslots':'main', 'format':'json',
        })
        for page in payload.get('query', {}).get('pages', {}).values():
            title = page['title'].lower()
            text = page['revisions'][0]['slots']['main']['*']
            try:
                strings[title] = extract_level_data(text, title)
            except ValueError as error:
                errors.append(str(error))
        print(f'Fetched {len(strings)}/600 wiki import strings.', flush=True)
        time.sleep(0.25)
    if errors:
        raise RuntimeError('\n'.join(errors))
    if set(strings) != set(titles):
        raise RuntimeError('The wiki did not return all 600 Metanet levels.')
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for i, title in enumerate(titles, start=1):
        # No added newline: the copied value is the exact wiki import string.
        (OUTPUT / f'{i:06d}.txt').write_text(strings[title], encoding='utf-8', newline='')
    print(f'Saved all 600 level-data files ({sum(len(s.encode("utf-8")) for s in strings.values())} bytes).')


if __name__ == '__main__':
    fetch()
