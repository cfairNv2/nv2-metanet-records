const CSV_PATH = "metanet_leaderboards.csv";
const numberFormat = new Intl.NumberFormat("en-US");
const averageFormat = new Intl.NumberFormat("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const boards = {
  zeroes: { label: "0ths", metric: "zeroes" },
  boards: { label: "Total Boards", metric: "boards" },
  points: { label: "Points", metric: "points" },
  average: { label: "Average Place", metric: "averagePlace" },
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

function buildDataset(rows) {
  const players = new Map();

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

    const existing = player.levels.get(row.level_id);
    if (!existing || place < existing.place) {
      player.levels.set(row.level_id, { levelId: row.level_id, place });
    }
  }

  const profiles = [...players.values()].map((player) => {
    const name = [...player.names.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || "Unknown player";
    const entries = [...player.levels.values()];
    const zeroes = entries.filter((entry) => entry.place === 0).length;
    const points = entries.reduce((total, entry) => {
      if (entry.place < 0 || entry.place > 9) return total;
      return total + 10 - entry.place;
    }, 0);
    const averagePlace = entries.length
      ? entries.reduce((total, entry) => total + entry.place, 0) / entries.length
      : null;

    return { ...player, name, entries, boards: entries.length, zeroes, points, averagePlace };
  });

  return profiles;
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

function currentState() {
  const params = new URLSearchParams(window.location.search);
  return {
    levelset: params.get("levels") === "user" ? "user" : "metanet",
    board: Object.hasOwn(boards, params.get("board")) ? params.get("board") : "zeroes",
  };
}

let state = currentState();
let dataset = [];

function stateUrl(nextState) {
  const params = new URLSearchParams();
  if (nextState.levelset !== "metanet") params.set("levels", nextState.levelset);
  if (nextState.board !== "zeroes") params.set("board", nextState.board);
  const query = params.toString();
  return `${window.location.pathname}${query ? `?${query}` : ""}`;
}

function indexUrl(nextState) {
  const pageState = stateUrl(nextState);
  const query = pageState.includes("?") ? pageState.slice(pageState.indexOf("?")) : "";
  return `index.html${query}`;
}

function selectState(nextState) {
  state = nextState;
  if (document.body.dataset.page !== "leaderboard") {
    window.location.href = indexUrl(nextState);
    return;
  }
  window.history.pushState({}, "", stateUrl(state));
  render();
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
  const rankedPlayers = board === "zeroes"
    ? dataset.filter((item) => item.zeroes > 0)
    : dataset;
  const position = sortPlayers(rankedPlayers, board).findIndex((item) => item.key === player.key);
  return position < 0 ? "—" : placeLabel(position);
}

function syncControls() {
  document.querySelectorAll("[data-levelset]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.levelset === state.levelset));
  });
  document.querySelectorAll("[data-board]").forEach((button) => {
    button.setAttribute("aria-selected", String(button.dataset.board === state.board));
  });
}

function render() {
  syncControls();
  const main = document.getElementById("leaderboard-view");
  const emptyForUserLevels = state.levelset === "user";
  main.hidden = emptyForUserLevels;
  if (emptyForUserLevels) return;

  const body = document.getElementById("leaderboard-body");
  const leaderboardPlayers = state.board === "zeroes"
    ? dataset.filter((player) => player.zeroes > 0)
    : dataset;
  const sorted = sortPlayers(leaderboardPlayers, state.board);
  document.getElementById("metric-heading").textContent = boards[state.board].label;
  document.getElementById("boards-heading").hidden = state.board !== "average";
  body.innerHTML = sorted.map((player, index) => `
    <tr>
      <td class="place-cell">${placeLabel(index)}</td>
      <td class="player-cell"><a href="player.html?id=${encodeURIComponent(player.key)}&board=${encodeURIComponent(state.board)}">${escapeHtml(player.name)}</a></td>
      <td class="numeric-cell">${formatMetric(player, state.board)}</td>
      ${state.board === "average" ? `<td class="numeric-cell">${numberFormat.format(player.boards)}</td>` : ""}
    </tr>`).join("");
}

function renderPlayer() {
  syncControls();
  const params = new URLSearchParams(window.location.search);
  const requestedId = params.get("id") || "";
  const player = dataset.find((item) => item.key === requestedId);
  const root = document.getElementById("player-view");
  const main = document.getElementById("leaderboard-view");
  main.hidden = true;

  if (!player || state.levelset === "user") {
    root.hidden = true;
    return;
  }

  root.hidden = false;
  document.title = `${player.name} — Nv2 Leaderboards`;
  root.innerHTML = `
    <a class="back-link" href="${indexUrl({ ...state, board: params.get("board") || "zeroes" })}">← Leaderboards</a>
    <h2 class="player-name">${escapeHtml(player.name)}</h2>
    <section class="profile-stats" aria-label="Player statistics">
      <a class="profile-stat" href="player-levels.html?id=${encodeURIComponent(player.key)}&list=zeroes">
        <span class="stat-heading"><span>0ths</span><span class="metric-rank">${playerMetricRank(player, "zeroes")}</span></span>
        <strong>${numberFormat.format(player.zeroes)}</strong>
      </a>
      <a class="profile-stat" href="player-levels.html?id=${encodeURIComponent(player.key)}&list=boards">
        <span class="stat-heading"><span>Total Boards</span><span class="metric-rank">${playerMetricRank(player, "boards")}</span></span>
        <strong>${numberFormat.format(player.boards)}</strong>
      </a>
      <div class="profile-stat">
        <span class="stat-heading"><span>Points</span><span class="metric-rank">${playerMetricRank(player, "points")}</span></span>
        <strong>${numberFormat.format(player.points)}</strong>
      </div>
      <div class="profile-stat">
        <span class="stat-heading"><span>Average Place</span><span class="metric-rank">${playerMetricRank(player, "average")}</span></span>
        <strong>${averageFormat.format(player.averagePlace)}</strong>
      </div>
    </section>`;
}

function renderPlayerLevels() {
  syncControls();
  const params = new URLSearchParams(window.location.search);
  const player = dataset.find((item) => item.key === (params.get("id") || ""));
  const listType = params.get("list") === "zeroes" ? "zeroes" : "boards";
  const root = document.getElementById("player-levels-view");

  if (!player || state.levelset === "user") {
    root.hidden = true;
    return;
  }

  const isZeroes = listType === "zeroes";
  const title = `${player.name} ${isZeroes ? "0th Levels" : "Leaderboards"}`;
  const entries = player.entries
    .filter((entry) => !isZeroes || entry.place === 0)
    .sort((a, b) => Number(a.levelId) - Number(b.levelId));

  root.hidden = false;
  document.title = `${title} — Nv2 Leaderboards`;
  root.innerHTML = `
    <a class="back-link" href="player.html?id=${encodeURIComponent(player.key)}&board=${encodeURIComponent(state.board)}">← ${escapeHtml(player.name)}</a>
    <h2 class="player-name">${escapeHtml(title)}</h2>
    <ol class="level-list">
      ${entries.map((entry) => `
        <li><span>Level ${escapeHtml(displayLevelId(entry.levelId))}</span>${isZeroes ? "" : `<span class="level-place">${placeLabel(entry.place)}</span>`}</li>`).join("")}
    </ol>`;
}

function attachControls() {
  document.querySelectorAll("[data-levelset]").forEach((button) => {
    button.addEventListener("click", () => selectState({ ...state, levelset: button.dataset.levelset }));
  });
  document.querySelectorAll("[data-board]").forEach((button) => {
    button.addEventListener("click", () => selectState({ ...state, board: button.dataset.board }));
  });
  window.addEventListener("popstate", () => {
    state = currentState();
    if (document.body.dataset.page !== "leaderboard") window.location.reload();
    else render();
  });
}

async function start() {
  attachControls();
  try {
    const response = await fetch(CSV_PATH, { cache: "no-store" });
    if (!response.ok) throw new Error(`The leaderboard CSV returned ${response.status}.`);
    dataset = buildDataset(parseCsv(await response.text()));
    if (document.body.dataset.page === "player") renderPlayer();
    else if (document.body.dataset.page === "player-levels") renderPlayerLevels();
    else render();
  } catch (error) {
    const body = document.getElementById("leaderboard-body");
    if (body) body.innerHTML = '<tr><td colspan="3" class="table-state">Data unavailable.</td></tr>';
    console.error(error);
  }
}

start();
