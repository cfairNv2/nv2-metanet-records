const METANET_CSV_PATH = "metanet_leaderboards.csv";
const USER_DATA_PATH = "user_leaderboards.json";
const numberFormat = new Intl.NumberFormat("en-US");
const averageFormat = new Intl.NumberFormat("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
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
    const points = entries.reduce((total, entry) => total + (entry.place >= 0 && entry.place <= 9 ? 10 - entry.place : 0), 0);
    const averagePlace = entries.length
      ? entries.reduce((total, entry) => total + entry.place, 0) / entries.length
      : null;

    return { ...player, name, entries, boards: entries.length, zeroes, points, averagePlace };
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

function currentState() {
  const params = new URLSearchParams(window.location.search);
  const levelset = params.get("levels") === "user" ? "user" : "metanet";
  const requestedBoard = Object.hasOwn(boards, params.get("board")) ? params.get("board") : "zeroes";
  return {
    levelset,
    board: availableBoards[levelset].includes(requestedBoard) ? requestedBoard : "zeroes",
    averageFilter: levelset === "metanet" && params.get("average") === "unfiltered" ? "unfiltered" : "filtered",
  };
}

let state = currentState();
let datasets = { metanet: [], user: [] };
let levelRecords = new Map();

function stateQuery(nextState, extra = {}) {
  const params = new URLSearchParams();
  if (nextState.levelset !== "metanet") params.set("levels", nextState.levelset);
  if (nextState.board !== "zeroes") params.set("board", nextState.board);
  if (nextState.levelset === "metanet" && nextState.board === "average" && nextState.averageFilter === "unfiltered") {
    params.set("average", "unfiltered");
  }
  if (extra.id) params.set("id", extra.id);
  if (extra.list) params.set("list", extra.list);
  const query = params.toString();
  return query ? `?${query}` : "";
}

function indexUrl(nextState) {
  return `index.html${stateQuery(nextState)}`;
}

function playerUrl(player, nextState = state) {
  return `player.html${stateQuery(nextState, { id: player.key })}`;
}

function activeDataset() {
  return datasets[state.levelset];
}

function eligiblePlayers(profiles, board) {
  const metric = boards[board].metric;
  if (board === "zeroes" || board === "elite" || board === "loneWolfs") {
    return profiles.filter((player) => player[metric] > 0);
  }
  if (board === "average") {
    if (state.levelset === "user") return profiles.filter((player) => player.boards >= userAverageMinimumBoards);
    if (state.averageFilter === "filtered") return profiles.filter((player) => player.boards >= metanetAverageMinimumBoards);
  }
  return profiles;
}

function sortPlayers(profiles, board) {
  const metric = boards[board].metric;
  const direction = board === "average" ? 1 : -1;
  return [...profiles].sort((a, b) =>
    direction * ((a[metric] ?? Number.POSITIVE_INFINITY) - (b[metric] ?? Number.POSITIVE_INFINITY))
    || (board === "boards" ? b.zeroes - a.zeroes : b.boards - a.boards)
    || a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  );
}

function formatMetric(player, board) {
  const value = player[boards[board].metric];
  if (board === "average" && value === null) return "—";
  return board === "average" ? averageFormat.format(value) : numberFormat.format(value);
}

function playerMetricRank(player, board) {
  if (board === "zeroes" && player.zeroes === 0) return "—";
  if (board === "elite" && player.eliteLevels === 0) return "—";
  if (board === "loneWolfs" && player.loneWolfs === 0) return "—";
  if (board === "average" && !eligiblePlayers([player], board).length) return "—";
  const rankedPlayers = sortPlayers(eligiblePlayers(activeDataset(), board), board);
  const position = rankedPlayers.findIndex((item) => item.key === player.key);
  return position < 0 ? "—" : placeLabel(position);
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
}

function renderLeaderboard() {
  const main = document.getElementById("leaderboard-view");
  const root = document.getElementById("player-view");
  const levelsRoot = document.getElementById("player-levels-view");
  if (main) main.hidden = false;
  if (root) root.hidden = true;
  if (levelsRoot) levelsRoot.hidden = true;

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

  const params = new URLSearchParams(window.location.search);
  const requestedId = (params.get("id") || "").toLocaleLowerCase();
  const player = activeDataset().find((item) => item.key === requestedId);
  if (!player) {
    root.hidden = false;
    root.innerHTML = '<p class="table-state">Player not found in this level set.</p>';
    document.title = "Player — Nv2 Leaderboards";
    return;
  }

  const metricKeys = state.levelset === "user"
    ? ["zeroes", "boards", "points", "average", "elite", "loneWolfs"]
    : ["zeroes", "boards", "points", "average"];
  const statCard = (board) => {
    const metric = boards[board].metric;
    const body = `<span class="stat-heading"><span>${boards[board].label}</span><span class="metric-rank">${playerMetricRank(player, board)}</span></span><strong>${formatMetric(player, board)}</strong>`;
    if (state.levelset === "metanet" && (board === "zeroes" || board === "boards")) {
      const list = board === "zeroes" ? "zeroes" : "boards";
      return `<a class="profile-stat" href="player-levels.html${stateQuery(state, { id: player.key, list })}">${body}</a>`;
    }
    return `<div class="profile-stat">${body}</div>`;
  };

  root.hidden = false;
  document.title = `${player.name} — Nv2 Leaderboards`;
  root.innerHTML = `
    <a class="back-link" href="${indexUrl(state)}">← Leaderboards</a>
    <h2 class="player-name">${escapeHtml(player.name)}</h2>
    <section class="profile-stats profile-stats-${metricKeys.length}" aria-label="Player statistics">
      ${metricKeys.map(statCard).join("")}
    </section>`;
}

function renderPlayerLevels() {
  const params = new URLSearchParams(window.location.search);
  if (state.levelset === "user") {
    window.location.replace(playerUrl({ key: params.get("id") || "" }, state));
    return;
  }

  const player = datasets.metanet.find((item) => item.key === (params.get("id") || ""));
  const root = document.getElementById("player-levels-view");
  const main = document.getElementById("leaderboard-view");
  const playerRoot = document.getElementById("player-view");
  if (main) main.hidden = true;
  if (playerRoot) playerRoot.hidden = true;

  if (!player) {
    root.hidden = false;
    root.innerHTML = '<p class="table-state">Player not found in this level set.</p>';
    return;
  }

  const listType = params.get("list") === "zeroes" ? "zeroes" : "boards";
  const isZeroes = listType === "zeroes";
  const title = `${player.name} ${isZeroes ? "0th Levels" : "Leaderboards"}`;
  const entries = player.entries
    .filter((entry) => !isZeroes || entry.place === 0)
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
    <a class="back-link" href="player.html${stateQuery(state, { id: player.key })}">← ${escapeHtml(player.name)}</a>
    <h2 class="player-name">${escapeHtml(title)}</h2>
    <div class="table-scroll">
      <table class="level-list">
        <thead><tr>
          <th scope="col">Level</th>
          ${isZeroes ? '<th scope="col" class="numeric-column">Frames ahead</th>' : '<th scope="col" class="numeric-column">Place</th><th scope="col" class="numeric-column">Frames behind 0th</th>'}
        </tr></thead>
        <tbody>
          ${entries.map((entry) => `
            <tr>
              <td>Level ${escapeHtml(displayLevelId(entry.levelId))}</td>
              ${isZeroes
                ? `<td class="numeric-cell">${formatSignedFrames(frameDifference(entry))}</td>`
                : `<td class="numeric-cell">${placeLabel(entry.place)}</td><td class="numeric-cell">${formatSignedFrames(frameDifference(entry))}</td>`}
            </tr>`).join("")}
        </tbody>
      </table>
    </div>`;
}

function renderCurrentPage() {
  syncControls();
  if (document.body.dataset.page === "player") renderPlayer();
  else if (document.body.dataset.page === "player-levels") renderPlayerLevels();
  else renderLeaderboard();
}

function changeLevelset(levelset) {
  if (levelset === state.levelset) return;
  const nextState = { ...state, levelset };
  if (!availableBoards[levelset].includes(nextState.board)) nextState.board = "zeroes";

  if (document.body.dataset.page === "player-levels") {
    const params = new URLSearchParams(window.location.search);
    window.location.href = playerUrl({ key: params.get("id") || "" }, nextState);
    return;
  }

  state = nextState;
  const extra = document.body.dataset.page === "player"
    ? { id: new URLSearchParams(window.location.search).get("id") || "" }
    : {};
  const pagePath = document.body.dataset.page === "player" ? "player.html" : "index.html";
  window.history.pushState({}, "", `${pagePath}${stateQuery(state, extra)}`);
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

function searchMatches(query) {
  const normalized = query.toLocaleLowerCase();
  return [...activeDataset()]
    .filter((player) => player.name.toLocaleLowerCase().includes(normalized))
    .sort((a, b) => Number(b.key === normalized) - Number(a.key === normalized)
      || Number(b.name.toLocaleLowerCase().startsWith(normalized)) - Number(a.name.toLocaleLowerCase().startsWith(normalized))
      || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }))
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
    results.innerHTML = matches.map((player) => `
      <a role="option" href="${playerUrl(player)}">${escapeHtml(player.name)}</a>`).join("");
    results.hidden = matches.length === 0;
    return matches;
  };

  input.addEventListener("input", update);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const query = input.value.trim();
    if (!query) return;
    const matches = update();
    const exact = activeDataset().find((player) => player.key === query.toLocaleLowerCase());
    if (exact) {
      window.location.href = playerUrl(exact);
    } else if (matches.length === 1) {
      window.location.href = playerUrl(matches[0]);
    } else if (matches.length > 1) {
      status.textContent = "Choose a player from the matches.";
    } else {
      status.textContent = "No player found.";
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
  attachControls();
  attachSearch();
  try {
    const [metanetResponse, userResponse] = await Promise.all([
      fetch(METANET_CSV_PATH, { cache: "no-store" }),
      fetch(USER_DATA_PATH, { cache: "no-store" }),
    ]);
    if (!metanetResponse.ok) throw new Error(`The Metanet CSV returned ${metanetResponse.status}.`);
    if (!userResponse.ok) throw new Error(`The user-level data returned ${userResponse.status}.`);
    const [metanetText, userPayload] = await Promise.all([metanetResponse.text(), userResponse.json()]);
    const metanetData = buildMetanetDataset(parseCsv(metanetText));
    datasets.metanet = metanetData.profiles;
    levelRecords = metanetData.levelRecords;
    datasets.user = Array.isArray(userPayload.players) ? userPayload.players : [];
    renderCurrentPage();
  } catch (error) {
    const body = document.getElementById("leaderboard-body");
    if (body) body.innerHTML = '<tr><td colspan="4" class="table-state">Data unavailable.</td></tr>';
    const root = document.getElementById("player-view") || document.getElementById("player-levels-view");
    if (root) {
      root.hidden = false;
      root.innerHTML = '<p class="table-state">Data unavailable.</p>';
    }
    console.error(error);
  }
}

start();
