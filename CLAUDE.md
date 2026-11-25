# CLAUDE.md — Squeak & Seek

Read this first. Then `docs/HANDOFF.md` (status and to-dos) and `docs/SPEC.md` (product spec).

## What this is

A Kahoot-style live quiz for **Louisa's 24th birthday party on Saturday 28 November 2026** (~15 players).
A laptop on a projector runs the host screen; players join on their phones by QR code.
Rat birthday theme, Spotify Wrapped–style visual design. Buttons and UI text in **English**; quiz questions in **Swedish**.

- Live site (GitHub Pages): https://louisahirvonen.github.io/squeak-and-seek/ (host: `host.html`)
- Repo: https://github.com/louisahirvonen/squeak-and-seek (see HANDOFF: the first upload put everything in a nested `squeak-and-seek/` folder; this folder is meant to replace it)

## Stack and constraints

- Plain HTML/CSS/JS. **No build step, no framework, no bundler.** GitHub Pages serves the repo root as-is.
- Realtime: **Supabase Realtime Broadcast** (free plan). No database tables, no server code, no auth. The host browser holds all game state.
- Third-party code is vendored in `vendor/` (supabase-js 2.119.2 UMD, qrcode-generator 2.0.4, fonts) so blocked CDNs on work/guest networks can't break the game. Don't switch to CDN links.
- `js/config.js` has the Supabase URL and **publishable** key (`sb_publishable_…`), public by design. Never commit a secret key.
- Free Supabase projects pause after ~7 days without activity. Resume from the dashboard if the game stops connecting.

## Files

| Path | Role |
| --- | --- |
| `host.html`, `js/host.js` | Big screen. State machine + rendering. Exposes `window.__host` for debugging/tests. |
| `index.html`, `js/player.js` | Phone. Join, answer, see result. |
| `js/common.js` | Shared: palette, answer glyphs (SVG), rat + avatar SVGs, question normalisation, scoring, transport, confetti. Exposes `window.SQ`. |
| `js/audio.js` | Host-only music picker (3 slots: lobby / question / podium), built-in WebAudio synth tracks, subtle synthesised SFX. Exposes `window.SQAudio`. |
| `js/config.js` | Supabase settings, birthday name/age, questions file. |
| `css/app.css` | All styling for both screens. Colour moods are driven by `body[data-phase]` (+ `data-tone` on intro, `data-result` on phone reveal). |
| `questions.json` | Quiz content (format in README). Currently placeholder test questions. |
| `media/` | Question images/videos. `placeholder-*.svg` are stand-ins for the four photos Louisa will supply. |
| `music/music.json` | Optional MP3 list for the music picker (empty: built-in synth is used). |
| `tests/` | Playwright end-to-end test + fixtures. |

## Game protocol (don't break this)

Two broadcast topics per room code `CODE`:

- `squeak-CODE` — host → phones (websocket send). Events: `state` (phase, q index, type, option count, photo options, `endsIn` ms, correct on reveal), `results` (per-player name/score/rank, + correct/points during reveal), `kick`.
- `squeak-CODE-host` — phones → host only, sent with **REST `httpSend`** so answers aren't fanned out to every phone (Supabase free plan: 100 msgs/s). Falls back to websocket send if REST fails. Events: `join {id,name}`, `answer {id,q,choice}`.

Host re-broadcasts `state` every 4 s as a heartbeat. A phone that (re)joins triggers a full `state` + `results` broadcast. Phones keep `{id,name,code}` in localStorage, so reloads rejoin as the same player.
Answer timing is measured on the **host** clock at receipt. Points = `round(1000 × (1 − t / (2 × limit)))` for correct answers (500–1000), else 0. Several correct options are allowed (`correct: [0, 2]`); a player picks one.

Phases: `title → lobby → intro → question → reveal → leaderboard → … → podium`. Video questions stay in `intro` until the clip ends, then the timer starts.
Host state is saved to localStorage after each reveal; "Resume room" on the title screen restores it after an accidental refresh.

## Testing

- **Local transport:** add `?transport=local` to both pages to run everything over `BroadcastChannel` in one browser (no Supabase). Add `&slot=1`, `&slot=2`… to player tabs so each gets its own identity.
- **E2E:** `cd tests && npm install && npx playwright install chromium && npm test`. Plays a full game with 3 players (incl. video, photo, true/false and multi-correct questions), refreshes + resumes the host, checks scores, rejoin and console errors. Screenshots go to `tests/shots/` (git-ignored). **Run it after every change and look at the screenshots** — layout bugs don't throw errors.
- **Real Supabase:** serve the folder (`python3 -m http.server`) or use the live site, open `host.html`, then join from a phone. The room-code chip in the top bar turns coral if the host can't reach Supabase.

## Gotchas learned the hard way

- `hash()` returns an unsigned int; always use `>>>` (not `>>`) when deriving indexes from it. A signed shift made ~40% of player ids crash the phone page (the e2e test guards this).
- CSS class names are global: a leaderboard `.bar` once collided with the top bar `.bar`. Prefix new classes by screen.
- Decorative shapes (`.deco`) are `position: fixed` behind content; content sits at `z-index: 1`.
- Browsers block audio until a click; "Start the party" unlocks it. Phones never play audio.
- `navigator.vibrate` errors in automated tests are harmless (no real tap).
- Don't add emoji to the UI; the design uses the SVG glyphs in `common.js` and the bundled fonts (Bricolage Grotesque + DM Sans).

## Working with Louisa

She's comfortable in the terminal with git and prefers short, practical explanations. The party is close: favour small, tested changes over refactors, and keep `main` deployable at all times (it's live).
