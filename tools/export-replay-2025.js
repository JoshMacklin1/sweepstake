// ─────────────────────────────────────────────────────────────────────────────
// export-replay-2025.js — regenerate league-data-2025.js with REAL results.
//
// The replay file is a static offline snapshot of the 2025-26 season for all
// six competitions. It can only be built where the CORS Worker is reachable
// (a browser), not the build sandbox. To regenerate:
//
//   1. Open the live app (https://joshmacklin1.github.io/sweepstake/) or any
//      page served over https.
//   2. Open the browser dev console and paste this whole file, then run it.
//   3. It downloads `league-data-2025.js` — replace the repo file with it and
//      commit. (Only data changes, so no loader-version bump is needed.)
//
// Free tier is 10 requests/min; this makes 6 with spacing to stay safe. Watch
// the per-competition counts it logs — a 0 means that competition isn't served
// for season=2025 on the free tier.
// ─────────────────────────────────────────────────────────────────────────────
(async () => {
  const WORKER = "https://football-proxy.joshmacklin7.workers.dev";
  const CODES = ["PL", "PD", "SA", "BL1", "FL1", "CL"];
  const SEASON = 2025;
  const all = [];
  for (const code of CODES) {
    let matches = [];
    try {
      const res = await fetch(`${WORKER}/competitions/${code}/matches?season=${SEASON}`);
      if (!res.ok) throw new Error(res.status);
      matches = (await res.json()).matches || [];
    } catch (e) { console.error("Failed", code, e.message); continue; }
    matches.forEach(m => {
      if (!m.homeTeam || !m.awayTeam) return; // skip TBD knockout placeholders
      const ft = (m.score && m.score.fullTime) || {};
      all.push({
        id: m.id, utcDate: m.utcDate, status: m.status, matchday: m.matchday, stage: m.stage,
        competition: { code: m.competition.code },
        homeTeam: { id: m.homeTeam.id, tla: m.homeTeam.tla, shortName: m.homeTeam.shortName },
        awayTeam: { id: m.awayTeam.id, tla: m.awayTeam.tla, shortName: m.awayTeam.shortName },
        score: { winner: m.score ? m.score.winner : null, fullTime: { home: ft.home ?? null, away: ft.away ?? null } },
      });
    });
    console.log(code, "→", matches.length, "matches");
    await new Promise(r => setTimeout(r, 7000)); // stay under the free-tier rate limit
  }
  const out = {
    season: "2025-26",
    note: "Real 2025-26 results (PL/La Liga/Serie A/Bundesliga/Ligue 1/Champions League) from football-data.org, trimmed for replay mode.",
    matches: all,
  };
  const body =
    "// Real 2025-26 results for all six competitions (football-data.org), trimmed\n" +
    "// for dev/replay mode. Regenerate with tools/export-replay-2025.js.\n" +
    "var LEAGUE_REPLAY_DATA = " + JSON.stringify(out) + ";\n";
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([body], { type: "text/javascript" }));
  a.download = "league-data-2025.js";
  a.click();
  console.log("✅ Exported", all.length, "matches across", CODES.length, "competitions");
})();
