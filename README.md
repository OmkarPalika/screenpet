# screenpet

[![ci](https://github.com/OmkarPalika/screenpet/actions/workflows/ci.yml/badge.svg)](https://github.com/OmkarPalika/screenpet/actions/workflows/ci.yml)
[![release](https://img.shields.io/github/v/release/OmkarPalika/screenpet?sort=semver)](https://github.com/OmkarPalika/screenpet/releases)
[![offline by default](https://img.shields.io/badge/network-off%20by%20default-2ea44f)](#verify-the-privacy-claim)
[![platform](https://img.shields.io/badge/platform-Windows%2010%2F11-0078d4)](#which-machines-it-runs-on)
[![node](https://img.shields.io/badge/node-18%2B-339933)](#install)
[![licence](https://img.shields.io/badge/licence-PolyForm%20Noncommercial%201.0.0-blue)](LICENSE)

A desktop pet that lives in your tray and, when you want it to, reads your
screen and answers the question on it. **On the default settings nothing leaves
your machine at all** — the model runs here, the OCR runs here, the speech runs
here.

**Nothing has to be installed for the pet itself.** It wanders, naps, sits on
top of the window you are working in, stops you for water, eats, is petted,
wears hats, sets timers, remembers what you tell it to and pulls forty faces
with no model anywhere. Reading the screen is the one part that needs
[Ollama](https://ollama.com), it is off until Ollama is there, and until then
the pet says so in its own words rather than showing you a failed request.

There is one switch that changes that, off out of the box, and everything it
unlocks is itself off until you say so: weather, web lookups, and the option of
answering with a hosted model instead of a local one. See "Going outside" for
exactly what each of those sends and to whom.

![screenpet reading a quiz question and answering it](demo/screenpet-demo.gif)

Ten pets, ten palettes and nine things to wear, all orthogonal — any species in
any colour in any hat. It has a care loop, lives in the tray, has a settings
window, falls back to a vision model when there is no text to read, and builds
into a Windows installer.

## Install

```bash
npm install
```

```bash
npm start
```

That is the whole of it — a pet appears and the care loop, the skills, the
breaks and the faces all work.

To have it read your screen, install Ollama and pull the default model:

```bash
ollama pull deepseek-r1:8b
```

Skip it and nothing is broken: the pet says it cannot read yet and what to
install, once, when you ask it to read. Ollama running but without that model
is a different sentence, which repeats the exact `pull` command back to you
rather than claiming Ollama is down.

### What it needs

- Windows 10/11, or macOS (see [BUILDING.md](BUILDING.md))
- Node 18+
- [Ollama](https://ollama.com) running locally, **only** to read the screen and
  to hold a conversation. Everything else the pet does works without it, and the
  app looks for it again every time you ask — install it mid-session and the
  next press of the hotkey reads the screen.
- A microphone and a Windows speech recogniser, **only** if you switch on
  `Let me talk to it`. Check what you have:

  ```powershell
  Add-Type -AssemblyName System.Speech
  [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers()
  ```

  An empty list means no recogniser is installed and the pet says so rather than
  failing silently. Add one under Settings ▸ Time & language ▸ Speech.

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
| Drag it | Picks it up and puts it anywhere on the display. Goes dizzy, complains mildly, and stays where you left it — see [Where it stands](DESIGN.md#where-it-stands). |
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

## The rest of it

Everything the pet does when it is not answering a question — the forty faces,
the four species, the voice, the wardrobe, the sulking, the water breaks, where
it stands and why it stands there — is in **[DESIGN.md](DESIGN.md)**, together
with the measurements behind the choices that look arbitrary from the outside.

This file is the half you need to install it, run it, and know what it sends.

## Giving it a voice

Out of the box the pet speaks with a voice already on your machine — Microsoft
David or Zira — put through the filter chain in `robot.js`, which exists because
what Windows hands back sounds like a train station. Turning that into a
deliberate robot is a rescue, not a preference.

You can give it a better one. [Piper](https://github.com/OHF-Voice/piper1-gpl)
is a neural text-to-speech engine that runs entirely on this machine, and the
pet uses it the moment it finds one — no setting, the same way dictation works.
With a voice installed the ring modulator comes off entirely and what is left is
just the small body: pitched up a little, and coming out of something the size
of a mug.

Put two things in a `piper` folder next to `settings.json`:

```
%APPDATA%\screenpet\piper\
  piper.exe                        the standalone Windows build
  en_US-kristin-medium.onnx        a voice
  en_US-kristin-medium.onnx.json   and its config, which is not optional
```

Both halves of the voice or it does not count as installed — piper reads the
sample rate and the phoneme map out of the `.json` and refuses the model without
it, and half an install that fails when the pet tries to speak is worse than one
that never claimed to be there. Two voices in the folder and the first by name
wins; delete the one you do not want. The settings window names the one it
found.

If anything about it fails — missing, wedged, a line it cannot pronounce — the
pet falls back to the Windows voice for that sentence. Losing the good voice is
the right cost; losing the ability to speak is not.

### Which voice

**[`en_US-kristin-medium`](https://huggingface.co/rhasspy/piper-voices/tree/main/en/en_US/kristin/medium)**
is the one to start with. It is light and unhurried rather than newsreaderly,
which is most of what makes a voice work on something two inches tall, and it is
the pet shaping in `robot.js` that does the rest — you are picking a voice to be
turned into a pet, not a pet voice.

Avoid the "high" quality tiers. They are trained for narration, they cost
noticeably more per sentence, and a pet interrupting you with a beautifully
read sentence is worse than one that squeaks.

### The licences, since they differ

| | Licence | Matters because |
| --- | --- | --- |
| `piper1-gpl` (current engine) | GPL-3.0 | screenpet spawns it as a separate process and does not link it, bundle it or ship it. That is what keeps GPL off this project's own [PolyForm Noncommercial](LICENSE) terms — and it stays true only while it is a binary **you** went and got, in a folder of your own. |
| `rhasspy/piper` (the older standalone build) | MIT | The Windows `.exe` most people will use. |
| `en_US-kristin-medium` | MIT | Trained on public-domain LibriVox recordings. |
| Other Piper voices | **Varies — check each one** | Many are CC BY 4.0, which is fine but wants attribution. Some, `lessac` among them, carry Blizzard Challenge terms that are not free for every use. Each voice ships a `MODEL_CARD` next to it saying which. |

Nothing here is bundled with screenpet and nothing is downloaded for you. That
is deliberate on all three counts: licensing, code signing, and the rule that
this app does not fetch executables.

## Settings

Right-click the pet, or use the tray icon. The tray is also how you show, hide
and quit it — the pet has no taskbar button by design.

| Setting | Notes |
| --- | --- |
| Model | Picked from what Ollama actually has installed, with the one the pet would choose marked `— suggested` and the reason under the list. It is a suggestion and nothing else: nothing changes the setting for you, because a model is a taste as well as a measurement. See [Which model, and why that one](#which-model-and-why-that-one). |
| Diagrams and images | `Auto` uses a vision model if one exists, `Off` forces text-only. |
| Hotkey | Validated before saving; a malformed accelerator would crash the app on launch. |
| Name | What you call it, up to 24 characters, any script. Empty means unnamed, which is the default — a name the app picked for you is not a name you gave it. It answers to it and says it when asked, and never opens a reply with it. |
| Pet | Blob, cat, pup, bun, bird, dragon, fox, axolotl, ghost or robot. Previews are the real thing. |
| Skin | Ten palettes — butter, mint, blossom, slate, coal, cream, moss, plum, sky, coral. Applies to whichever pet you picked. |
| Wearing | Nothing, bow, shades, halo, masked hero, party hat, wizard hat, crown or headphones. See [The wardrobe](DESIGN.md#the-wardrobe). |
| Read the window I am in | On by default. Crops the screenshot to the window you are working in, and falls back to the whole screen by itself where that would not help. |
| Read the screen without being asked | **Off** by default. Turns the hotkey into a timer — see [Without being asked](DESIGN.md#without-being-asked). Local models only; a hosted provider switches it off. |
| Read every (seconds) | 20 to 600, default 60. Clamped rather than rejected. |
| Speak replies out loud | On by default. Mute from the tray without opening this window. |
| Little noises | On by default. A woof, a meow, a chirp — synthesised, not played from a file. Muted separately from the voice. |
| Let me talk to it | Off by default. Adds `Listen…` to the pet's menu. |
| Answer to “hey pet” | Off by default, needs the above. **Holds the microphone open.** See [The wake word](DESIGN.md#the-wake-word). |
| Bop along to music | Off by default, needs the microphone. **Holds it open.** The pet moves on the beat — and dances and says something nice if the noise turns out to be you singing. See [Dancing](DESIGN.md#dancing). |
| Notice when I am at the desk | Off by default. Motion only — see [Noticing you](DESIGN.md#noticing-you). |
| Tell a face from a curtain | Off by default, needs the camera. A count, never a name — see [Counting faces](DESIGN.md#counting-faces). |
| Let it out on the internet | **Off** by default. The master switch — see "Going outside". Unlocks the next four; switching it off switches them all off. |
| Let it ask about the weather | Off by default, needs the above. A town name and nothing else. |
| Town | Where to ask about. You can put the next town over. |
| Let it look things up | Off by default, needs the internet switch. The words after `look up`, to DuckDuckGo and Wikipedia. |
| Which model answers | Ollama on this machine by default. Anything else sends the text read off your screen to that company. |
| Model name / API key | For a hosted provider. Whatever you type as the model wins, so a name newer than this app still works — OpenAI is sent the reply ceiling as `max_completion_tokens`, which its newer models require and its older ones accept. The key is wrapped with DPAPI and never shown again. |
| Remember things between sessions | **On** by default. Writes only what you asked it to remember. Off deletes the file. See [What it remembers](DESIGN.md#what-it-remembers). |
| Let it be cheeky about it | On by default, needs the above. The pet needling you with what it has. |
| Start with Windows | Packaged builds only — in development this would register `electron.exe`. |

**Every setting that opens something needs its own literal `true` plus whatever
it depends on.** A wake word with the microphone off, a face check with the
camera off, or a weather lookup with the internet switch off is a setting that
silently does nothing — so `load()` turns it off rather than pretending.
Switching off a dependency takes its dependants with it in the same pass, in one
place, rather than at each call site that would otherwise have to remember.
There are tests for every one of those.

Settings live in `settings.json` next to `pet.json` in Electron's `userData`.
Both are validated on load, so a corrupt or hand-edited file degrades to
defaults rather than crashing. **API keys are not in there** — see "Where a key
lives".

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
bounding box and `toReadingOrder` in [ocr.js](src/system/ocr.js) groups fragments whose
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

## Layout

```
src/
  main.js       the Electron main process: windows, tray, hotkey, the loop
  preload.js    the only bridge the renderer gets
  core/         logic with no Windows in it - runs under plain node, so the
                tests drive the real thing rather than a mock
  system/       everything that shells out: each .js next to the .ps1 or the
                binary it drives, and host.js deciding which one this machine
                gets
  system/mac/   the macOS half - one Swift helper and one AppleScript
  renderer/     the pet itself - one HTML file, one settings window, the SVG
                bodies in pets.css, how they are lit in lighting.js and the
                voices in voices.js
test/           test.js is node-only and fast; verify-ui.js boots real windows
assets/         icon.png, the tray and window icon
build/          the installer icon, and the script that turns TERMS.md into the
                licence page NSIS shows
demo/           a scripted recording of the pet, for the README gif
```

The split that carries weight is `core/` against `system/`. Nothing in `core/`
spawns a process or touches Windows, which is why `npm test` can call the real
modules instead of mocking them, and why it runs in about a second. Anything
that shells out lives in `system/` next to the script it runs — `ocr.js` beside
`ocr.ps1` — because the two are one unit and reviewing either alone tells you
half the story.

`src/system/*.ps1` is in `asarUnpack` and must stay there. See
[Shipping](#shipping) for why.

## Which machines it runs on

Windows is the platform this was built on and the one everything is measured
against. macOS is implemented and **has not been run** — see
[BUILDING.md](BUILDING.md), which lists what differs and what is missing there.

The whole of what is platform-specific is one table in
[host.js](src/system/host.js). A capability a machine does not have is not
hidden and does not throw: the switch for it in Settings is disabled with the
reason on hover, and asking for it out loud gets a sentence back. Find out
before you start:

```bash
npm run doctor
```

```
capability      host  ready  note
--------------  ----  -----  ----
ocr             yes   yes
listen          yes   yes
wake            yes   yes
```

Two things macOS does not get, both for the same reason: `Answer to "hey pet"`
and Windows' own dictation are a recogniser holding the microphone open, and
the macOS equivalent goes to Apple's servers unless asked very specifically not
to. Dictation still works there through whisper.cpp or Parakeet, which were
already local and already cross-platform. A wake word has no such stand-in —
running whisper forever to catch one word is a different bargain from the one
that setting describes.

Linux, Android and iOS: see the end of [BUILDING.md](BUILDING.md). The first is
unimplemented, the second is a different application, and the third cannot do
the central feature at all.

## Which model, and why that one

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

**Small talk does not pay that cost.** Saying hello is not a question about your
screen, and there is nothing there for a reasoner to reason about — so `chat()`
sends `think: false` and the same model answers straight away. Measured against
one already-loaded `deepseek-r1:8b`: **8613ms to the first word with the
monologue, 394ms without**, and 425ms through the app's own code path. Nothing
else moves. No second model, no swap, no extra memory — and that matters more
than it sounds, because on an 8GB card `deepseek-r1:8b` is 5.6GB and a second
model does not fit beside it. Alternating between two of them costs a full
reload every turn: the fast model measured 403ms warm and **8192ms** when it had
to be swapped back in, which is worse than the problem it was meant to fix.

The switch is only ever thrown one way. A model that cannot think refuses the
whole request rather than ignoring the field — `"llama3.1:8b" does not support
thinking` — so asking for reasoning is how you break every model that was never
the problem.

A follow-up about the screen keeps the reasoning. Answering about text it read a
moment ago is the one job the careful model was chosen for; measured at 4.5s to
the first word, with the thinking face up while it works.

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

The window covers the whole display but stays click-through; the renderer
hit-tests the pet and tells the main process when clicks should land, so
everything outside the pet keeps working normally. It never takes focus from what
you are doing.

## Config

Model, hotkey, skin, vision mode and autostart all live in the Settings window —
see above. The remaining env vars are development knobs only:

| Env var | Default | Does |
| --- | --- | --- |
| `SCREENPET_TIMEOUT_MS` | `120000` | Text-path timeout. Vision uses 240s. |
| `SCREENPET_NUM_CTX` | `4096` | Context window. See [Why it is not slow any more](DESIGN.md#why-it-is-not-slow-any-more). |
| `SCREENPET_KEEP_ALIVE` | `30m` | How long Ollama holds the model in VRAM. `5m` is Ollama's own default, `0` unloads after every answer. |
| `SCREENPET_SMOKE` | unset | Answer once, print, exit. |
| `SCREENPET_WAKE_CONFIDENCE` | `0.6` | How sure the wake word has to be. Lower if it is deaf, raise if the fridge wakes it. |
| `SCREENPET_QUNS` | unset | Force the Windows notification state (see [Getting out of the way](DESIGN.md#getting-out-of-the-way)). `7` is talkative, `5` is Do Not Disturb. For testing the half your machine is not currently in. |
| `SCREENPET_MODEL` / `SCREENPET_OLLAMA` | — | Defaults for direct `brain.js` calls in tests. The app reads `settings.json`. |

## Demo

```bash
npm run demo
```

Rebuilds `demo/screenpet-demo.gif` and a still for store listings.

The recorder does not touch your actual screen — it renders a mock quiz page in
its own window, so nothing personal ends up in the clip. Everything else is real:
the pet, the bubble and every animation are the app's own stylesheet, the walk is
the same `data-move` attribute and the same CSS transition the renderer uses, and
the answer comes from capturing that page, running it through Windows OCR and
asking the local model, exactly as the app does. If the model is unreachable the
recorder fails rather than writing a hard-coded answer.

Beats: idle → walks across → looks around → walks back → hotkey → thinking →
answer → headpat → shy → dance. Whatever the model says that run is what goes in
the clip.

**The walk back is not padding.** The bubble hangs off the pet, so answering from
the middle of the stage puts the reply straight across the question it is
answering — which the first take did, and which is only visible by looking at the
frame rather than at the code.

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

**`src/system/*.ps1` is in `asarUnpack`, and must stay there.** PowerShell
cannot read a file from inside an asar archive, so packaging them normally
breaks OCR, dictation, the wake word, the media keys and the key store in the
built app while development keeps working — the worst kind of failure. Each
caller rewrites `app.asar` to `app.asar.unpacked` in the script path, which is a
no-op in development. It is a glob rather than seven filenames on purpose: a new
script added to `src/system/` is unpacked without anybody remembering to say so.
The packaged build has been run and confirmed to OCR correctly from the unpacked
location.

**The build is unsigned.** Windows SmartScreen will warn on first run and some
users will not get past that. Shipping properly needs an Authenticode
certificate; an EV one avoids the reputation-building period. That is a purchase
and an identity check, not a code change. The routes, the prices and the
electron-builder config for each are in [BUILDING.md](BUILDING.md#signing-the-windows-build).

Signing also matters to updates: unsigned, electron-updater skips the publisher
check on an installer it downloaded, and the SHA-512 in `latest.yml` is the only
thing left guarding it.

## Shipping

What is done: the app builds, installs, runs from the installed location, and
autostart is wired to `setLoginItemSettings` (packaged builds only).

What is left, and none of it is code:

- A code signing certificate, or accept the SmartScreen warning — [BUILDING.md](BUILDING.md#signing-the-windows-build)
- A GitHub repository with a published release, or `Check for updates` finds nothing
- Steamworks account and the $100 app fee, store page, depot upload
- Or itch.io, which has no fee and no signing expectation — a better first stop
- Screenshots and a capture of the pet answering something, which is the entire
  pitch and cannot be conveyed in text

Steam is the one storefront in this category with any precedent for paid desktop
companions, at roughly $5 with skins as the only upsell that has historically
worked. That was the reasoning behind building the demo before the app.

## Going outside

**`Let it out on the internet` is off, and off is the point of this app.** While
it is off the pet is sealed in: a local model, local OCR, local speech, and every
skill that would need the network says so instead of doing it.

Turning it on **sends nothing by itself**. It unlocks three settings, each its
own decision with its own switch, and turning the master switch back off turns
all three off in the same pass — in [settings.js](src/core/settings.js), once, rather than
at each of the call sites that would otherwise have to remember.

| Unlocked | What leaves | Where to |
| --- | --- | --- |
| Weather | A town you typed, and coordinates rounded to ~1km | open-meteo.com |
| Look things up | The words you typed after `look up`, redacted | DuckDuckGo, Wikipedia |
| A hosted model | **The text read off your screen**, redacted | whichever company you picked |

The first two need no account and no key, so nothing ties either request to you.
The lookup carries one thing you did not type — `t=screenpet`, DuckDuckGo's
convention for an application naming itself — which says which app is asking and
not who. The third is a different order of thing and has its own section below.

### Looking things up

```
look up the speed of light
search for tardigrades
who is ada lovelace
```

Instant answers first, the encyclopedia when there is no instant answer. Both
hosts are hardcoded in [net.js](src/core/net.js), the query is capped at 120 characters
and redacted before it goes, and the reply is cut to two lines at a sentence
boundary. Nothing from your screen, memory, camera or microphone is ever part of
a lookup.

The trigger words are deliberately narrow — `search`, `look up`, `google`,
`who is`. `what is a closure` is **not** one of them: that is the model's job,
and a skill that grabbed every "what is" would answer it out of an encyclopedia
with total confidence and no idea what you were actually working on. There is a
test for that.

### Somebody else's model

Anthropic, OpenAI, Google Gemini, NVIDIA NIM and Mistral, chosen in Settings.
Three deliberate acts before any of it happens: the network switch on, a provider
picked, a key stored.

**Be clear about what this trades away.** With a hosted provider selected, the
text this app reads off your screen is sent to that company. It goes through the
same redaction that guards the local prompt first — keys, tokens, JWTs, card
numbers — but redaction is a filter for the secrets it knows the shape of. It is
not a promise about the rest of what is on your screen. The settings window says
so in as many words, in red, before you save.

Two things stay local whatever you pick:

- **Screenshots are never uploaded.** An image cannot be redacted the way text
  can, so the vision tier is switched off entirely when a hosted provider is
  chosen — you lose diagram reading rather than uploading your screen to keep it.
  Refused in `resolveVision()` and again in `askVision()`, because one lock on
  that door was not enough.
- **Typed chat is redacted too** when it is going to a company, and left alone
  when it is not. Pasting a key into the chat box should not be how it reaches
  OpenAI.

Five providers, three request shapes — NVIDIA and Mistral both speak OpenAI's
`chat/completions` verbatim, so there is no adapter layer, just the two that
genuinely differ. Every URL is hardcoded in [providers.js](src/core/providers.js) and the
key travels in a header, never in a query string: a URL is the part of a request
that ends up in logs, history and referrers. There is a test asserting that for
every provider, and another asserting a failure message never carries the key —
some providers echo the request back in their error bodies, and that message goes
in a speech bubble.

Model names are an editable text field with the current default as a placeholder,
because model names go stale faster than this file will.

### Where a key lives

`keys.json`, wrapped with Windows DPAPI under your user account —
[keys.ps1](src/system/keys.ps1). Not in `settings.json`, which is round-tripped through the
settings window; a key has no business crossing into a renderer.

The settings window can **store** a key and **forget** a key. It is never told
one. There is no `getKey` on the bridge, no IPC channel that returns one, and a
test asserting both. The secret reaches PowerShell on stdin rather than as an
argument, because arguments are visible to anything that can list processes.

**This is not a vault.** Anything running as you can ask DPAPI to unwrap it,
exactly as the pet does. What it buys is that the file is useless on its own —
copied to another machine, or read by another user on this one, it is an
unreadable lump. That is the threat that actually applies to a config file in a
user profile.

### The weather

The oldest of the three, and still the smallest. Every weather source is somebody
else's server and there is no offline version of tomorrow, so it is a setting, it
ships **off**, and with it off the pet gives the refusal it always gave. With it
on, asking about the weather sends:

- the **town you typed into Settings** — not a location lookup, not an IP
  geolocation, not anything Windows knows about where you are. You can put the
  next town over and the forecast is still useful.
- the **coordinates that came back for that town**, rounded to two decimal
  places — about a kilometre, which is as precise as the request has any need to
  be.

That is the entire payload. No account, no API key, no cookie, no device
identifier, nothing from your screen, camera or microphone. [Open-Meteo]
specifically because it needs no registration — a keyed service would tie every
forecast you ask for to an identity, which is worse than the forecast is useful.

The hosts are hardcoded in [weather.js](src/core/weather.js) and are not configurable by
settings, by a skill, or by the model. A setting that could point this at an
arbitrary host would be an exfiltration path wearing a weather feature as a hat.
The tests assert both hosts, assert the town is one encoded parameter, assert the
coordinates are rounded, and assert no identifier appears in either URL.

[Open-Meteo]: https://open-meteo.com

## Verify the privacy claim

Do not take the above on trust. Block the app's outbound network access in
Windows Defender Firewall and use it. On the default settings **everything still
works**, because the only socket it opens is to loopback: reading the screen,
answering, speaking, listening, the camera, reminders, memory, banter. Nothing in
that list needs the network and nothing in it degrades.

Turn the internet switch on and the firewall becomes the thing that shows you
what each unlocked setting was for — the weather stops, lookups stop, and a
hosted provider stops. That is the whole difference, visible from outside the
app, without reading any of this code.

Screen text is scanned for secrets before it reaches the model — API keys,
tokens, JWTs, card-shaped digit runs, and `password:`-style assignments are
replaced with `[REDACTED]`. That is a coarse net, not a guarantee; see
`SECRET_PATTERNS` in [brain.js](src/core/brain.js).

That net matters much more once a hosted provider is selected, because then the
screen text leaves the machine rather than crossing to loopback. It is applied on
that path, and to typed chat on that path, and there are tests asserting both —
but a coarse net is still a coarse net, and it is the reason the default is a
model that runs here.

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
expression, cursor tracking, all ten species, all ten skins, every outfit, stat
bars, hover hit-testing, headpat, tickle, drag, the chat box, every menu item,
and the whole settings form — and fails on any console error. Writes PNGs to
look at.

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

- **Presence is motion, not people.** A still person reads as an empty room after
  two minutes, and a curtain moving reads as company. Real presence detection
  wants a face model and a model file to ship with it; this is thirty lines and
  answers the only question the pet asks.
- **Reminders survive a restart by writing your words down.** One file, capped,
  cleaned and deleted on firing — see [Skills](DESIGN.md#skills). It is still a file with your
  notes in it, which is why it is the only one of its kind here.
- **The quiet check costs a process every twenty seconds.** ~750ms of background
  PowerShell per poll, most of it startup and compiling the P/Invoke, so the pet
  notices a game starting within twenty seconds rather than instantly. The
  alternative is shipping a native module to poll it faster, which is a build
  toolchain and a binary for something nobody will notice.
- **Quiet is Windows' opinion, not a heuristic.** If you leave Focus Assist on
  permanently, the pet stays quiet permanently, and that is the correct
  behaviour rather than a bug. Show it from the tray to override.
- **The wake word's recognition rate is unverified.** The grammar loads, the
  recogniser starts and the process reports ready — that is measured. Whether it
  actually fires when a person says "hey pet" across a room has not been tested,
  because testing it means somebody saying it into a real microphone.
  `SCREENPET_WAKE_CONFIDENCE` is the knob if it is deaf or twitchy.
- **Face detection is a count, and only a count.** It cannot tell you who, it
  cannot be made to, and there is nothing stored that could learn. It also costs
  about a second of PowerShell, so it runs when somebody arrives rather than on
  the motion tick.
- **The beat detector is energy against its own rolling average**, not a tempo
  tracker. It will bob on a door slam and miss a quiet track. Beat detection
  proper is a research project and this has to answer every 25ms on a machine
  already running a language model.
- **The pet is on one display at a time.** It does not follow the cursor, and
  there is no second pet for the second monitor. Reading the screen does follow
  the cursor; the pet itself moves when you tell it to.
- **Music is blind and one-way.** A media key is a broadcast: the pet cannot say
  what is playing, cannot pick a song, and cannot tell you whether the key did
  anything, so its lines are written to be true either way. Each press spawns
  PowerShell and takes about 0.8s, which is fine for something you asked for and
  would be wrong in a loop.
- **A photo is whatever the webcam sees.** No preview, no framing, no retake, and
  no filter — it says "smile", waits 1.5 seconds, and keeps the frame.
- **Skills are patterns, not intent.** They will miss phrasings that are not in
  the list, and the fix for a miss is a new pattern rather than a smarter parser.
  Missing falls through to the model, which is the safe direction.
- **The confidence gate is calibrated against noise, not against speech.** 0.30
  clears the measured floor (0.029) by an order of magnitude, but nobody has
  spoken a clear sentence into it on a quiet headset and checked what score comes
  back. It could be rejecting real speech. `SCREENPET_MIC_CONFIDENCE` is the knob.
- **Dictation accuracy is SAPI's**, which means plain sentences are fine and
  anything technical is not. "deserialise" is not coming back intact.
- **The mouth starts moving about a second after the bubble appears**, because
  `speechSynthesis.speaking` goes true when the utterance is queued and `onstart`
  fires when audio actually begins. Measured, and left alone: the mouth should
  move when sound comes out, not when the text appears.
- **Speaking is not interruptible by voice.** The only ways to stop a line are
  clicking the bubble and the tray mute.
- **Primary display only.** Multi-monitor picks the primary one.
- **Whole screen, no region select.** More text than needed, so a busy screen
  makes for a worse prompt.
- **Text only until you install a vision model.** See "Two tiers" above.
- **First vision model wins.** Detection takes the first model reporting the
  `vision` capability rather than ranking them by size or quality.
- **Small vision models are brittle about prompts.** `buildVisionPrompt` is one
  short sentence with the mood in front, and that shape was measured rather than
  chosen — see the comment above `VISION_TASK` in [brain.js](src/core/brain.js) before
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
- **Web lookups are keyless, and it shows.** DuckDuckGo's instant answers are
  inconsistent for the same query, and Wikipedia's search matches titles
  literally — `look up the speed of light` can come back with a novel of that
  name rather than 299,792,458 m/s. A real search API would fix it and would
  need an account, which is the trade this deliberately does not take.
- **Hosted providers are not benchmarked.** Local models were measured against
  the quiz and mix screens; these were not. The request shapes are tested against
  a stub, and the wiring was exercised end to end, but no answer quality claim is
  made about any of the five.
- **Default model names for hosted providers will go stale.** They are
  placeholders in an editable field, not a maintained list.
- **DPAPI is not a vault.** Anything running as your user can unwrap `keys.json`.
  It stops the file being useful elsewhere; it does not stop a process that is
  already you.
- **No streaming and no token accounting** on hosted providers. One request, one
  answer, capped at 400 tokens — you find out what it cost from their dashboard.
- **Memory recall is word overlap.** `remember the cat is called biscuit` is
  found by "biscuit" and not by "my pet". Paraphrases are missed, and the fix
  would be a vector index inside a desktop pet.
- **A routine only fires on the hour you gave it.** `remember I stretch at 3`
  brings it up somewhere in the 15:00 hour, not at 15:00 exactly, and not at all
  if the app is closed for that hour. Reminders are the exact ones.
- **Patterns are one three-hour window per event.** Somebody with two distinct
  work sessions gets one of them called a habit and the other ignored. Six
  observations and a 40% share is a threshold that felt right, not a measured one.
- **Nothing prunes an old fact.** Forty are kept, the oldest falls off the end,
  and something you asked it to remember in March is still quoted back in
  December unless you say `forget`.
- **Autostart is wired but not exercised end to end.** It is gated on
  `app.isPackaged` and only reachable from the settings window of a built app.
- **Updates are a button, never a background check.** Settings → More →
  `Check for updates` asks GitHub what is out and installs it over the copy you
  have. Nothing polls, nothing downloads unasked, and none of it works in
  development — there is no installed copy for an installer to replace.
- **`ocr.ps1` needs Windows PowerShell 5.1**, not PowerShell 7 — the WinRT type
  projections it uses do not exist in 7.
- **The first answer after a cold start is still the slow one.** ~7.6s of model
  load before the model does any thinking. See below.

## Not for exams

This is a study companion. Using it in a proctored exam is academic misconduct,
and that is not the market this is built for.

## The paperwork

- [PRIVACY.md](PRIVACY.md) — what is read, what is stored and where, and what can
  leave only if you switch it on. No account, no telemetry, no server.
- [TERMS.md](TERMS.md) — the licence agreement, and the three things it asks of
  you: do not point it at material you have no right to, do not use it in an
  exam, and check an answer before you act on it.
- [LICENSE](LICENSE) — PolyForm Noncommercial 1.0.0. Free for anything that is
  not a business; commercial licences by arrangement.
- [CONTRIBUTING.md](CONTRIBUTING.md) — how to file a bug, what a good pull
  request looks like, and the licence terms your contribution comes under.
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) — be decent to people, at length.
- [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) — Electron, the Windows APIs,
  Ollama and the models, and the attribution the two free web services want.
- [SECURITY.md](SECURITY.md) — how to report a hole, and the invariants worth
  attacking.
- [CHANGELOG.md](CHANGELOG.md) — what changed in each version, including
  anything that changed what leaves the machine.
