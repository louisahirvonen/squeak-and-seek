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
| `questions.json` | Quiz content (format in README). Louisa's own questions only; don't add filler. |
| `media/` | Question images/videos. `v.jpg`, `jimin.jpg`, `jin.jpg`, `jhope.jpg` are Louisa's own photos for the bias question, cropped to 800×1000 with the face about a third of the way down (photo answers are shown with `object-position: center 30%`). `move-*.jpg` are her pictures for the signature-move question, each whole figure placed inside the middle ~75% × 80% of the same canvas so neither the tall host card nor the squarer phone button cuts off a limb. `city-*.svg` are hand-drawn option icons (`"icon"` on a multiple-choice option). |
| `music/music.json` | Optional MP3 list for the music picker (empty: built-in synth is used). |
| `tests/` | Playwright end-to-end test + fixtures. |

## Game protocol (don't break this)

Two broadcast topics per room code `CODE`:

- `squeak-CODE` — host → phones (websocket send). Events: `state` (phase, q index, type, option count, photo options, `endsIn` ms, correct on reveal), `results` (per-player name/score/rank, + correct/points during reveal), `kick`.
- `squeak-CODE-host` — phones → host only, sent with **REST `httpSend`** so answers aren't fanned out to every phone (Supabase free plan: 100 msgs/s). Falls back to websocket send if REST fails. Events: `join {id,name}`, `answer {id,q,choice}`, `squeak {id}` (lobby only: the guest tapped their rat; rate-limited to 2/s on both ends), `leave {id}` (the guest tapped Leave: removed in the lobby, marked `gone` after that).

`state` also carries `k` (a key that is new every time a question is asked; phones remember "I answered" by `k`, never by question number, so "Play again" and a host refresh can't lock a phone out), `limit`, `g` (game number), `dbl` (this question is double), `fin` (the next one is the double final), `wait` (ms the phone holds its reveal while the big screen builds suspense) and, on the podium, `rv`/`el` (when each podium place is revealed, and how long ago the podium started). `results` rows also carry `st` (streak), `d` (places moved), `up {n,g}` / `lead` (gap to the rat above / below the leader), `b` (bonus), `t` (answer time), `f` (fastest), `bd` (birthday rat). New fields must stay optional: a phone on a cached older page ignores them.

**Answers are acknowledged.** During a question `state.a` lists `SQ.hash(id)` for every answer the host has; the host sends a `state` right after each answer. A phone that has locked in but does not see itself in `a` sends the answer again every 1.2 s (the host ignores duplicates) and, after the first resend, shows "Sending your answer…". Never show an answer as safe on the phone by any other rule.
**Who a question waits for:** a player who left (`gone`) or missed two questions in a row (`idle >= 2`) is "away": the question ends early without them, and they are not named in "Waiting for…". They keep their score and count again as soon as they answer or rejoin. Players removed in the lobby go on `S.kicked` (saved with the room) and are refused if they rejoin.
`results` rows carry `nw` for someone who joined after the current question started (the phone welcomes them instead of "Too slow").

Host re-broadcasts `state` and `results` every 4 s as a heartbeat. A phone that hears nothing for 13 s shows the reconnect banner and opens a fresh connection without changing its screen (`start(true)`). A phone that (re)joins triggers a full `state` + `results` broadcast. Phones keep `{id,name,code}` in localStorage, so reloads rejoin as the same player.
Answer timing is measured on the **host** clock at receipt. Points = `round(1000 × (1 − t / (2 × limit)))` for correct answers (500–1000), else 0. Several correct options are allowed (`correct: [0, 2]`); a player picks one.
A `number` question has no options: `state` carries `min`/`max`/`unit`, the phone sends the chosen number as `choice`, and `S.counts` is then a map of guessed value → how many. Only the exact number is correct, unless the question has `"scoring": "closest"`: then `endQuestion` ranks the distinct distances from the right number, the closest group is `correct` with 1000 points, group `g` of `G` gets `round(1000 × (1 − g/G))`, speed is ignored, and a near miss neither breaks nor extends a streak. `state.cl` and `results.off` tell the phone.
On top of that (all applied in `endQuestion`): a **streak bonus** (2 right in a row +100, 3 +200, 4 or more +300; a miss or no answer resets it) and a **double final question** (`doubleFinal` in `js/config.js`, only when the quiz has 3+ questions; base and bonus are both doubled).

**Vote questions** (`type: "vote"`): no `correct` in the file. `endQuestion` sets `cq.correct` to the most-voted option(s) (at least two votes needed unless only one rat answered); those answers get a flat 1000 (+ streak bonus), speed is ignored, and being outvoted leaves the streak alone. In a guest vote the most-voted rat also gets `PICK_BONUS` (300) via `S.picked`, sent as `results.fav`. With `"options": "players"` (`cq.guests`) the options are filled in `startQuestion` from the players present, `state.opts` carries `{label, pid, bd}`, the phone hides its own name and the host refuses a self-vote.
**Dare** (`type: "dare"`): a surprise event, not a question. It sits in `S.questions` at its place in the running order but is left out of every count and number shown (`realNo()`, `realTotal()`, `finalIdx()`; `state.no`/`state.of` for phones). Never use `S.qi + 1` or `total()` for anything a guest reads. The intro is its own screen (`renderDareIntro`, 7 s, `body[data-dare]`): siren, warning stripes, a title that slams in, a mystery silhouette, then the task card; phones show a matching warning. Its layers are positioned against the stage with `.stage > section.dare-intro > …` selectors, because `.stage > section > *` forces `position: relative` and the stage animation breaks `position: fixed`. Flow: intro → `startDare()` goes straight to `reveal` (no question phase) and `renderDare()` spins a wheel. `pickDare()` chooses before the spin: weight `1 + (hi − score)/(hi − lo)`, times `0.25` per dare already had; away players and the birthday rat are not on the wheel. `S.dare {id, name, st, k, list}`; `st` goes `spin → asked → accepted` (phone event `dare {id, ok}`) `→ done | failed | declined` (host buttons in `#dareBox`, which also work from `asked`). `done` adds `cq.points` (default 1500). The first `declined` of a dare becomes `steal` for `STEAL_S` seconds: any other phone (not the birthday rat) may send `steal {id}`, and the first one in becomes the dare's rat with `st: 'accepted'` and `stolen` (`state.dare.sto`). No taker, or the host's "No takers", ends it as `declined`. `state.dare {n, h, st, pts}` drives the phones and carries no name while `st` is `spin`. The screen does not auto-advance until the dare is over. Optional `seconds` gives the host a clock (`startDareClock`, which also marks the dare accepted); optional `music` plays the `dance` music slot while it runs. A verdict stops both.
**Anonymous answers** (`type: "write"`): an extra `write` phase after the intro (`startWrite`; phones send `text {id, t}`, max `SQ.WRITE_MAX` chars, acknowledged through `state.a`), then `finishWrite` turns the texts into shuffled `cq.options {label, pid}` and runs the normal question phase as a vote. `state.opts` carries `{label, h}` only (no names); phones leave out their own, the host refuses a vote for one's own. `endQuestion` gives the winning writer(s) 1000 via `S.extra`, and `results.v` tells each writer their votes. Names show on the reveal only.
**Bet your cheese** (`wagerFinal: true` in config; replaces the double final): a `wager` phase sits between the last leaderboard and the final intro. Phones send `bet {id, pct}` (pct from `SQ.BETS`), acknowledged through `state.a` like answers; the stake is `SQ.stake(score, pct)` = that share of `max(score, 1000)`. `endQuestion` adds it when right and removes it (never below zero) when wrong or silent; `results.wg` is the signed outcome. `state.wgn` on the leaderboard announces the round, `state.wg` marks the final question.
**Reactions:** phones send `react {id, r}` (index into `SQ.REACTIONS`) during reveal, leaderboard and podium; rate-limited to one per 0.6 s per guest on both ends, at most 40 on screen.

Phases: `title → lobby → intro → (write) → question → reveal → leaderboard → … → (wager) → final question → podium`. Video questions stay in `intro` until the clip ends, then the timer starts.
Host state is saved to localStorage after each reveal; "Resume room" on the title screen restores it after an accidental refresh.
The reveal and the leaderboard advance on their own after `autoAdvanceSeconds` (config, 20; 0 turns it off) via `autoNext()`; the lobby, a video intro and the podium never do, and a question nobody answered starts paused so an unattended quiz stops. After an automatic advance `next()` ignores clicks and keys for 1.6 s, so a click aimed at the old screen can't skip the new one. Pause is the button next to Next, or **P**.
Anything timed inside a phase goes through `later()` in `host.js`, which is cleared on every phase change. Don't use a bare `setTimeout` for phase behaviour.

## Easter eggs (keep them working, don't advertise them in the UI)

- Host keyboard: type `rat` (stampede along the bottom), `cheese` (cheese rain) or the birthday age `24` (confetti + fanfare). Avoid words containing `m` or `f`: those keys mute and toggle full screen.
- Poke the birthday rat on the host title screen (five pokes: cheese rain) or on the phone join screen.
- Phone lobby: tapping your rat squeaks and wiggles your name on the big screen (the one egg that is hinted: "Psst. Tap your rat.").
- Joining with the birthday name from `config.js` gives the white, blue-eyed rat with a party hat, a pink chip and confetti.

## Testing

- **Local transport:** add `?transport=local` to both pages to run everything over `BroadcastChannel` in one browser (no Supabase). Add `&slot=1`, `&slot=2`… to player tabs so each gets its own identity.
- **E2E:** `cd tests && npm install && npx playwright install chromium && npm test`. Plays a full game with 3 players (incl. video, photo, true/false and multi-correct questions), refreshes + resumes the host, checks scores, streaks, rejoin, "Play again", two easter eggs and console errors.
- **Night-of failures:** `cd tests && npm run round2` checks the fixes from the second bug round: a lost answer is resent, Leave and Remove, late joiners, the unattended-quiz hold, hold-to-repeat on the counter, and Resume as the main button after a refresh.
- **Party modes:** `cd tests && npm run modes` plays votes, reactions and the betting round with 15 players and checks the scoring (screenshots `tests/shots/modes-*.png`).
- **Party-size layout:** `cd tests && npm run crowd` (add `W=1280 H=720` in front for a small projector) plays the real `questions.json` with 15 players and saves `tests/shots/crowd-*.png`. No assertions; look at the pictures, especially leaderboard and podium. Screenshots go to `tests/shots/` (git-ignored). **Run it after every change and look at the screenshots** — layout bugs don't throw errors.
- **Real Supabase:** serve the folder (`python3 -m http.server`) or use the live site, open `host.html`, then join from a phone. The room-code chip in the top bar turns coral if the host can't reach Supabase.

## Gotchas learned the hard way

- `hash()` returns an unsigned int; always use `>>>` (not `>>`) when deriving indexes from it. A signed shift made ~40% of player ids crash the phone page (the e2e test guards this).
- CSS class names are global: a leaderboard `.bar` once collided with the top bar `.bar`. Prefix new classes by screen.
- Decorative shapes (`.deco`) are `position: fixed` behind content; content sits at `z-index: 1`.
- Browsers block audio until a click; "Start the party" unlocks it. Phones never play audio.
- `navigator.vibrate` errors in automated tests are harmless (no real tap).
- The reveal and the podium are staged with CSS `animation-delay` (0.9 s for the right answer; `--d` per podium card). Anything that must look right without animation needs a rule in the `prefers-reduced-motion` block at the end of `app.css`.
- **Never play the game's audio from an automated run.** Louisa could not find or stop music that a hidden page was playing. Tests launch Chromium headless with `--mute-audio`; do the same in any new script, and do not open the game in a visible browser or preview pane to check something.
- After a refresh the title screen's main button is "Resume room"; "Start a new party" asks first, because it throws the running game away. A saved room is offered for 12 hours, so a test in the afternoon leaves a Resume button for the evening: start a new party then.
- Short projector screens (720p, 768p) have their own rules under `@media (max-height: 800px)`; check them with the `W`/`H` crowd run.
- GitHub Pages lets browsers keep JS and CSS for 10 minutes, while `questions.json` is always fetched fresh. An old `common.js` with new questions once showed "(q.options || []).map is not a function" on the title screen. `host.html` and `index.html` therefore load the game's own JS and CSS with a `?v=` that changes every minute (`window.SQV`); keep new script or style tags inside that loader.
- A question's `after.video` clip is fetched when the question starts (`clipFor`) and played by `playAfter` from `endQuestion` once the answers are in, still in the `question` phase (`clipPlaying` blocks late answers and a second `endQuestion`); the reveal follows when it is over. `go()` pauses every video in the stage, because a removed video keeps playing its sound. There is no ffmpeg on Louisa's Mac: trim with `avconvert --preset PresetHighestQuality --start 0 --duration 30` (the medium preset shrinks a portrait clip to 256 px wide). The bundled test Chromium cannot play H.264; check a real clip with `chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio'] })`.
- Don't add emoji to the UI; the design uses the SVG glyphs in `common.js` and the bundled fonts (Bricolage Grotesque + DM Sans).

## Working with Louisa

She's comfortable in the terminal with git and prefers short, practical explanations. The party is close: favour small, tested changes over refactors, and keep `main` deployable at all times (it's live).
