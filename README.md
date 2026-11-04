# NV2 Metanet Records

A static campaign leaderboard for the 600 official Metanet levels. The site reads `site/metanet_leaderboards.csv` directly, so regenerating the data refreshes the local site files without a separate build step.

## Refresh the data

Run from this folder:

```powershell
python .\scrape_metanet_leaderboards.py
```

The script writes `metanet_leaderboards.csv` and copies a successful, complete pull to `site/metanet_leaderboards.csv`. When connected to this Git repository, it then commits and pushes both CSV files; GitHub Pages deploys the site from that update. Placement values are zero-based leaderboard row positions. Site metrics use usernames, level IDs, and positions only; they do not inspect scores or detect ties. The website counts each distinct level where a player appears in the server’s top ten as one board.

The site has 0ths, Total Boards, Points, and Average Place standings for Metanet levels. Points award 10 through 1 for positions 0 through 9. Average Place averages a player’s listed zero-based positions; lower averages rank first, with total boards as the tiebreaker. User levels currently have no data.

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
