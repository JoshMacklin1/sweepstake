# Sweepstake — Claude Code instructions

WC2026 Sweepstake Tracker. Full app/architecture/scoring docs live in
**[SWEEPSTAKE_PROJECT.md](SWEEPSTAKE_PROJECT.md)** — read that first for
anything about how the app works, what files do what, or what changed
recently. Keep it updated as you make changes; it's the source of truth,
not this file.

## Stack & constraints

- No build step. React 18 + Babel loaded via CDN `<script>` tags directly
  in `index.html`. No npm, no bundler, no `node_modules`. **Keep it this
  way** — don't introduce build tooling without asking first.
- `index.html` and `scoring.js` are coupled and must be deployed together
  (see "Deployment" in SWEEPSTAKE_PROJECT.md). `scoring.js` is the single
  source of truth for scoring/data logic — change rules, pots, or player
  assignments there only.
- `index.html` guards calls to `scoring.js` functions with
  `typeof fn === "function"` checks so a version mismatch degrades
  gracefully rather than blanking the app. Preserve that pattern when
  adding new `scoring.js` functions that `index.html` calls.

## Local preview & verification

Verifying changes in this repo via headless-browser screenshots has been
consistently unreliable in this environment — don't default to it, and
don't loop on it if it's not cooperating.

- **`/tmp/` isn't real `/tmp`.** The Bash tool's `/tmp/` maps to
  `C:\Users\<user>\AppData\Local\Temp\` on this Windows setup. A file
  written via Bash to `/tmp/foo.png` won't be found by the Read tool at
  that path — run `cygpath -w /tmp/foo.png` first to get the Windows path
  Read actually needs.
- **Headless Chrome hangs on this app specifically.** It polls live match
  data every 60s and has other timers (countdown ticks); Chrome's
  `--screenshot` waits for the page to settle, which it often never does
  here. `--virtual-time-budget=8000` (force a screenshot after ~8s
  regardless of network state) helps but isn't reliable — Chrome
  sometimes never returns control to the shell at all, independent of
  that flag.
- **Don't retry screenshot attempts more than once.** If it hangs, stop —
  retrying just burns turns without fixing anything. Instead:
  1. For logic/syntax changes, validate with a quick Babel parse instead
     of a visual check:
     ```
     node -e 'const fs=require("fs");const Babel=require("@babel/standalone");
     const t=fs.readFileSync("index.html","utf8");
     const s=t.indexOf(`<script type="text/babel">`)+`<script type="text/babel">`.length;
     const e=t.indexOf("</script>",s);
     try{Babel.transform(t.slice(s,e),{presets:["react"]});console.log("OK")}
     catch(err){console.log("ERROR:",err.message)}'
     ```
     (needs `@babel/standalone` installed somewhere — a scratch `npm install`
     outside the repo is fine, don't add it as a repo dependency.)
  2. For anything genuinely visual (layout, color, gesture feel), make a
     throwaway copy of `index.html` with the change applied and ask the
     user to open it themselves the way they normally preview the app.
     This has consistently been faster and more accurate than fighting
     the screenshot tooling.

## Git workflow

- **Feature branch per change.** Branch off `main`, make the change, get
  it reviewed/approved, then merge to `main`. Don't commit straight to
  `main`.
- **Commit after each approved change**, not batched. I create the commit
  myself once you've reviewed the diff and given the go-ahead — never
  commit without that explicit approval first.
- GitHub Pages serves from `main`, so anything merged there deploys
  automatically. No more manual "upload files via GitHub UI" — that was
  the old workflow before this repo was cloned locally.

## Checkpointing

Stop after each meaningful change and let it be reviewed before starting
the next one. Don't chain multiple unrelated changes together and present
them as one batch.

## Conventions

The app was built conversationally (originally via Claude.ai chat, no
local tooling) and has no formally documented code style. Match the
existing style already in `index.html` / `scoring.js`:
- Plain `const`/function components, no class components.
- Inline styles via the `C` palette object (see SWEEPSTAKE_PROJECT.md
  "Visual Design") rather than a CSS framework.
- No TypeScript, no PropTypes — plain JS.
