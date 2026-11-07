const METANET_CSV_PATH = "metanet_leaderboards.csv";
const USER_DATA_PATH = "user_leaderboards.json";
const numberFormat = new Intl.NumberFormat("en-US", { useGrouping: false });
const averageFormat = new Intl.NumberFormat("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3, useGrouping: false });
const timeFormat = new Intl.NumberFormat("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3, useGrouping: false });
const metanetAverageMinimumBoards = 20;
const userAverageMinimumBoards = 100;
const boards = {
  zeroes: { label: "0ths", metric: "zeroes" },
  boards: { label: "Total Boards", metric: "boards" },
  points: { label: "Points", metric: "points" },
  average: { label: "Average Place", metric: "averagePlace" },
  elite: { label: "Elite Levels", metric: "eliteLevels" },
  loneWolfs: { label: "Lone Wolfs", metric: "loneWolfs" },
};
const availableBoards = {
  metanet: ["zeroes", "boards", "points", "average"],
  user: ["zeroes", "boards", "points", "average", "elite", "loneWolfs"],
};

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(field);
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  row.push(field);
  if (row.some((value) => value !== "")) rows.push(row);
  if (!rows.length) return [];

  const headers = rows.shift().map((header) => header.replace(/^\uFEFF/, "").trim());
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

function buildMetanetDataset(rows) {
  const players = new Map();
  const levelRecords = new Map();

  for (const row of rows) {
    if (row.fetch_status !== "ok" || !row.player.trim()) continue;
    const name = row.player.trim();
    const key = name.toLocaleLowerCase();
    let player = players.get(key);
    if (!player) {
      player = { key, names: new Map(), levels: new Map() };
      players.set(key, player);
    }

    player.names.set(name, (player.names.get(name) || 0) + 1);
    const place = Number(row.rank);
    if (!row.level_id || !Number.isFinite(place)) continue;

    const frames = row.frames?.trim() ? Number(row.frames) : null;
    const levelRows = levelRecords.get(row.level_id) || [];
    levelRows.push({ playerKey: key, place, frames: Number.isFinite(frames) ? frames : null });
    levelRecords.set(row.level_id, levelRows);

    const existing = player.levels.get(row.level_id);
    if (!existing || place < existing.place) {
      player.levels.set(row.level_id, { levelId: row.level_id, place, frames: Number.isFinite(frames) ? frames : null });
    }
  }

  const profiles = [...players.values()].map((player) => {
    const name = [...player.names.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || "Unknown player";
    const entries = [...player.levels.values()];
    const zeroes = entries.filter((entry) => entry.place === 0).length;
    entries.forEach((entry) => {
      const topFrames = levelRecords.get(entry.levelId)?.find((record) => record.place === 0)?.frames;
      entry.isZeroWithTies = entry.place === 0
        || (Number.isFinite(entry.frames) && Number.isFinite(topFrames) && entry.frames === topFrames);
    });
    const zeroesWithTies = entries.filter((entry) => entry.isZeroWithTies).length;
    const points = entries.reduce((total, entry) => total + (entry.place >= 0 && entry.place <= 9 ? 10 - entry.place : 0), 0);
    const placeCounts = Array(10).fill(0);
    entries.forEach((entry) => {
      if (Number.isInteger(entry.place) && entry.place >= 0 && entry.place < placeCounts.length) {
        placeCounts[entry.place] += 1;
      }
    });
    const averagePlace = entries.length
      ? entries.reduce((total, entry) => total + entry.place, 0) / entries.length
      : null;

    return { ...player, name, entries, placeCounts, boards: entries.length, zeroes, zeroesWithTies, points, averagePlace };
  });

  return { profiles, levelRecords };
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function placeLabel(index) {
  if (index === 0) return "0th";
  const place = index;
  const lastTwo = place % 100;
  if (lastTwo >= 11 && lastTwo <= 13) return `${place}th`;
  const suffix = ({ 1: "st", 2: "nd", 3: "rd" })[place % 10] || "th";
  return `${place}${suffix}`;
}

function displayLevelId(levelId) {
  const id = Number(levelId);
  if (!Number.isInteger(id) || id < 1 || id > 600) return levelId;
  const episode = Math.floor((id - 1) / 5);
  const episodePrefix = "0123456789abcdefghijklmnopqrstuvwxyz"[Math.floor(episode / 10)];
  const episodeSuffix = episode % 10;
  const stage = (id - 1) % 5;
  return `${episodePrefix}${episodeSuffix}-${stage}`;
}

function formatSignedFrames(value) {
  if (!Number.isFinite(value)) return "—";
  if (value > 0) return `+${numberFormat.format(value)}`;
  return numberFormat.format(value);
}

function formatTime(frames) {
  return Number.isFinite(frames) ? timeFormat.format(frames / 60) : "—";
}

function currentParams() {
  return window.Nv2Routes.read().params;
}

function currentState() {
  const params = currentParams();
  const levelset = params.get("levels") === "user" ? "user" : "metanet";
  const requestedBoard = Object.hasOwn(boards, params.get("board")) ? params.get("board") : "zeroes";
  return {
    levelset,
    board: availableBoards[levelset].includes(requestedBoard) ? requestedBoard : "zeroes",
    averageFilter: levelset === "metanet" && params.get("average") === "unfiltered" ? "unfiltered" : "filtered",
    zeroesMode: levelset === "metanet" && params.get("zeroes") === "ties" ? "ties" : "pures",
  };
}

let state = currentState();
let datasets = { metanet: [], user: [] };
let levelRecords = new Map();
let userLevelDetails = {};
let metanetLevelMetadata = {};
let metanetLevelCatalog = [];
let metanetLevelById = new Map();

function indexUrl(nextState = state) {
  return window.Nv2Routes.url("leaderboard", nextState);
}

function playerUrl(player, nextState = state) {
  return window.Nv2Routes.url("player", nextState, { id: player.name || player.key });
}

function playerLevelsUrl(player, list, nextState = state) {
  return window.Nv2Routes.url("player-levels", nextState, { id: player.name || player.key, list });
}

function levelUrl(levelId) {
  return window.Nv2Routes.url("level", { levelset: "metanet" }, { id: displayLevelId(levelId) });
}

function buildMetanetLevelCatalog(metadata) {
  return Array.from({ length: 600 }, (_, index) => {
    const id = String(index + 1).padStart(6, "0");
    const details = metadata[id] || {};
    return {
      id,
      displayId: displayLevelId(id),
      name: typeof details.name === "string" ? details.name : "",
      image: typeof details.image === "string" ? details.image : "",
      wiki: typeof details.wiki === "string" ? details.wiki : "",
      imageSource: typeof details.imageSource === "string" ? details.imageSource : "",
    };
  });
}

function activeDataset() {
  return datasets[state.levelset];
}

function metricKey(board, viewState = state) {
  return board === "zeroes" && viewState.levelset === "metanet" && viewState.zeroesMode === "ties"
    ? "zeroesWithTies" : boards[board].metric;
}

function eligiblePlayers(profiles, board, viewState = state) {
  const metric = metricKey(board, viewState);
  if (board === "zeroes" || board === "elite" || board === "loneWolfs") {
    return profiles.filter((player) => player[metric] > 0);
  }
  if (board === "average") {
    if (viewState.levelset === "user") return profiles.filter((player) => player.boards >= userAverageMinimumBoards);
    if (viewState.averageFilter === "filtered") return profiles.filter((player) => player.boards >= metanetAverageMinimumBoards);
  }
  return profiles;
}

function sortPlayers(profiles, board, viewState = state) {
  const metric = metricKey(board, viewState);
  const direction = board === "average" ? 1 : -1;
  return [...profiles].sort((a, b) =>
    direction * ((a[metric] ?? Number.POSITIVE_INFINITY) - (b[metric] ?? Number.POSITIVE_INFINITY))
    || (board === "boards" ? b.zeroes - a.zeroes : b.boards - a.boards)
    || a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  );
}

function formatMetric(player, board, viewState = state) {
  const value = player[metricKey(board, viewState)];
  if (board === "average" && value === null) return "—";
  return board === "average" ? averageFormat.format(value) : numberFormat.format(value);
}

function playerMetricRank(player, board, viewState = state) {
  if (board === "zeroes" && player[metricKey(board, viewState)] === 0) return "—";
  if (board === "elite" && player.eliteLevels === 0) return "—";
  if (board === "loneWolfs" && player.loneWolfs === 0) return "—";
  if (board === "average" && !eligiblePlayers([player], board, viewState).length) return "—";
  const rankedPlayers = sortPlayers(eligiblePlayers(activeDataset(), board, viewState), board, viewState);
  const position = rankedPlayers.findIndex((item) => item.key === player.key);
  return position < 0 ? "—" : placeLabel(position);
}

function renderPlaceHistogram(counts) {
  const places = Array.isArray(counts) ? counts : Array(10).fill(0);
  const chartWidth = 1000;
  const baseline = 238;
  const maxBarHeight = 162;
  const plotLeft = 24;
  const slotWidth = 95;
  const barWidth = 52;
  const maxCount = Math.max(1, ...places.map((count) => Number(count) || 0));
  const description = places.map((count, place) => `${placeLabel(place)}: ${numberFormat.format(count)} boards`).join("; ");
  const gridLines = [0.25, 0.5, 0.75, 1].map((fraction) => {
    const y = baseline - maxBarHeight * fraction;
    return `<line class="histogram-gridline" x1="20" y1="${y}" x2="980" y2="${y}" />`;
  }).join("");
  const bars = places.map((rawCount, place) => {
    const count = Number(rawCount) || 0;
    const height = count > 0 ? Math.max(2, (count / maxCount) * maxBarHeight) : 0;
    const x = plotLeft + place * slotWidth + (slotWidth - barWidth) / 2;
    const y = baseline - height;
    const labelY = Math.max(44, y - 11);
    const center = x + barWidth / 2;
    return `<g class="histogram-bar-group">
      <rect class="histogram-bar" x="${x}" y="${y}" width="${barWidth}" height="${height}" />
      <text class="histogram-value" x="${center}" y="${labelY}" text-anchor="middle">${numberFormat.format(count)}</text>
      <text class="histogram-place" x="${center}" y="274" text-anchor="middle">${placeLabel(place)}</text>
    </g>`;
  }).join("");

  return `<section class="place-histogram" aria-labelledby="place-histogram-heading">
    <h3 id="place-histogram-heading">Boards by place</h3>
    <div class="place-histogram-scroll">
      <svg class="place-histogram-chart" viewBox="0 0 ${chartWidth} 300" role="img" aria-labelledby="place-histogram-title place-histogram-description">
        <title id="place-histogram-title">Boards by place</title>
        <desc id="place-histogram-description">${escapeHtml(description)}</desc>
        ${gridLines}
        <line class="histogram-baseline" x1="20" y1="${baseline}" x2="980" y2="${baseline}" />
        ${bars}
      </svg>
    </div>
  </section>`;
}

function zeroesToggle() {
  return `<div class="average-filter-control zeroes-control">
    <div class="average-filter-toggle" role="group" aria-label="0ths counting">
      <button type="button" data-zeroes-mode="pures" aria-pressed="${state.zeroesMode === "pures"}">Pures</button>
      <button type="button" data-zeroes-mode="ties" aria-pressed="${state.zeroesMode === "ties"}">Ties</button>
    </div>
    <p class="average-filter-note">${state.zeroesMode === "ties" ? "Ties count as 0ths" : "Pure 0ths only"}</p>
  </div>`;
}

function syncControls() {
  document.querySelectorAll("[data-levelset]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.levelset === state.levelset));
  });
  document.querySelectorAll("[data-board]").forEach((button) => {
    const available = availableBoards[state.levelset].includes(button.dataset.board);
    button.hidden = !available;
    button.setAttribute("aria-selected", String(button.dataset.board === state.board));
  });
  const nav = document.querySelector(".leaderboard-nav");
  if (nav) nav.dataset.levelset = state.levelset;
  const averageControl = document.getElementById("average-filter-control");
  if (averageControl) averageControl.hidden = state.board !== "average" || state.levelset !== "metanet";
  document.querySelectorAll("[data-average-filter]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.averageFilter === state.averageFilter));
  });
  const averageNote = document.getElementById("average-filter-note");
  if (averageNote) averageNote.hidden = state.board !== "average" || state.averageFilter !== "filtered";
  const userAverageNote = document.getElementById("user-average-filter-note");
  if (userAverageNote) userAverageNote.hidden = state.board !== "average" || state.levelset !== "user";
  const eliteLevelNote = document.getElementById("elite-level-note");
  if (eliteLevelNote) eliteLevelNote.hidden = state.board !== "elite" || state.levelset !== "user";
  const loneWolfNote = document.getElementById("lone-wolf-note");
  if (loneWolfNote) loneWolfNote.hidden = state.board !== "loneWolfs" || state.levelset !== "user";
  let pointsNote = document.getElementById("points-note");
  const toolbar = document.querySelector(".leaderboard-toolbar");
  let zeroesControl = document.getElementById("zeroes-control");
  if (!zeroesControl && toolbar) {
    zeroesControl = document.createElement("div");
    zeroesControl.id = "zeroes-control";
    toolbar.append(zeroesControl);
  }
  if (zeroesControl) {
    zeroesControl.hidden = state.levelset !== "metanet" || state.board !== "zeroes";
    zeroesControl.innerHTML = zeroesControl.hidden ? "" : zeroesToggle();
  }
  if (!pointsNote && toolbar) {
    pointsNote = document.createElement("p");
    pointsNote.id = "points-note";
    pointsNote.className = "average-filter-note";
    pointsNote.textContent = "Points = 10 * 0ths + 9 * 1sts ... + 1 * 9ths";
    toolbar.append(pointsNote);
  }
  if (pointsNote) pointsNote.hidden = state.board !== "points";
}

function renderLeaderboard() {
  const main = document.getElementById("leaderboard-view");
  const root = document.getElementById("player-view");
  const levelsRoot = document.getElementById("player-levels-view");
  const levelRoot = document.getElementById("level-view");
  if (main) main.hidden = false;
  if (root) root.hidden = true;
  if (levelsRoot) levelsRoot.hidden = true;
  if (levelRoot) levelRoot.hidden = true;

  const body = document.getElementById("leaderboard-body");
  const candidates = eligiblePlayers(activeDataset(), state.board);
  const sorted = sortPlayers(candidates, state.board).slice(0, 1000);
  document.getElementById("metric-heading").textContent = boards[state.board].label;
  document.getElementById("boards-heading").hidden = state.board !== "average";
  body.innerHTML = sorted.map((player, index) => `
    <tr>
      <td class="place-cell">${placeLabel(index)}</td>
      <td class="player-cell"><a href="${playerUrl(player)}">${escapeHtml(player.name)}</a></td>
      <td class="numeric-cell">${formatMetric(player, state.board)}</td>
      ${state.board === "average" ? `<td class="numeric-cell">${numberFormat.format(player.boards)}</td>` : ""}
    </tr>`).join("");
}

function renderPlayer() {
  const root = document.getElementById("player-view");
  const main = document.getElementById("leaderboard-view");
  if (main) main.hidden = true;
  const levelsRoot = document.getElementById("player-levels-view");
  if (levelsRoot) levelsRoot.hidden = true;
  const levelRoot = document.getElementById("level-view");
  if (levelRoot) levelRoot.hidden = true;

  const params = currentParams();
  const requestedId = (params.get("id") || "").toLocaleLowerCase();
  const player = activeDataset().find((item) => item.key === requestedId);
  if (!player) {
    root.hidden = false;
    root.innerHTML = '<p class="table-state">Player not found in this level set.</p>';
    document.title = "Player — Nv2 Leaderboards";
    return;
  }

  const metricKeys = state.levelset === "user"
    ? ["zeroes", "boards", "points", "elite", "loneWolfs", "average"]
    : ["zeroes", "boards", "points", "average"];
  const statCard = (board) => {
    if (state.levelset === "metanet" && board === "zeroes") {
      const pureState = { ...state, zeroesMode: "pures" };
      const tiesState = { ...state, zeroesMode: "ties" };
      return `<div class="profile-stat profile-stat-zeroes">
        <span class="stat-heading"><span>0ths</span><span class="metric-rank" title="Pure 0ths rank">${playerMetricRank(player, board, pureState)}</span></span>
        <div class="zeroes-counts">
          <a href="${playerLevelsUrl(player, "zeroes", pureState)}"><span class="zeroes-count-label">Pure</span><strong>${formatMetric(player, board, pureState)}</strong></a>
          <a href="${playerLevelsUrl(player, "zeroes", tiesState)}"><span class="zeroes-count-label">Ties</span><strong>${formatMetric(player, board, tiesState)}</strong></a>
        </div>
      </div>`;
    }
    const body = `<span class="stat-heading"><span>${boards[board].label}</span><span class="metric-rank">${playerMetricRank(player, board)}</span></span><strong>${formatMetric(player, board)}</strong>`;
    if (state.levelset === "metanet" && (board === "zeroes" || board === "boards")) {
      const list = board === "zeroes" ? "zeroes" : "boards";
      return `<a class="profile-stat" href="${playerLevelsUrl(player, list)}">${body}</a>`;
    }
    if (state.levelset === "user" && (board === "elite" || board === "loneWolfs") && player[boards[board].metric] > 0) {
      return `<a class="profile-stat" href="${playerLevelsUrl(player, board)}">${body}</a>`;
    }
    return `<div class="profile-stat">${body}</div>`;
  };
  const placeCounts = renderPlaceHistogram(player.placeCounts);

  root.hidden = false;
  document.title = `${player.name} — Nv2 Leaderboards`;
  root.innerHTML = `
    <a class="back-link" href="${indexUrl(state)}">← Leaderboards</a>
    <h2 class="player-name">${escapeHtml(player.name)}</h2>
    <section class="profile-stats profile-stats-${metricKeys.length}" aria-label="Player statistics">
      ${metricKeys.map(statCard).join("")}
    </section>
    ${placeCounts}`;
}

function renderPlayerLevels() {
  const params = currentParams();
  const root = document.getElementById("player-levels-view");
  const main = document.getElementById("leaderboard-view");
  const playerRoot = document.getElementById("player-view");
  const levelRoot = document.getElementById("level-view");
  if (main) main.hidden = true;
  if (playerRoot) playerRoot.hidden = true;
  if (levelRoot) levelRoot.hidden = true;

  if (state.levelset === "user") {
    const listType = params.get("list");
    if (listType !== "elite" && listType !== "loneWolfs") {
      window.location.replace(playerUrl({ key: params.get("id") || "" }, state));
      return;
    }

    const player = datasets.user.find((item) => item.key === (params.get("id") || "").toLocaleLowerCase());
    if (!player) {
      root.hidden = false;
      root.innerHTML = '<p class="table-state">Player not found in this level set.</p>';
      return;
    }

    const isElite = listType === "elite";
    const title = `${player.name} ${isElite ? "Elite Levels" : "Lone Wolf Levels"}`;
    const details = userLevelDetails[player.key] || {};
    const entries = isElite ? (details.elite || []) : (details.wolves || []);
    const rows = isElite
      ? entries.map(([levelId, place, framesBehindZero]) => `<tr><td>${String(levelId)}</td><td class="numeric-cell">${placeLabel(place)}</td><td class="numeric-cell">${formatSignedFrames(framesBehindZero)}</td></tr>`).join("")
      : entries.map((levelId) => `<tr><td>${String(levelId)}</td></tr>`).join("");

    root.hidden = false;
    document.title = `${title} — Nv2 Leaderboards`;
    root.innerHTML = `
      <a class="back-link" href="${playerUrl(player)}">← ${escapeHtml(player.name)}</a>
      <h2 class="player-name">${escapeHtml(title)}</h2>
      <div class="table-scroll">
        <table class="level-list">
          <thead><tr>
            <th scope="col">Level</th>
            ${isElite ? '<th scope="col" class="numeric-column">Place</th><th scope="col" class="numeric-column">Frames behind 0th</th>' : ""}
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
    return;
  }

  const player = datasets.metanet.find((item) => item.key === (params.get("id") || "").toLocaleLowerCase());
  if (!player) {
    root.hidden = false;
    root.innerHTML = '<p class="table-state">Player not found in this level set.</p>';
    return;
  }

  const listType = params.get("list") === "zeroes" ? "zeroes" : "boards";
  const isZeroes = listType === "zeroes";
  const title = `${player.name} ${isZeroes ? "0th Levels" : "Leaderboards"}`;
  const entries = player.entries
    .filter((entry) => !isZeroes || (state.zeroesMode === "ties" ? entry.isZeroWithTies : entry.place === 0))
    .sort((a, b) => Number(a.levelId) - Number(b.levelId));
  const frameDifference = (entry) => {
    const records = levelRecords.get(entry.levelId) || [];
    const zeroFrames = records.find((record) => record.place === 0)?.frames;
    if (isZeroes) {
      const firstFrames = records.find((record) => record.place === 1)?.frames;
      return Number.isFinite(zeroFrames) && Number.isFinite(firstFrames) ? zeroFrames - firstFrames : null;
    }
    return Number.isFinite(entry.frames) && Number.isFinite(zeroFrames) ? entry.frames - zeroFrames : null;
  };

  root.hidden = false;
  document.title = `${title} — Nv2 Leaderboards`;
  root.innerHTML = `
    <a class="back-link" href="${playerUrl(player)}">← ${escapeHtml(player.name)}</a>
    <div class="player-levels-heading">
      <h2 class="player-name">${escapeHtml(title)}</h2>
      ${isZeroes ? zeroesToggle() : ""}
    </div>
    <div class="table-scroll">
      <table class="level-list ${isZeroes ? "level-list-metanet-zeroes" : "level-list-metanet-boards"}">
        <thead><tr>
          <th scope="col">Level</th>
          <th scope="col">Name</th>
          <th scope="col" class="numeric-column">Time</th>
          <th scope="col" class="numeric-column">Frames</th>
          ${isZeroes ? '<th scope="col" class="numeric-column">Frames ahead</th>' : '<th scope="col" class="numeric-column">Place</th><th scope="col" class="numeric-column">Frames behind 0th</th>'}
        </tr></thead>
        <tbody>
          ${entries.map((entry) => {
            const displayId = displayLevelId(entry.levelId);
            const level = metanetLevelById.get(String(entry.levelId).padStart(6, "0"));
            return `<tr>
              <td class="level-id-cell"><a href="${levelUrl(entry.levelId)}">${escapeHtml(displayId)}</a></td>
              <td class="level-name-cell"><a href="${levelUrl(entry.levelId)}">${escapeHtml(level?.name || "—")}</a></td>
              <td class="numeric-cell">${formatTime(entry.frames)}</td>
              <td class="numeric-cell">${Number.isFinite(entry.frames) ? numberFormat.format(entry.frames) : "—"}</td>
              ${isZeroes
                ? `<td class="numeric-cell">${formatSignedFrames(frameDifference(entry))}</td>`
                : `<td class="numeric-cell">${placeLabel(entry.place)}</td><td class="numeric-cell">${formatSignedFrames(frameDifference(entry))}</td>`}
            </tr>`;
          }).join("")}
        </tbody>
      </table>
    </div>`;
}

function renderCurrentPage() {
  const page = window.Nv2Routes.read().page;
  document.body.dataset.page = page;
  document.querySelector(".site-header").hidden = page === "home";
  document.querySelector(".player-search").hidden = page === "home";
  document.querySelector(".leaderboard-nav").hidden = !["leaderboard", "player"].includes(page);
  document.querySelector(".site-title a").href = window.Nv2Routes.url("home");
  document.querySelectorAll("[data-home-levelset]").forEach((link) => {
    link.href = indexUrl({ levelset: link.dataset.homeLevelset, board: "zeroes", averageFilter: "filtered" });
  });
  ["home", "leaderboard", "player", "player-levels", "level"].forEach((view) => {
    document.getElementById(`${view}-view`).hidden = view !== page;
  });
  if (page === "home") {
    document.title = "Nv2 Leaderboards";
    return;
  }
  syncControls();
  if (page === "player") renderPlayer();
  else if (page === "player-levels") renderPlayerLevels();
  else if (page === "level") renderLevel();
  else renderLeaderboard();
}

function renderLevel() {
  const root = document.getElementById("level-view");
  const main = document.getElementById("leaderboard-view");
  const playerRoot = document.getElementById("player-view");
  const levelsRoot = document.getElementById("player-levels-view");
  if (main) main.hidden = true;
  if (playerRoot) playerRoot.hidden = true;
  if (levelsRoot) levelsRoot.hidden = true;

  const params = currentParams();
  const requestedId = params.get("id") || "";
  const level = metanetLevelCatalog.find((item) => item.id === requestedId.padStart(6, "0"));
  if (!level) {
    root.hidden = false;
    root.innerHTML = '<p class="table-state">Metanet level not found.</p>';
    document.title = "Metanet Level — Nv2 Leaderboards";
    return;
  }

  const title = level.name ? `${level.displayId}: ${level.name}` : level.displayId;
  const playerByKey = new Map(datasets.metanet.map((player) => [player.key, player]));
  const records = [...(levelRecords.get(level.id) || [])].sort((a, b) =>
    a.place - b.place
    || (Number.isFinite(a.frames) && Number.isFinite(b.frames) ? a.frames - b.frames : 0)
    || (playerByKey.get(a.playerKey)?.name || a.playerKey).localeCompare(playerByKey.get(b.playerKey)?.name || b.playerKey, undefined, { sensitivity: "base" })
  );
  const rows = records.map((record) => {
    const player = playerByKey.get(record.playerKey);
    const playerName = player?.name || record.playerKey;
    const playerHref = player ? playerUrl(player, { ...state, levelset: "metanet" }) : "#";
    return `<tr>
      <td class="place-cell">${placeLabel(record.place)}</td>
      <td class="player-cell"><a href="${playerHref}">${escapeHtml(playerName)}</a></td>
      <td class="numeric-cell">${Number.isFinite(record.frames) ? numberFormat.format(record.frames) : "—"}</td>
    </tr>`;
  }).join("");
  const imagePanel = level.image
    ? `<aside class="level-image-panel">
        <img class="level-image" src="${escapeHtml(level.image)}" alt="${escapeHtml(title)} level image">
        ${level.imageSource ? `<p class="level-image-credit">Image from the <a href="${escapeHtml(level.imageSource)}" target="_blank" rel="noreferrer">Nv2 Wiki</a></p>` : ""}
      </aside>`
    : "";

  root.hidden = false;
  document.title = `${title} — Nv2 Leaderboards`;
  root.innerHTML = `
    <a class="back-link" href="${indexUrl({ ...state, levelset: "metanet" })}">← Leaderboards</a>
    <h2 class="level-page-title">${escapeHtml(title)}</h2>
    <div class="level-page-grid${imagePanel ? " has-image" : ""}">
      <section class="level-page-leaderboard" aria-label="${escapeHtml(title)} leaderboard">
        <div class="table-scroll">
          <table>
            <thead><tr><th scope="col" class="place-column">Place</th><th scope="col">Player</th><th scope="col" class="numeric-column">Frames</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="3" class="table-state">No leaderboard data available.</td></tr>'}</tbody>
          </table>
        </div>
      </section>
      ${imagePanel}
    </div>`;
}

function changeLevelset(levelset) {
  if (levelset === state.levelset) return;
  const nextState = { ...state, levelset, zeroesMode: "pures" };
  if (!availableBoards[levelset].includes(nextState.board)) nextState.board = "zeroes";
  const page = document.body.dataset.page;
  if (page === "player-levels" || page === "level") {
    window.location.href = page === "player-levels"
      ? playerUrl({ key: currentParams().get("id") || "" }, nextState)
      : indexUrl(nextState);
    return;
  }
  const destination = page === "player"
    ? playerUrl({ key: currentParams().get("id") || "" }, nextState)
    : indexUrl(nextState);
  state = nextState;
  window.history.pushState({}, "", destination);
  renderCurrentPage();
}

function changeBoard(board) {
  const nextState = { ...state, board };
  if (document.body.dataset.page !== "leaderboard") {
    window.location.href = indexUrl(nextState);
    return;
  }
  state = nextState;
  window.history.pushState({}, "", indexUrl(state));
  renderCurrentPage();
}

function changeAverageFilter(averageFilter) {
  if (state.levelset !== "metanet" || state.board !== "average" || averageFilter === state.averageFilter) return;
  state = { ...state, averageFilter };
  window.history.pushState({}, "", indexUrl(state));
  renderCurrentPage();
}

function changeZeroesMode(zeroesMode) {
  if (state.levelset !== "metanet" || !["pures", "ties"].includes(zeroesMode) || zeroesMode === state.zeroesMode) return;
  const route = window.Nv2Routes.read();
  const isZeroesList = route.page === "player-levels" && route.params.get("list") === "zeroes";
  if (!isZeroesList && (route.page !== "leaderboard" || state.board !== "zeroes")) return;
  state = { ...state, zeroesMode };
  const destination = isZeroesList
    ? playerLevelsUrl({ key: route.params.get("id") || "" }, "zeroes") : indexUrl();
  window.history.pushState({}, "", destination);
  renderCurrentPage();
}

function searchMatches(query) {
  const normalized = query.toLocaleLowerCase();
  const players = [...activeDataset()]
    .filter((player) => player.name.toLocaleLowerCase().includes(normalized))
    .map((player) => ({
      type: "player",
      label: player.name,
      href: playerUrl(player),
      exact: player.key === normalized,
      starts: player.name.toLocaleLowerCase().startsWith(normalized),
      sortName: player.name,
      player,
    }));
  const levels = metanetLevelCatalog
    .filter((level) => `${level.id} ${level.displayId} ${level.name}`.toLocaleLowerCase().includes(normalized))
    .map((level) => ({
      type: "level",
      label: level.name ? `${level.displayId}: ${level.name}` : level.displayId,
      href: levelUrl(level.id),
      exact: level.id === normalized || level.displayId.toLocaleLowerCase() === normalized,
      starts: level.id.startsWith(normalized) || level.displayId.toLocaleLowerCase().startsWith(normalized) || level.name.toLocaleLowerCase().startsWith(normalized),
      sortName: level.displayId,
      level,
    }));
  return [...players, ...levels]
    .sort((a, b) => Number(b.exact) - Number(a.exact)
      || Number(b.starts) - Number(a.starts)
      || a.sortName.localeCompare(b.sortName, undefined, { sensitivity: "base" })
      || a.type.localeCompare(b.type))
    .slice(0, 8);
}

function attachSearch() {
  const form = document.getElementById("player-search-form");
  const input = document.getElementById("player-search-input");
  const results = document.getElementById("player-search-results");
  const status = document.getElementById("player-search-status");
  if (!form || !input || !results || !status) return;

  const update = () => {
    const query = input.value.trim();
    status.textContent = "";
    if (query.length < 2) {
      results.hidden = true;
      results.innerHTML = "";
      return [];
    }
    const matches = searchMatches(query);
    results.innerHTML = matches.map((match) => `
      <a role="option" href="${match.href}"><span>${escapeHtml(match.label)}</span><span class="search-result-type">${match.type}</span></a>`).join("");
    results.hidden = matches.length === 0;
    return matches;
  };

  input.addEventListener("input", update);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const query = input.value.trim();
    if (!query) return;
    const matches = update();
    const normalized = query.toLocaleLowerCase();
    const exactPlayer = activeDataset().find((player) => player.key === normalized);
    const exactLevel = metanetLevelCatalog.find((level) => level.id === normalized || level.displayId.toLocaleLowerCase() === normalized);
    if (exactPlayer) {
      window.location.href = playerUrl(exactPlayer);
    } else if (exactLevel) {
      window.location.href = levelUrl(exactLevel.id);
    } else if (matches.length === 1) {
      window.location.href = matches[0].href;
    } else if (matches.length > 1) {
      status.textContent = "Choose a player or level from the matches.";
    } else {
      status.textContent = "No match found.";
    }
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      results.hidden = true;
      status.textContent = "";
    }
  });
}

function attachControls() {
  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-zeroes-mode]");
    if (button) changeZeroesMode(button.dataset.zeroesMode);
  });
  document.querySelectorAll("[data-levelset]").forEach((button) => {
    button.addEventListener("click", () => changeLevelset(button.dataset.levelset));
  });
  document.querySelectorAll("[data-board]").forEach((button) => {
    button.addEventListener("click", () => changeBoard(button.dataset.board));
  });
  document.querySelectorAll("[data-average-filter]").forEach((button) => {
    button.addEventListener("click", () => changeAverageFilter(button.dataset.averageFilter));
  });
  window.addEventListener("popstate", () => {
    state = currentState();
    renderCurrentPage();
  });
}

async function start() {
  const route = window.Nv2Routes.read();
  document.body.dataset.page = route.page;
  const canonical = window.Nv2Routes.url(route.page, state, {
    id: route.page === "level" ? displayLevelId(route.params.get("id")) : route.params.get("id"),
    list: route.params.get("list"),
  });
  window.history.replaceState({}, "", canonical);
  if (route.page === "home") { renderCurrentPage(); return; }
  attachControls();
  attachSearch();
  try {
    const [metanetResponse, userResponse, metadataResponse, siteMetadataResponse] = await Promise.all([
      fetch(METANET_CSV_PATH, { cache: "no-store" }),
      fetch(USER_DATA_PATH, { cache: "no-store" }),
      fetch("metanet_level_metadata.json", { cache: "no-store" }),
      fetch("site_metadata.json", { cache: "no-store" }),
    ]);
    if (!metanetResponse.ok) throw new Error(`The Metanet CSV returned ${metanetResponse.status}.`);
    if (!userResponse.ok) throw new Error(`The user-level data returned ${userResponse.status}.`);
    const [metanetText, userPayload] = await Promise.all([metanetResponse.text(), userResponse.json()]);
    const metanetData = buildMetanetDataset(parseCsv(metanetText));
    datasets.metanet = metanetData.profiles;
    levelRecords = metanetData.levelRecords;
    datasets.user = Array.isArray(userPayload.players) ? userPayload.players : [];
    if (metadataResponse.ok) metanetLevelMetadata = await metadataResponse.json();
    metanetLevelCatalog = buildMetanetLevelCatalog(metanetLevelMetadata);
    metanetLevelById = new Map(metanetLevelCatalog.map((level) => [level.id, level]));
    if (siteMetadataResponse.ok) {
      const siteMetadata = await siteMetadataResponse.json();
      const dateNote = document.getElementById("last-updated");
      if (dateNote && typeof siteMetadata.lastUpdated === "string") dateNote.textContent = `Last Updated: ${siteMetadata.lastUpdated}`;
    }
    const listType = currentParams().get("list");
    if (document.body.dataset.page === "player-levels" && state.levelset === "user"
      && (listType === "elite" || listType === "loneWolfs")) {
      const detailsResponse = await fetch("user_level_details.json", { cache: "no-store" });
      if (!detailsResponse.ok) throw new Error(`The user-level detail data returned ${detailsResponse.status}.`);
      const detailsPayload = await detailsResponse.json();
      userLevelDetails = detailsPayload.players || {};
    }
    renderCurrentPage();
  } catch (error) {
    const body = document.getElementById("leaderboard-body");
    if (body) body.innerHTML = '<tr><td colspan="4" class="table-state">Data unavailable.</td></tr>';
    const root = document.getElementById("player-view") || document.getElementById("player-levels-view") || document.getElementById("level-view");
    if (root) {
      root.hidden = false;
      root.innerHTML = '<p class="table-state">Data unavailable.</p>';
    }
    console.error(error);
  }
}

start();
