# screenpet

A desktop pet that reads your screen and answers the question on it. Nothing
leaves your machine.

Phase 1. The pet now has a care loop — it gets hungry, bored and tired, naps when
you walk away, wanders along the bottom of the screen, and remembers you between
sessions.

## The one rule

**Pet state never gates answering.** A starving, exhausted pet still answers your
question, and still answers it correctly. Mood changes the wording and nothing
else. Gating usefulness on pet care is charming for a day and infuriating after
that, so there is a test asserting the pet can never be told to decline.

## The care loop

Four stats, all 0..100, all higher-is-better: **fullness**, **happiness**,
**energy**, **bond**.

Decay is a pure function of elapsed wall-clock time, so closing the app for eight
hours gives exactly the same result as leaving it open for eight hours. It is
capped at 24 hours of decay however long you were away — come back from holiday
to a hungry pet, not a dead one. Bond never decays; it is the relationship, not
a need.

| You do | It does |
| --- | --- |
| Click the pet | Headpat. Happiness and bond up, hearts. |
| Right-click | Menu: Feed, Play, Read screen, Quit. |
| Hover | Shows the three need bars under the pet. |
| Walk away 5 minutes | Naps. Energy regenerates instead of draining. |

A full pet refuses food and a tired pet refuses to play, and the menu greys those
out rather than letting you find out by clicking. Every action has a cooldown so
you cannot spam a stat to 100.

Mood is derived from the stats, never stored, and drives both the sprite and the
tone of answers: `sleepy`, `hungry`, `sad`, `happy`, `neutral`.

Unprompted nagging is throttled to once every three hours. A pet that talks more
than that gets uninstalled.

State lives in `pet.json` in Electron's `userData` directory. It is validated on
load, so a corrupted or hand-edited file degrades to a fresh pet instead of
crashing.

## How answering works

1. You press `Ctrl+Shift+Space`.
2. The pet hides itself and grabs one frame of the primary screen.
3. Windows' built-in OCR (`Windows.Media.Ocr`) reads the text off it.
4. The text goes to a local model on `127.0.0.1:11434` via Ollama.
5. The pet says the answer in a speech bubble.

The screenshot is never written to disk. It is passed to OCR as bytes on stdin
and decoded from an in-memory stream. Nothing is stored — no history, no cache.

OCR is the OS's, not a bundled model, so there is no download and it runs fine on
a laptop with no GPU. That matters more than it sounds: a vision model would gate
the whole app behind 8GB of VRAM.

## Requirements

- Windows 10/11
- [Ollama](https://ollama.com) running locally
- Node 18+

## Run

```bash
npm install
```

```bash
npm start
```

Default model is `llama3.1:8b`. Pull it if you do not have it:

```bash
ollama pull llama3.1:8b
```

A reasoning model like `phi4-mini-reasoning:3.8b` gives better maths but emits
far more tokens, and on CPU it blew the 120s timeout in testing. Bigger and
non-reasoning beats smaller and reasoning here.

## Keys

| Key | Does |
| --- | --- |
| `Ctrl+Shift+Space` | Read the screen and answer |
| `Ctrl+Shift+Q` | Quit |

The window spans the bottom strip of the screen but stays click-through; the
renderer hit-tests the pet and tells the main process when clicks should land, so
everything outside the pet keeps working normally. It never takes focus from what
you are doing.

## Config

| Env var | Default |
| --- | --- |
| `SCREENPET_MODEL` | `llama3.1:8b` |
| `SCREENPET_OLLAMA` | `http://127.0.0.1:11434` |
| `SCREENPET_HOTKEY` | `CommandOrControl+Shift+Space` |
| `SCREENPET_TIMEOUT_MS` | `120000` |

## Verify the privacy claim

Do not take the above on trust. Block the app's outbound network access in
Windows Defender Firewall and use it. It should work exactly the same, because
the only socket it opens is to loopback.

Screen text is scanned for secrets before it reaches the model — API keys,
tokens, JWTs, card-shaped digit runs, and `password:`-style assignments are
replaced with `[REDACTED]`. That is a coarse net, not a guarantee; see
`SECRET_PATTERNS` in [brain.js](brain.js).

## Test

```bash
npm test
```

Covers redaction, reasoning-block stripping, OCR cleanup, and every failure path
of the model call. No framework.

```bash
npm run verify:ui
```

Drives the real UI over real IPC — speech, all five moods, stat bars, hover
hit-testing, headpat, and every menu item — and fails on any console error.
Writes `pet-preview.png`, `pet-hungry.png` and `pet-menu.png` to look at.

It earns its place. It has already caught three bugs that unit tests cannot see:
a `const pet` in `renderer.js` colliding with the `contextBridge` global and
killing the whole script at parse time; Chromium's auto-dark-mode inverting the
bubble to grey; and `.menu { display: flex }` overriding the UA `[hidden]` rule
so the context menu was permanently on screen. That last one passed a
`.hidden`-property assertion while being plainly visible in the capture — assert
computed style, not the property.

```bash
npm run smoke
```

Runs capture → OCR → model once against your real screen, prints the answer, and
exits. The one path the other two cannot reach.

## Known ceilings

- **Primary display only.** Multi-monitor picks the primary one.
- **Whole screen, no region select.** More text than needed, so a busy screen
  makes for a worse prompt.
- **Text only.** OCR cannot see diagrams, geometry or charts. That needs a vision
  model, which is Phase 2 and GPU-gated.
- **The pet hides for the capture**, which is a visible flicker.
- **Wandering is a CSS transform, not a window move.** The window is a fixed
  full-width strip along the bottom of the primary display and the pet slides
  inside it. Moving a transparent always-on-top window at 60fps is janky and
  burns CPU on an app that is idle almost all the time.
- **No drag-to-feed, no evolution stages, no skins, no minigames.** The base loop
  has to be pleasant before any of that is worth adding.
- **`ocr.ps1` needs Windows PowerShell 5.1**, not PowerShell 7 — the WinRT type
  projections it uses do not exist in 7.
- **Slow on CPU.** Measured end to end at 69s on this machine including Electron
  start and first model load. Later answers are faster because Ollama keeps the
  model resident. Warm the model with `ollama run llama3.1:8b ""` before demoing.

## Not for exams

This is a study companion. Using it in a proctored exam is academic misconduct,
and that is not the market this is built for.
