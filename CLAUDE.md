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
