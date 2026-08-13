# screenpet

A desktop pet that reads your screen and answers the question on it. Nothing
leaves your machine.

Phase 0 — the spike. One pet, one hotkey, one answer. No feeding, no stats, no
wandering. Those come in Phase 1, and only if this turns out to be worth it.

## How it works

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

Renders the real UI, pushes a state through the real preload bridge, and fails on
any console error or on the bubble not appearing. Writes `pet-preview.png` to
look at. This exists because a name collision between a `const` in `renderer.js`
and the `contextBridge` global killed the whole renderer script at parse time —
invisible to unit tests, obvious the moment you render it.

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
- **`ocr.ps1` needs Windows PowerShell 5.1**, not PowerShell 7 — the WinRT type
  projections it uses do not exist in 7.
- **Slow on CPU.** Measured end to end at 69s on this machine including Electron
  start and first model load. Later answers are faster because Ollama keeps the
  model resident. Warm the model with `ollama run llama3.1:8b ""` before demoing.

## Not for exams

This is a study companion. Using it in a proctored exam is academic misconduct,
and that is not the market this is built for.
