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

The builder reads only the `Level Data` sheet and writes `site/user_leaderboards.json`. It keeps player-level totals and rankings data, not each level's leaderboard. It uses the player-name columns for positions, checks only whether column S is blank for Elite Levels, and checks whether column D is blank for Lone Wolfs. It ignores numeric scores.

## Preview locally

Because the pages fetch the CSV, serve the `site` folder over HTTP instead of opening an HTML file directly:

```powershell
python -m http.server 8000 --directory site
```

Then open `http://localhost:8000`.

## Publish with GitHub Pages

The workflow in `.github/workflows/deploy-pages.yml` publishes the `site` folder on pushes to `main`. After adding this project to a GitHub repository, set **Settings → Pages → Source** to **GitHub Actions**. Pushing the site files and updated CSV will then publish the refreshed leaderboards.

## Typeface

The site uses Uni 05_53 by Craig Kroeger / Miniml as a self-hosted webfont. Use on the public GitHub Pages site is authorized by the font license holder. Attribution is included in `site/fonts/ATTRIBUTION.txt`.
