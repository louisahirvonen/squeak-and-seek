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
5. Keyboard: **M** mutes, **F** goes full screen.

If the host browser refreshes by accident, click **Resume room …** on the title screen. Scores and players are kept.

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

- `correct` counts from 0 (`0` = first option). Use a list like `[0, 2]` when several answers count as right. True/false uses `true` or `false`.
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
