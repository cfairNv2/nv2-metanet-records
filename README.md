# NV2 Leaderboards

A static site with leaderboards for the 600 official Metanet levels and user-created levels. The site reads `site/metanet_leaderboards.csv` and a compact user-level summary file; it does not publish every user-level leaderboard row.

## Refresh the data

Run from this folder:

```powershell
python .\scrape_metanet_leaderboards.py
```

The script writes `metanet_leaderboards.csv` and copies a successful, complete pull to `site/metanet_leaderboards.csv`. When connected to this Git repository, it then commits and pushes both CSV files; GitHub Pages deploys the site from that update. Placement values are zero-based leaderboard row positions. Site metrics use usernames, level IDs, and positions only; they do not inspect scores or detect ties. The website counts each distinct level where a player appears in the server’s top ten as one board.

The Metanet standings are 0ths, Total Boards, Points, and Average Place. Metanet Average Place has a Filtered/Unfiltered toggle; Filtered hides players with fewer than 20 boards. User levels add Elite Levels and Lone Wolfs, and User Average Place always hides players with fewer than 100 boards. Points award 10 through 1 for places 0 through 9. Average Place averages a player's listed zero-based places, ranks lower averages first, and uses total boards as the tiebreaker. Each leaderboard displays its top 1,000 players.

## Refresh user-level summaries

Run from this folder after updating `Nv2 Stats.xlsx`:

```powershell
python .\build_user_leaderboards.py
```

The builder reads only the `Level Data` sheet and writes player summaries to `site/user_leaderboards.json`. It writes level IDs, places, and frame gaps for Elite Levels and Lone Wolfs separately to `site/user_level_details.json`; the site loads that larger file only on those detail pages. It uses the player-name columns for places, checks whether column S is blank for Elite Levels, and checks whether column D is blank for Lone Wolfs. Numeric scores are used only to calculate the requested frames-behind-0th values.

## Preview locally

Because the pages fetch the CSV, serve the `site` folder over HTTP instead of opening an HTML file directly:

```powershell
python preview_site.py
```

Then open `http://localhost:8000/home`. The preview server supports the same direct paths and fallback as Pages.

## Publish with GitHub Pages

The workflow in `.github/workflows/deploy-pages.yml` publishes the `site` folder on pushes to `main`. After adding this project to a GitHub repository, set **Settings → Pages → Source** to **GitHub Actions**. Pushing the site files and updated CSV will then publish the refreshed leaderboards.

## Metanet level import data

Every Metanet level page shows its wiki import string below the leaderboard
and image, with horizontal scrolling and a copy button. The 600 static files
in `site/level-data/` are fetched individually when a level page is opened.
They reproduce the **Level data** text from the corresponding
[Nv2 Wiki](https://nv2.fandom.com/wiki/00-0) pages, preserving the wiki's formats.
Run `python fetch_metanet_level_data.py` to refresh all 600 strings from the wiki.
The automatic leaderboard updater does not change these files.

## Typeface

The site uses Uni 05_53 by Craig Kroeger / Miniml as a self-hosted webfont. Use on the public GitHub Pages site is authorized by the font license holder. Attribution is included in `site/fonts/ATTRIBUTION.txt`.

## Page addresses

The account site at `https://cfairnv2.github.io/home` provides the short addresses.
Its HTML entry points use the shared app, styles, images, and live static data
from this repository's Pages deployment. The private updater continues to
publish its existing four data files here; both addresses read those files.
The root site's HTML mirrors `site/index.html` and its fallback mirrors
`site/404.html`; update those entry points when changing shared HTML markup.

- `/home`: home page
- `/metanet` and `/userlevel`: leaderboards
- `/metanet/user/Cfair` and `/userlevel/user/Cfair`: player statistics
- `/metanet/user/Cfair/0ths`: a player's Metanet 0th list
- `/metanet/level/00-0`: a Metanet level leaderboard

Other metrics use readable suffixes such as `/metanet/average-place` and
`/userlevel/elite-levels`. Existing `.html` links and query parameters still
open the same views. Player names are case insensitive and URL encoded.
GitHub Pages' custom 404 redirects direct path requests through the entry page,
then restores the clean URL before the app renders.
