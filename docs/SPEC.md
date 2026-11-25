# Squeak & Seek — product spec (condensed)

Full working spec: https://claude.ai/artifact/AAuhq68U62LmH9KXkdtSmP (Claude Docs). This file is the summary that lives with the code.

## Goal

A live quiz for Louisa's 24th birthday: one big screen runs the show, ~15 players answer on their phones, a leaderboard crowns the winner. Free hosting (GitHub Pages + Supabase free plan). Must look like a polished, award-winning quiz product (Spotify Wrapped energy), not a children's game, while keeping the rat birthday theme.

## Decisions

| Topic | Decision |
| --- | --- |
| Name | Squeak & Seek |
| Mascot | Louisa as a white rat with blue eyes and a party hat |
| Language | UI in English, questions in Swedish |
| Players | ~15, join by QR code or URL + 4-letter room code; late joiners allowed |
| Question types | Multiple choice (2–4 options), true/false, photo answers; optional image or video on any question |
| Correct answers | One or several per question; players pick one; any correct one scores in full |
| Scoring | 500–1000 points for a correct answer depending on speed, 0 otherwise; host clock decides. Streak bonus (+100/+200/+300 from the 2nd correct answer in a row) and a double-points final question (added 2026-11-25, `doubleFinal` in config) |
| Timer | 20 s default, per-question override; a video plays first, timer starts when it ends |
| Leaderboard | Top 5 after each question; podium (top 3) at the end |
| Sound | Host screen only. Music picker for lobby / questions / podium; subtle SFX; mute + volume |
| Builder UI | None: questions live in `questions.json` |
| First question | "Vem är Louisas bias?": photos of V, Jimin, Jin, J-Hope (V correct); photos supplied by Louisa |

## Flow

| # | Big screen | Phone |
| --- | --- | --- |
| 1 | Title → "Start the party" | — |
| 2 | Lobby: QR, URL, room code, guest list | Enter code + name → "You're in" |
| 3 | Intro: question text (+ media) for 4 s or the video | "Get ready" / "Watch the video" |
| 4 | Question: text, timer, answers, answered counter | Coloured answer buttons (icons; labels for true/false and photos) |
| 5 | Reveal: correct highlighted, counts per option | Correct (+points) / wrong / too slow, current rank |
| 6 | Leaderboard (top 5) | Your rank and points |
| 7 | Repeat 3–6, then podium | Final rank, "Happy 24th, Louisa!" |

## Out of scope

Accounts, saved history, team mode, several simultaneous games, a question editor.
