# Squeak & Seek

A rat-birthday-party quiz game for Louisa's 24th. The big screen runs the show, players join on their phones.

Live: https://louisahirvonen.github.io/squeak-and-seek/host.html · Working on the code? Start with [CLAUDE.md](CLAUDE.md).

- **Host screen (laptop/projector):** `host.html`
- **Players (phones):** the site's main page (the QR code on the host screen opens it with the room code filled in)

Hosted on GitHub Pages; Supabase Realtime (free plan) relays messages between the screen and the phones. There's no server or database.

## Running a game

1. Open https://louisahirvonen.github.io/squeak-and-seek/host.html on the laptop connected to the projector.
2. Optional: open **Music & sound** to choose tracks.
3. Click **Start party**. Players scan the QR code (or type the address and room code).
4. Click **Start game** when everyone has joined. Use the big yellow button or press **Space** / **→** to move on.
5. The answer screen and the leaderboard move on by themselves after 20 seconds (the button shows the countdown). Click the button to go sooner, or **Pause** (or press **P**) to hold. Change or turn off the timing with `autoAdvanceSeconds` in `js/config.js`.
6. Keyboard: **M** mutes, **F** goes full screen, **P** pauses the countdown.

If the host browser refreshes by accident, click **Resume room …** on the title screen. Scores and players are kept.

### Scoring

A correct answer gives 500–1000 points depending on speed. Answering right several times in a row adds a streak bonus (+100, +200, then +300 per question). The last question is worth double; set `doubleFinal: false` in `js/config.js` to turn that off. The podium also hands out three small awards: fastest paw, hottest streak and comeback rat.

## Editing questions

Edit `questions.json`, commit and push. The site updates within a minute or two (hard-refresh the host screen).

```json
{
  "title": "Squeak & Seek",
  "defaultTimeLimit": 20,
  "questions": [
    { "type": "multiple", "text": "Hur många tänder har en råtta?", "options": ["12", "16", "24", "32"], "correct": 1 },
    { "type": "multiple", "text": "Vilka är gnagare?", "options": ["Råtta", "Kanin", "Hamster"], "correct": [0, 2] },
    { "type": "truefalse", "text": "Råttor skrattar när man kittlar dem.", "correct": true },
    { "type": "photo", "text": "Vem är Louisas bias?", "options": [
        { "label": "V", "image": "media/v.jpg" },
        { "label": "Jimin", "image": "media/jimin.jpg" }
      ], "correct": 0 },
    { "type": "multiple", "text": "Vad händer sen?", "media": { "video": "media/clip.mp4" }, "options": ["A", "B"], "correct": 0, "timeLimit": 15 }
  ]
}
```

- A number question lets players step a counter up and down on their phone and lock it in; only the exact number counts: `{ "type": "number", "text": "Hur länge …?", "min": 0, "max": 15, "unit": "år", "correct": 6 }`. Add `"scoring": "closest"` to score by closeness instead: the closest guess in the room gets 1000 points and each step further down the ranking gets evenly less (speed doesn't matter).
- Any question can play a clip once the answer is out: add `"after": { "video": "media/pills.mp4", "seconds": 30 }`. It takes over the big screen a few seconds after the right answer shows, stops at `seconds` (or at its end), and only then does the countdown to the leaderboard start. "Skip video" ends it early.
- A vote has no right answer: the most popular answer wins, and everyone who picked it gets 1000 points (a tie lets both win; being outvoted costs nothing and doesn't break a streak). Let guests vote for each other with `{ "type": "vote", "text": "Vem har bäst outfit ikväll?", "options": "players" }` (nobody can vote for themselves), or between your own answers with `"options": ["Ost", "Skinka", "Kaviar"]`.
- A dare is a surprise event between questions, not a numbered question: `{ "type": "dare", "text": "Håll ett hyllningstal till Louisa på 20 sekunder." }`, placed in the list where it should happen. A wheel of fortune picks a guest (never the birthday rat). The wheel looks fair but leans a little towards low scores: last place is twice as likely as the leader, and someone who already had a dare rarely gets another. The chosen guest taps "I'll do it" or "No thanks" on their phone; then you press Done, Failed or Declined on the big screen. Done gives 1,500 points (`"points": 2000` changes that); nothing is lost otherwise. The screen waits for your verdict. Add `"seconds": 30` to get a "Start the clock" button for the dare, and `"music": true` to play the dance music while the clock runs (choose that music under "Dance dare" in Music & sound; the built-in one is a goofy oom-pah).
- An anonymous-answer question has everyone write their own answer (45 seconds, 60 characters), then shows the answers without names and lets the room vote for the best (40 seconds; nobody can vote for their own): `{ "type": "write", "text": "Vad är Louisas bästa egenskap?" }`. The writer of the winning answer gets 1,000 points, and the names appear once the vote is over.
- Before the last question everyone bets part of their score on getting it right ("Bet your cheese": nothing, a quarter, half or all in; win the bet if right, lose it if wrong, and everyone can stake at least 1,000). Set `wagerFinal: false` in `js/config.js` to get a double-points final instead.
- On the result screen, the leaderboard and the final screen, phones have four reaction buttons; each tap floats up the big screen next to that guest's rat.
- `correct` counts from 0 (`0` = first option). Use a list like `[0, 2]` when several answers count as right. True/false uses `true` or `false`.
- An option can carry a small picture next to its text: `{ "label": "Berlin", "icon": "media/city-berlin.svg" }` (big screen only; phones show the coloured buttons).
- `media` adds one picture (`"image"`) or one video (`"video"`, MP4) above the question. A video plays first and the timer starts when it ends.
- Put pictures and videos in the `media` folder. Keep videos under 25 MB.
- `timeLimit` (seconds) is optional per question.
- Mistakes in the file are listed on the host title screen.

## Music

Built-in wonky synth tracks work out of the box. To add your own:

1. Put MP3 files in the `music` folder.
2. List them in `music/music.json`:

```json
{ "tracks": [
  { "file": "monkeys-spinning-monkeys.mp3", "title": "Monkeys Spinning Monkeys", "credit": "\"Monkeys Spinning Monkeys\" Kevin MacLeod (incompetech.com), CC BY 4.0" }
] }
```

The credit is shown on the lobby and podium screens. You can also pick an MP3 from the host laptop on the night ("Choose a file from this computer"); it isn't uploaded anywhere.

## Testing

- Add `?transport=local` to both pages to run everything inside one browser without Supabase (one host tab, several player tabs with `&slot=1`, `&slot=2`… so they get separate identities).
- End-to-end test: `cd tests && npm install && npx playwright install chromium && npm test` (screenshots in `tests/shots/`).

## Supabase

`js/config.js` holds the project URL and the **publishable** key. Both are safe to be public. Never put the secret key in this repo. Free Supabase projects pause after a week without activity; resume the project from the Supabase dashboard if that happens.
