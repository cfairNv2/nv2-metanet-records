(function () {
  const projectPath = "/nv2-metanet-records/";
  const slugs = {
    zeroes: "0ths", boards: "total-boards", points: "points",
    average: "average-place", elite: "elite-levels", loneWolfs: "lone-wolfs",
  };
  const reverseSlugs = Object.fromEntries(Object.entries(slugs).map(([key, slug]) => [slug, key]));

  function root(pathname = window.location.pathname) {
    return pathname === projectPath.slice(0, -1) || pathname.startsWith(projectPath) ? projectPath : "/";
  }

  function levelId(value) {
    if (/^\d{1,6}$/.test(value)) return String(Number(value)).padStart(6, "0");
    const match = /^([0-9ab])(\d)-([0-4])$/i.exec(value);
    if (!match) return value;
    return String(("0123456789ab".indexOf(match[1].toLowerCase()) * 10 + Number(match[2])) * 5 + Number(match[3]) + 1).padStart(6, "0");
  }

  function read(location = window.location) {
    const params = new URLSearchParams(location.search);
    const base = root(location.pathname);
    const path = location.pathname.slice(base.length).replace(/\/$/, "");
    let parts;
    try { parts = path.split("/").map(decodeURIComponent); }
    catch { parts = []; }
    let page = "home";
    if (parts[0] === "metanet" || parts[0] === "userlevel") {
      params.set("levels", parts[0] === "userlevel" ? "user" : "metanet");
      page = "leaderboard";
      if (parts[1] === "user" && parts[2]) {
        params.set("id", parts[2]);
        page = "player";
        if (parts[3]) {
          params.set("list", reverseSlugs[parts[3]] || parts[3]);
          page = "player-levels";
        }
      } else if (parts[1] === "level" && parts[2] && parts[0] === "metanet") {
        params.set("id", levelId(parts[2]));
        page = "level";
      } else if (parts[1]) {
        params.set("board", reverseSlugs[parts[1]] || parts[1]);
      }
    } else if (parts[0] === "player.html") page = "player";
    else if (parts[0] === "player-levels.html") page = "player-levels";
    else if (parts[0] === "level.html") page = "level";
    else if (parts[0] === "boards.html") { page = "leaderboard"; params.set("board", "boards"); }
    else if ((parts[0] === "" || parts[0] === "index.html") && params.size) page = "leaderboard";
    return { page, params, base };
  }

  function url(page, state = {}, extra = {}) {
    const base = root();
    if (page === "home") return `${base}home`;
    const section = state.levelset === "user" ? "userlevel" : "metanet";
    const params = new URLSearchParams();
    let path = `${base}${section}`;
    if (page === "player" || page === "player-levels") {
      path += `/user/${encodeURIComponent(extra.id || "")}`;
      if (page === "player-levels") path += `/${slugs[extra.list] || extra.list}`;
      if (state.board && state.board !== "zeroes") params.set("board", state.board);
    } else if (page === "level") {
      path = `${base}metanet/level/${encodeURIComponent(extra.id)}`;
    } else if (state.board && state.board !== "zeroes") path += `/${slugs[state.board] || state.board}`;
    if (state.board === "average" && state.levelset !== "user" && state.averageFilter === "unfiltered") {
      params.set("average", "unfiltered");
    }
    return path + (params.size ? `?${params}` : "");
  }

  window.Nv2Routes = { read, url, root };
})();
