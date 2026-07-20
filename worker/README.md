# Sweepstaker League — draft backend

A small Cloudflare Worker + Durable Object that powers **live, multi-player
league drafts** for the Sweepstaker 26/27 app (`league.html`). It is a
**separate Worker** from `football-proxy` (the match-data / push service), so
deploying it can never affect that one.

## What it does

- Holds one authoritative league per code (`lobby → drafting → complete`).
- Lets people **join by link and set a player name**.
- Lets the **host start** the draft (randomises order, closes the lobby).
- Runs a **snake / ABBA draft** with server-enforced turn order — no
  double-picks, even with everyone clicking at once.
- **Pushes live updates over a WebSocket**, so everyone on a call sees the
  roster shrink and picks appear in real time.

It stores only opaque team **ids**. The football data (which teams exist, pots,
scoring) stays in `league-scoring.js` on the client — still the single source
of truth. The client sends the eligible id pool at create time.

## HTTP / WS API

| Method | Path | Body | Purpose |
| ------ | ---- | ---- | ------- |
| POST | `/league` | `{ name, competitions[], poolTeamIds[], hostName }` | Create a league; returns `{ code, hostToken, playerId }`. |
| GET  | `/league/:code` | – | Current state snapshot. |
| GET  | `/league/:code/ws` | – (WebSocket upgrade) | Live state feed. |
| POST | `/league/:code/join` | `{ name }` | Join as a player (lobby only); returns `{ playerId, token }`. |
| POST | `/league/:code/start` | `{ hostToken }` | Randomise order, begin drafting. |
| POST | `/league/:code/pick` | `{ token, teamId, expectedTurnNo }` | Claim a team on your turn. |

Tokens (`hostToken`, per-player `token`) are secrets kept in each user's
`localStorage`; they authenticate actions without any login. The public state
view never exposes them.

## Deploy

```bash
cd worker
npx wrangler login       # once, to authenticate your Cloudflare account
npx wrangler deploy
```

Wrangler prints the deployed URL (e.g.
`https://sweepstaker-league.<subdomain>.workers.dev`). Put that value into
`league.html` as `LEAGUE_API_URL` (added in a later phase) so the app talks to
this Worker.

## Cost

Durable Objects (SQLite-backed) and WebSockets are included in the Cloudflare
**free** Workers plan. A friends-and-family draft is orders of magnitude below
any free-tier limit.
