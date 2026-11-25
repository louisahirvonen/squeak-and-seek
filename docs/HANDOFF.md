# Handoff — status on Wednesday 25 November 2026

Party: **Saturday 28 November 2026**. Build window: Thursday + Friday, rehearsal Friday.

## Done

- Full game: lobby with QR + room code, multiple choice (2–4 options, several correct allowed), true/false, photo-answer questions, optional image/video on any question, speed scoring, top-5 leaderboard, podium, play again.
- Host refresh recovery ("Resume room"), phone auto-rejoin, kick player from lobby, screen wake lock on phones and host.
- Music picker (lobby / question / podium) with built-in synth tracks, MP3s from `music/`, or a local file chosen on the night; subtle synthesised SFX; mute + volume.
- Spotify Wrapped–style redesign, "Louisa turns 24" title, white blue-eyed birthday rat mascot.
- Fonts and libraries bundled in `vendor/`.
- Verified against the real Supabase project from the live site (join + answer + scoring) before the redesign; e2e passes locally after it.

## Deploy this folder (replaces the nested upload)

The first web upload put every file under `squeak-and-seek/` inside the repo, so the live URLs currently are `…/squeak-and-seek/squeak-and-seek/host.html` and still run the old design with the join bug. This folder is the new source of truth. Pages is set to `main` / root.

This folder now lives at `~/Desktop/rat-party` and is already a git repository on `main` (moved there 2026-11-25), with no remote yet. What is left:

```bash
cd ~/Desktop/rat-party        # this folder
git remote add origin https://github.com/louisahirvonen/squeak-and-seek.git
git push --force origin main  # overwrites what is on GitHub; this history does not share a commit with it
```

After 1–2 minutes: https://louisahirvonen.github.io/squeak-and-seek/host.html. Hard-refresh (Cmd+Shift+R); GitHub Pages caches for ~10 minutes. From then on, normal `git pull` / `git push`.

## To do before Saturday

1. **Smoke test on the live site** after the push: host on the work laptop, join from a phone on mobile data and on Wi-Fi.
2. **Real questions** from Louisa → `questions.json` (Swedish). Validate by loading `host.html`: problems are listed on the title screen.
3. ~~Bias question photos~~ Done 2026-11-25: Louisa's four photos are in `media/` (800×1000 JPEG, under 220 KB each) and the placeholders are gone. The V source was only 236 px wide, so it is a little soft on a big screen; swap in a larger file if she has one. Don't source images of real people from the web.
4. **Music** (optional): drop MP3s in `music/` and list them in `music/music.json` with a credit line. Suggested CC BY 4.0 tracks by Kevin MacLeod (incompetech.com): "Monkeys Spinning Monkeys", "Sneaky Snitch", "Fluffing a Duck". The real Kahoot theme is copyrighted: never commit it; Louisa can pick it as a local file on the night if she wants.
5. **Rehearsal** with a few colleagues on the projector; tweak text sizes/timings.
6. The morning of the party: open the Supabase dashboard to make sure the project isn't paused.

## Party polish (branch `polish/party-feel`, 2026-11-25, not yet merged to `main`)

- Bugs fixed: phones could not answer after "Play again" or after a host refresh re-asked a question; a double key press could skip a screen; a question never ended while the host tab was in the background; the join link broke if the host was opened as `/host` without `.html`; podium phones showed the final place before the big screen did; phone confetti could fire twice; the phone timer bar started full for late joiners.
- Added: streak bonus, double-points final question, staged answer reveal with answer-share bars and "fastest paw", animated leaderboard (rows slide, scores count up, movement arrows, biggest climber, gap to the lead), staged podium with drumroll, awards and the full standings, last-five-seconds tension (faster music, rising ticks, red pulse), who has answered / who we are waiting for, colour wipe between screens, richer phone result screens, easter eggs (see CLAUDE.md).
- Still to try on real hardware: the sound mix on the projector speakers, and vibration on iPhones (Safari has no vibration; Android does).

## Nice-to-haves (only if time allows)

- Show the question text on phones for accessibility (currently big screen only, by design).
- A "next question preview" for the host.
