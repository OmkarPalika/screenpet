# screenpet

A desktop pet that reads your screen and answers the question on it. Nothing
leaves your machine.

![screenpet reading a quiz question and answering it](demo/screenpet-demo.gif)

Phase 3. The pet has a care loop, lives in the tray, has a settings window and
four skins, uses a vision model when there is no text to read, and builds into a
Windows installer.

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
| Click the pet | Headpat. Heart eyes, a shower of 💕, happiness and bond up. |
| Double-click | Tickle. Wiggles and giggles — and see below if you keep going. |
| Drag it | Picks it up and moves it. Goes dizzy, complains mildly. |
| Move the mouse | Its eyes follow the cursor. |
| Right-click | Menu: Feed, Play, Tickle, Talk, Read screen, Settings, Quit. |
| Hover | Perks up, and shows the three need bars. |
| Walk away 5 minutes | Naps, with `z`s. Energy regenerates instead of draining. |
| Come back | Notices, and says so. |

A full pet refuses food and a tired pet refuses to play, and the menu greys those
out rather than letting you find out by clicking. Every action has a cooldown so
you cannot spam a stat to 100. Being on cooldown says nothing at all — a pet that
ignores a fourth headpat in a row has better manners than one that complains
about it.

### Keep poking it

Tickling is the one thing you can do over and over, so it is the one that
escalates:

> giggle → giggle → **shy** → **annoyed** → **RAGE** → **crying**

Each rung has its own bank of lines, and there is a floor at the bottom — nothing
comes after crying. An escalation with an end reads as a creature with feelings;
one that giggles forever reads as a button.

Cooldown refusals count as pokes here, unlike everywhere else. A pet that
silently ignores your fourth poke feels broken rather than patient.

Bouts expire after twelve seconds, so coming back from a meeting does not resume
mid-tantrum, and the counter lives in memory only — forgiveness on relaunch is
the right default for something that lives on your taskbar.

The pet also **praises you**, every other bit of small talk, and is immediately
embarrassed about having done it. The compliments are vague on purpose: it cannot
see what you are working on, and a specific compliment about work it has not seen
is a lie with a smiley face on it.

Mood is derived from the stats, never stored, and drives both the sprite and the
tone of answers: `sleepy`, `hungry`, `sad`, `happy`, `neutral`.

Bond is the one stat that never falls, so it is the only one that says anything
out loud — it has four milestones and that is the whole of it.

Unprompted talk is throttled twice over: nagging at most once every three hours,
and idle small talk at most once every 45 minutes and only when the pet has
nothing to complain about. A pet that talks more than that gets uninstalled.

## Pets

Six of them: **blob**, **cat**, **pup**, **bun**, **bird**, **dragon**. Pick one
in Settings, next to the four skins. They are orthogonal — every pet works in
every palette, so it is 24 combinations, not six.

Every species keeps the **same face rig**: same classes, same coordinates. Only
ears, body outline and extras (tail, crest, whiskers) change. That is the whole
trick — all fifteen expressions work on all six pets without a single extra rule,
and a seventh pet is one CSS block, not a new sprite sheet.

Shapes live in `renderer/pets.css`, which the pet window, the settings previews
and the demo stage all load. One definition per pet, so the picker previews are
drawn by the same rules as the real thing and cannot disagree with it. A test
asserts no species rule sneaks into `style.css`, which only the pet window
loads — a shape hiding in there would render correctly and preview as a blob.

`npm run verify:ui` writes `pet-species.png`: every pet in every skin.

### They each behave a bit differently

**Voices.** Each species has its own lines for the things it says most — idling,
being fed, patted, played with. Everything else falls through to the shared bank,
so a seventh pet means writing the lines it actually has an opinion about rather
than filling in a 15-cell grid. The cat says `you may continue`; the pup says
`again again again`.

**Idle quirks.** Every 9–23 seconds of nothing happening, the pet does something:
the cat stretches and flicks its tail, the pup hops and wags, the bun twitches an
ear, the bird pecks, the dragon rumbles and sways, the blob squishes. They all
glance around while doing it.

The renderer only decides *when* — which movement is entirely `pets.css`'s
business. A species rule replaces the resting bob for the quirk's duration, which
is what makes it read as a movement rather than a wobble on top of one. Tails
rotate about where they meet the body, not their own centre; get that wrong and
the tail detaches mid-wag.

## Faces

Mood is the long run; an expression is the reaction to something that just
happened, laid over the top and cleared after a couple of seconds.

`smile` `grin` `love` `yum` `giggle` `oh` `hmm` `sulk` `dizzy`
`shy` `proud` `joy` `annoyed` `rage` `cry`

They are CSS, not sprites — the mouth is a `d: path(...)` swap and the extras
(brows, tongue, tears, sweat, sparkle, anger mark, `z`s) are `display` toggles.
So they cost no images, and they compose with all four skins for free.

`rage` is deliberately the `annoyed` face turned up — steeper brows, angrier
mouth, a shake and a hue shift — rather than a face of its own. That is what
makes it read as the same pet getting angrier instead of a different pet turning
up.

**The bow** is an accessory on the shared rig, not part of any body, so all six
species wear it with no per-species rules. It appears for the cute half of the
range only — `love` `shy` `giggle` `proud` `joy` — and a test asserts `rage` and
`cry` never get one. A pet in tears wearing a party bow is a different feeling
entirely.

**Emoji rain.** Each feeling drops a handful of emoji in from above the head, and
each has **several sets picked at random per burst** — a headpat is 💕💖💗 or
💘💞 or 🎀💕🌷, and joy might be 🎉🎊✨, 🥳, 🍾 or 🎆. The same five hearts every
single time stops reading as a reaction and starts reading as a loading spinner.
Rage and annoyance are the exceptions and stay fixed; being cross is not a mood
with variations.

One mechanism for all of it — the renderer picks the set, fall depth and stagger,
the stylesheet says only how a falling thing moves, and a new feeling clears
whatever is still in the air. `smile`, `hmm` and `oh` deliberately drop nothing:
they fire on hover, and confetti on every mouse move would be unbearable. There
are tests for both the variety and the silence.

The bubble sits at `z-index: 1` so the rain falls *behind* it. The drops start
74px above the pet's head, which is exactly where the speech bubble is, and
without this a heart lands on top of the answer.

Expression rules must stay **below** the mood rules in `style.css`. Both are
`.pet[data-*]`, so they have identical specificity and source order is the only
thing that makes a reaction beat the mood underneath it. There is a test for
that, and another asserting every expression the code can emit has a rule to
render it.

`npm run verify:ui` writes `pet-faces.png`, which is all of them side by side
with animations paused.

## How it talks

The pet answers like a pet, not like a search result:

> Oh, sweetie! 17 times 23 is… *pounces* …391!
>
> It would return 13.50 for that item! 💸

**The answer itself is not negotiable.** The prompt says to give it plainly and
completely, never to hide it or hint at it, and caps the affection at one
flourish. Both clauses are load-bearing: this same file used to open with "you
are a desktop pet" and produced 79–240 character replies that narrated the screen
and talked about themselves, which is why the wording was stripped back to
something that answered but sounded like a lookup. The current version measured
**9/9 correct across three screens**, three runs each, with the voice back.
Re-measure before editing it.

**A screen with no question is not a failure.** It used to say `I could not read
any text on screen` or `I cannot find a clear question`, which is technically
true and reads like a broken tool. Now:

> Oh, just reminders! No questions here today.

Two layers do that. The prompt forbids refusal wording outright, and if the model
returns nothing at all, `brain.js` returns an empty string rather than a sentence
— the pet's voice lives in the line bank in `pet-state.js`, and a fallback
written in `brain.js` would be a second, blander personality in the one file
that is meant to have none.

Small models like to wrap a reply in quotation marks, often opening one they
never close. `unquote` strips that: it is the model narrating a line of dialogue,
not the pet speaking. Quotes inside an answer survive.

## Conversations

Right-click → **Talk…** and type. No screenshot, no OCR: the model is told
plainly that it cannot see your screen, because otherwise a small model will
cheerfully invent what is on it. Same rule as above — fond and playful, but a
factual question still gets a real answer (`Tokyo is the capital! Got any other
questions for your favourite desk buddy?`).

The last three exchanges are kept for context **in memory only, never written to
disk**. A desktop pet that keeps a transcript of your evening in `userData` is a
liability, not a feature.

The pet window is `focusable: false` so it can never steal focus from what you
are actually doing, which also means it cannot receive typing. Focus is granted
for exactly as long as the box is open and handed straight back.

State lives in `pet.json` in Electron's `userData` directory. It is validated on
load, so a corrupted or hand-edited file degrades to a fresh pet instead of
crashing.

## Settings

Right-click the pet, or use the tray icon. The tray is also how you show, hide
and quit it — the pet has no taskbar button by design.

| Setting | Notes |
| --- | --- |
| Model | Picked from what Ollama actually has installed. |
| Diagrams and images | `Auto` uses a vision model if one exists, `Off` forces text-only. |
| Hotkey | Validated before saving; a malformed accelerator would crash the app on launch. |
| Pet | Blob, cat, pup, bun, bird or dragon. Previews are the real thing. |
| Skin | Butter, mint, blossom or slate. Applies to whichever pet you picked. |
| Start with Windows | Packaged builds only — in development this would register `electron.exe`. |

Settings live in `settings.json` next to `pet.json` in Electron's `userData`.
Both are validated on load, so a corrupt or hand-edited file degrades to
defaults rather than crashing.

**The endpoint is locked to loopback.** `127.0.0.1`, `localhost` and `[::1]` are
the only accepted hosts, and that is enforced in code rather than by convention.
A remote endpoint would quietly turn the entire privacy claim into a lie, so it
is not a supported configuration even if you hand-edit the file. There is a test
for it.

## Two tiers

**Tier 1 — text. Always tried first.** Windows OCR reads the screen and a text
model answers. Runs on any machine, no GPU, no download beyond the text model.
Secrets are redacted before the text reaches the model.

Reading order is reconstructed rather than taken from the OCR engine.
`OcrResult.Text` stringifies fragments in the engine's order, not the page's: on
a four-line code block it returns `const a`, `const b`, `const c`, `if (a[0]`
and only then the right-hand half of each of those rows, so the model receives
every left column before any right one. `ocr.ps1` emits each fragment with its
bounding box and `toReadingOrder` in [ocr.js](ocr.js) groups fragments whose
vertical centres overlap into a row, top to bottom, left to right within a row.
Nav bars, tables and option grids all read correctly because of it.

**Tier 2 — vision, only when there is no text to read.** If OCR comes back with
almost nothing, the screen is probably a diagram, a photo, a game or a video, and
the screenshot itself goes to a vision model instead. Detection asks Ollama which
models report the `vision` capability via `/api/show`, rather than
pattern-matching model names that go stale.

The order matters, and it is the opposite of what seems obvious. A small vision
model is not a better version of the text path — it is much worse at it.
Measured against moondream: it describes a simple image well, and returns
*nothing at all* for a dense screenshot of text. Preferring vision whenever it is
installed would have made the common case strictly worse. So OCR leads, and
vision fills the gap it cannot.

A question mark alone is enough to keep a screen on the text path. `What is
17 * 23 ?` is 38 characters, under any sensible length threshold, and is exactly
the case that must never go to a vision model.

Picking a specific model in Settings instead of `Auto` opts into always using
it — worth doing with a stronger model like `qwen2.5-vl`.

To turn it on:

```bash
ollama pull moondream
```

Nothing else — `Auto` picks it up on next launch.

One honest caveat: **an image cannot be redacted the way text can.** On the text
path a password on screen is replaced with `[REDACTED]` before the model sees
it. On the vision path the model receives the raw screenshot. It is still
entirely local, but it is a wider exposure, and `Off` is there if you would
rather not.

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

Default model is `deepseek-r1:8b`. Pull it if you do not have it:

```bash
ollama pull deepseek-r1:8b
```

If you skip this the pet says so plainly and repeats the command back to you,
rather than claiming Ollama is down.

**Bigger is not better here, and reasoning beats size.** Eight models were given
the same screenshot of a `map`/`filter` chain and asked what it prints, twice
each, on two inputs. `ocr` is what the app really receives — Windows OCR drops
the `= [1, 2, 3]`, so it is **unanswerable** and the only correct move is to say
so. `control` puts the array back, and the answer is `2`.

| model | control (`2`) | ocr (unanswerable) | warm |
| --- | --- | --- | --- |
| `deepseek-r1:8b` | **2/2** | **2/2 said the data was missing** | 6–12s |
| `qwen3:8b` | **2/2** | 1/2 | 6–10s |
| `phi4-mini-reasoning:3.8b` | **2/2** | 0/2 — invented the array | 6–67s |
| `llama3.1:8b` | 0/2 | 0/2 | 1–3s |
| `mistral-nemo:12b` | 0/2 | 0/2 | 19s |
| `ultra-horror` (15.9B) | 0/2 | 0/2 | 23s |
| `mistral:7b` | 0/2 | 0/2 | 9s |

Two things fall out of that. Size does nothing: a 15.9B model and a 12B model
both got it wrong, and every model that got it right was 8B or smaller. And the
second column is the one that matters — **`deepseek-r1:8b` is the only model
that noticed it had been handed damaged input**, both times, rather than
answering anyway. `phi4-mini-reasoning` did the opposite and quietly assumed the
array was `[1, 2, 3]`, spending 13,000 characters of thinking and 67 seconds to
reach a confident answer about data it had never seen.

**`deepseek-r1:8b` is the default**, on the strength of that second column. It is
three to four times slower than `llama3.1:8b` (6–12s warm against 1–3s) and that
is a real cost on every question. What it buys is a pet that tells you when it
has been handed something it cannot actually read, instead of answering anyway —
and on a tool whose entire job is answering what is on your screen, a confident
wrong answer is worse than a slow right one.

If you would rather have the speed and do not mind that, `llama3.1:8b` is one
dropdown away in Settings. It is fine on prose; it is the code and the damaged
screens where it invents things.

An earlier note here claimed reasoning models were too slow to use. That was the
`num_ctx` bug below, not the reasoning.

## Keys

| Key | Does |
| --- | --- |
| `Ctrl+Shift+Space` | Read the screen and answer (rebindable in Settings) |
| `Ctrl+Shift+Q` | Quit |

The window spans the bottom strip of the screen but stays click-through; the
renderer hit-tests the pet and tells the main process when clicks should land, so
everything outside the pet keeps working normally. It never takes focus from what
you are doing.

## Config

Model, hotkey, skin, vision mode and autostart all live in the Settings window —
see above. The remaining env vars are development knobs only:

| Env var | Default | Does |
| --- | --- | --- |
| `SCREENPET_TIMEOUT_MS` | `120000` | Text-path timeout. Vision uses 240s. |
| `SCREENPET_NUM_CTX` | `4096` | Context window. See "Why it is not slow any more". |
| `SCREENPET_KEEP_ALIVE` | `30m` | How long Ollama holds the model in VRAM. `5m` is Ollama's own default, `0` unloads after every answer. |
| `SCREENPET_SMOKE` | unset | Answer once, print, exit. |
| `SCREENPET_MODEL` / `SCREENPET_OLLAMA` | — | Defaults for direct `brain.js` calls in tests. The app reads `settings.json`. |

## Demo

```bash
npm run demo
```

Rebuilds `demo/screenpet-demo.gif` and a still for store listings.

The recorder does not touch your actual screen — it renders a mock quiz page in
its own window, so nothing personal ends up in the clip. Everything else is real:
the pet, the bubble and the animations are the app's own stylesheet, the idle
quirk is the same `is-idling` class the renderer toggles, and the answer comes
from capturing that page, running it through Windows OCR and asking the local
model, exactly as the app does. If the model is unreachable the recorder fails
rather than writing a hard-coded answer.

Beats: idle → stretch and tail flick → hotkey → thinking → answer → headpat.
Whatever the model says that run is what goes in the clip, including the run
where it answered on two lines.

## Build

```bash
npm run dist
```

Produces two artifacts in `dist/`, each about 95MB:

| File | For |
| --- | --- |
| `screenpet-<version>-setup.exe` | NSIS installer, per-user, choosable install directory |
| `screenpet-<version>-portable.exe` | Single file, no install |

`npm run pack` produces `dist/win-unpacked/` only, which is what a Steam depot
would upload.

**`ocr.ps1` is in `asarUnpack`, and must stay there.** PowerShell cannot read a
file from inside an asar archive, so packaging it normally breaks OCR in the
built app while development keeps working — the worst kind of failure. `ocr.js`
rewrites `app.asar` to `app.asar.unpacked` in the script path, which is a no-op
in development. The packaged build has been run and confirmed to OCR correctly
from the unpacked location.

**The build is unsigned.** Windows SmartScreen will warn on first run and some
users will not get past that. Shipping properly needs an Authenticode
certificate; an EV one avoids the reputation-building period. That is a purchase
and an identity check, not a code change.

## Shipping

What is done: the app builds, installs, runs from the installed location, and
autostart is wired to `setLoginItemSettings` (packaged builds only).

What is left, and none of it is code:

- A code signing certificate, or accept the SmartScreen warning
- Steamworks account and the $100 app fee, store page, depot upload
- Or itch.io, which has no fee and no signing expectation — a better first stop
- Screenshots and a capture of the pet answering something, which is the entire
  pitch and cannot be conveyed in text

Steam is the one storefront in this category with any precedent for paid desktop
companions, at roughly $5 with skins as the only upsell that has historically
worked. That was the reasoning behind building the demo before the app.

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

Drives both real windows over real IPC — speech, all five moods, every
expression, cursor tracking, all six species, all four skins, stat bars, hover
hit-testing, headpat, tickle, drag, the chat box, every menu item, and the whole
settings form — and fails on any console error. Writes PNGs to look at.

The expression and species checks are not just "an attribute was set". They
assert the mouth and ear geometry actually changed, because both systems rest on
CSS `d: path(...)` resolving; if that ever stopped working every face and every
pet would quietly collapse into the default one and nothing else would notice.

It also fails loudly on an unhandled rejection. A selector that matches nothing
rejects `executeJavaScript`, which used to abort the run silently and leave the
app sitting there with a window open — a hang tells you nothing.

The two contact sheets each build in their own window. Resizing and reloading
the window under test to make them worked until it did not: the second capture
started failing with `UnknownVizError`, and it had been leaving every later check
running against a window with its `#stage` torn out.

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
- **Text only until you install a vision model.** See "Two tiers" above.
- **First vision model wins.** Detection takes the first model reporting the
  `vision` capability rather than ranking them by size or quality.
- **Small vision models are brittle about prompts.** `buildVisionPrompt` is one
  short sentence with the mood in front, and that shape was measured rather than
  chosen — see the comment above `VISION_TASK` in [brain.js](brain.js) before
  editing it. Adding a length constraint makes moondream reply `!!!`; moving the
  mood after the task makes it reply with nothing.
- **A screen with both a diagram and plenty of text takes the text path**, so the
  diagram is not looked at. Pick a vision model explicitly if that is your case.
- **Diagrams do not really work, including the geometry case the vision tier was
  built for.** A right triangle labelled 9, 12 and `x` with the caption `Find x.`
  routes to vision correctly and then moondream returns an empty string for
  `buildVisionPrompt`, so the pet says it came up blank. Asking it to
  `Describe this image.` instead does produce text — and that text is not
  trustworthy: on a four-bar chart it reported three bars, in the wrong order,
  and invented that they measured *the number of days in each month*. Feeding
  that description to the text model to answer from was tried and rejected: it
  turns a blank into a confident wrong answer, 3/3 runs, complete with
  fabricated reasoning. A blank is worse than useless but it is honest, so the
  blank stays until a vision model that can read a diagram is worth requiring.
- **Code screens read badly, and most models answer anyway.** Windows OCR is
  trained on prose and silently drops code punctuation: `const a = [1, 2, 3];`
  comes back as `const a`, and `{x: 1, y: 2}` disappears entirely. Tested at 16,
  20, 28 and 36px — font size does not help. The model is then asked what a
  program prints while never having been shown the data. Whether it declines is
  entirely a property of the model, not of the prompt: adding *"say so if the
  text is too garbled to answer"* was measured on `llama3.1:8b` and changed
  nothing, while `deepseek-r1:8b` says `undefined … its initial assignment is
  missing` without being asked to. Picking that model as the default is the whole
  mitigation; switch to a faster one in Settings and this ceiling comes back.
- **Multiple choice is the weak spot on the smaller models.** `llama3.1:8b` gets the arithmetic right
  consistently and then maps it to the wrong option letter often enough to
  matter — in testing it answered `391` correctly and labelled it `D` in the same
  breath. Use a larger model if you rely on the letter rather than the value.
- **OCR misreads some glyphs.** `Question 4 of 10` comes back as `4 of IO`. It
  has not affected an answer yet, but it is there in every capture.
- **The pet hides for the capture**, which is a visible flicker.
- **Wandering is a CSS transform, not a window move.** The window is a fixed
  full-width strip along the bottom of the primary display and the pet slides
  inside it. Moving a transparent always-on-top window at 60fps is janky and
  burns CPU on an app that is idle almost all the time.
- **No evolution stages and no minigames.** The base loop has to be pleasant
  before any of that is worth adding.
- **Chatter frequency is not configurable.** 45 minutes is a guess that felt
  right, not a measurement. It is one constant in `pet-state.js`, and it should
  become a setting the first time anyone says it is too much.
- **Chat has no scrollback.** Three turns of context, no transcript, and the
  window shows one reply at a time. That is deliberate — see above — but it does
  mean you cannot re-read what it said.
- **Talking takes focus for as long as the box is open.** Unavoidable: a window
  that cannot be focused cannot be typed into.
- **The demo stage has its own copy of the pet SVG**, because it renders a page
  behind the pet, and the settings previews have a third. A test asserts all
  three carry the same face and species slots, so drift fails loudly rather than
  quietly showing an older pet.
- **Species differ in voice and idle movement, not in rules.** They all eat, play
  and decay identically — the cat is not fussier about food than the pup. Per
  species stats would be the obvious next thing, and are not there.
- **The demo GIF records the cat**, whichever pet you have chosen. One species,
  one skin, and two feelings out of fifteen — it is the hero image for reading
  the screen, not a tour of the picker or the expression range. `pet-faces.png`
  and `pet-species.png` from `npm run verify:ui` are where those live.
- **Autostart is wired but not exercised end to end.** It is gated on
  `app.isPackaged` and only reachable from the settings window of a built app.
- **No auto-update.** Every new version is a manual download.
- **`ocr.ps1` needs Windows PowerShell 5.1**, not PowerShell 7 — the WinRT type
  projections it uses do not exist in 7.
- **The first answer after a cold start is still the slow one.** ~7.6s of model
  load before the model does any thinking. See below.

## Why it is not slow any more

Two lines in [brain.js](brain.js), both found by measuring rather than guessing,
on an RTX 5050 Laptop with 8GB:

**`num_ctx`.** Ollama sizes the KV cache from the *model's* default context
window, not from the prompt. Left alone, `phi4-mini-reasoning:3.8b` asks for
**21GB** for a 3.8B model — a 131072-token window — spills off the card, and the
process is OOM-killed outright. Even `llama3.1:8b` was quietly running 74% on the
CPU. Capping the window at 4096 puts it back on the GPU:

| model | default | capped |
| --- | --- | --- |
| `llama3.1:8b` | 35.0s, 74% CPU | **11.5s, 100% GPU** |
| `mistral-nemo:12b` | 104.8s, 53GB asked for | **18.7s, 9.6GB** |
| `phi4-mini-reasoning:3.8b` | process killed | runs |

**`keep_alive`.** Once the model is on the GPU, almost none of the remaining time
is thinking. For a 44-token answer: `load_duration` 8.35s, `prompt_eval` 0.21s,
`eval` 1.17s. Ollama unloads after five idle minutes, so a pet asked twice an
hour paid that load every time — 12.6s cold against 1.2s warm. Holding the model
for 30 minutes of idle costs ~5.3GB of VRAM while you are using it and makes
every answer after the first feel instant.

Neither of these is a quantization problem. The models were already quantized
(`q4_K_M`, `q5_K_M`, and llama3.1:8b is `Q4_0`) and Ollama was already using the
GPU. It was allocating a 128k-token cache for a 400-character prompt.

## Not for exams

This is a study companion. Using it in a proctored exam is academic misconduct,
and that is not the market this is built for.
