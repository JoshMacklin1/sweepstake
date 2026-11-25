// ═════════════════════════════════════════════════════════════════════════════
// sim-seasons.js — "Simulate a past season", shared by cl.html (Champions
// League Edition) and league.html (Sweepstaker Top 5).
//
// A simulation is a page-load mode: the chosen season lives in sessionStorage
// ("sweepSim" = "2025" | "2024"), the page reloads, and the app boots on that
// season's real results with a FRESH fair draw over that season's clubs
// (deterministic per group + season). Leaving = clear + reload.
//
//   • 2025-26 data is bundled (league-data-2025.js).
//   • Older seasons load live through the football-data proxy, one request per
//     competition, spaced to stay under the free tier's 10 requests/minute, and
//     cached on the phone (localStorage) so it only happens once.
// ═════════════════════════════════════════════════════════════════════════════

var SIM_PROXY = "https://football-proxy.joshmacklin7.workers.dev";
var SIM_SEASONS = {
  "2025": { label: "2025-26", start: "2025-07-01T00:00:00Z", end: "2026-06-05T00:00:00Z" },
  "2024": { label: "2024-25", start: "2024-07-01T00:00:00Z", end: "2025-06-05T00:00:00Z" },
};
var SIM_STORE = "sweepSim";

function simActive() {
  try { var s = sessionStorage.getItem(SIM_STORE); return SIM_SEASONS[s] ? s : null; } catch (e) { return null; }
}
function simStart(season) {
  try { if (season) sessionStorage.setItem(SIM_STORE, season); else sessionStorage.removeItem(SIM_STORE); } catch (e) {}
  location.reload();
}

// Keep only what the apps read — keeps the phone cache small.
function simTrim(m, code) {
  var t = function (x) { return x ? { id: x.id, tla: x.tla, shortName: x.shortName || x.name, name: x.shortName || x.name } : x; };
  var s = m.score || {};
  return { id: m.id, utcDate: m.utcDate, status: m.status, matchday: m.matchday, stage: m.stage,
    competition: { code: code }, homeTeam: t(m.homeTeam), awayTeam: t(m.awayTeam),
    score: { winner: s.winner, duration: s.duration, fullTime: s.fullTime, regularTime: s.regularTime, extraTime: s.extraTime, penalties: s.penalties } };
}

function simSleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

var _simBundled = null;
function simBundled2025() {
  if (_simBundled) return _simBundled;
  _simBundled = new Promise(function (resolve, reject) {
    if (typeof LEAGUE_REPLAY_DATA !== "undefined") return resolve(LEAGUE_REPLAY_DATA.matches);
    var sc = document.createElement("script");
    sc.src = "league-data-2025.js";
    sc.onload = function () { resolve(LEAGUE_REPLAY_DATA.matches); };
    sc.onerror = function () { reject(new Error("Couldn't load the 2025-26 data")); };
    document.head.appendChild(sc);
  });
  return _simBundled;
}

// Matches for `codes` in `season` (2025 → bundled). onProgress(done, total).
async function simLoad(codes, season, onProgress) {
  if (season === "2025") {
    var all = await simBundled2025();
    if (onProgress) onProgress(1, 1);
    return all.filter(function (m) { return m.competition && codes.indexOf(m.competition.code) !== -1; });
  }
  var out = [], fetched = 0;
  for (var i = 0; i < codes.length; i++) {
    var code = codes[i], key = "simdata_" + code + "_" + season, cached = null;
    try { cached = JSON.parse(localStorage.getItem(key) || "null"); } catch (e) { cached = null; }
    if (!cached) {
      if (fetched > 0) await simSleep(6500); // ≤ 10 requests a minute (free tier)
      var data = null;
      for (var attempt = 0; attempt < 3 && !data; attempt++) {
        var res = await fetch(SIM_PROXY + "/competitions/" + code + "/matches?season=" + season);
        if (res.status === 429) { await simSleep(61000); continue; }
        if (!res.ok) throw new Error(code + " " + season + ": HTTP " + res.status);
        data = await res.json();
      }
      if (!data) throw new Error(code + " " + season + ": rate-limited, try again in a minute");
      fetched++;
      cached = (data.matches || []).map(function (m) { return simTrim(m, code); });
      try { localStorage.setItem(key, JSON.stringify(cached)); } catch (e) { /* full — fine, just not cached */ }
    }
    out = out.concat(cached);
    if (onProgress) onProgress(i + 1, codes.length);
  }
  return out;
}

// ── seeded fair deal ────────────────────────────────────────────────────────
function simHash(str) { var h = 2166136261; for (var i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function simRng(seed) {
  var a = seed >>> 0;
  return function () { a |= 0; a = a + 0x6D2B79F5 | 0; var t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function simShuffle(arr, rng) { var a = arr.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rng() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

// Deal k clubs to each of n players, strongest pots first; each club goes to an
// eligible player with the fewest of that pot, then fewest overall (seeded tie
// break). clubs = [{ key, pot }]. Returns an array of n arrays of club keys.
// Spare clubs (n·k < clubs) are the weakest, left undealt.
function simFairDeal(clubs, n, k, seedStr) {
  var rng = simRng(simHash(seedStr));
  var byPot = {};
  clubs.forEach(function (c) { (byPot[c.pot] = byPot[c.pot] || []).push(c); });
  var order = [];
  Object.keys(byPot).map(Number).sort(function (a, b) { return a - b; })
    .forEach(function (p) { order = order.concat(simShuffle(byPot[p], rng)); });
  order = order.slice(0, n * k);
  var hands = [], potCount = [];
  for (var i = 0; i < n; i++) { hands.push([]); potCount.push({}); }
  order.forEach(function (c) {
    var best = null, bestKey = null;
    simShuffle(hands.map(function (_, i) { return i; }), rng).forEach(function (i) {
      if (hands[i].length >= k) return;
      var key = [potCount[i][c.pot] || 0, hands[i].length];
      if (best === null || key[0] < bestKey[0] || (key[0] === bestKey[0] && key[1] < bestKey[1])) { best = i; bestKey = key; }
    });
    if (best === null) return;
    hands[best].push(c.key);
    potCount[best][c.pot] = (potCount[best][c.pot] || 0) + 1;
  });
  return hands;
}
