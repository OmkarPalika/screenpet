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
`listen` `curious` `wink` `doze` `oops`

They are CSS, not sprites — the mouth is a `d: path(...)` swap and the extras
(brows, tongue, tears, sweat, sparkle, anger mark, `z`s) are `display` toggles.
So they cost no images, and they compose with all four skins for free.

`rage` is deliberately the `annoyed` face turned up — steeper brows, angrier
mouth, a shake and a hue shift — rather than a face of its own. That is what
makes it read as the same pet getting angrier instead of a different pet turning
up.

**The bow** is an accessory on the shared rig, not part of any body, so all six
species wear it with no per-species rules. It appears for the cute half of the
range only — `love` `shy` `giggle` `proud` `joy` `wink` — and a test asserts
`rage`, `cry` and `oops` never get one. A pet in tears wearing a party bow is a
different feeling entirely.

Every face is reachable from something that actually happens, which is why there
are twenty-one and not fifty: `listen` while the microphone is open, `curious`
when it heard nothing back, `wink` on every other spoken reply so a long
conversation is not one fixed smile, `doze` when the machine goes idle — it used
to nod off silently and just turn grey, which reads as a crash rather than a nap
— and `oops` for a genuine failure, which is a different thing from `sulk`. The
pet declining to eat because it is full is not an error.

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

## Out loud, and back

Both directions of speech are on-device, and both are the platform's own — no
model files, no downloads, nothing new to trust.

**It speaks** through Windows' installed voices, via the platform synthesiser.
The only voices it will use are ones flagged `localService`: some platforms list
network-rendered voices next to the installed ones and nothing else tells them
apart. Emoji and `*stage directions*` are stripped before speaking, because
"money with wings" read aloud is not the joke. Mute lives in the tray, one click,
because the moment you want it quiet is the moment a call starts.

The mouth moving while it talks is a **class**, not an expression, and that
distinction is load-bearing: an expression would replace whatever face the pet
was already making, and a raging pet that goes blank the moment it opens its
mouth is not raging. There is a test pinning it.

**It listens** through `System.Speech`, driven from `listen.ps1` exactly the way
OCR is driven from `ocr.ps1`. Push to talk: `Listen…` opens the microphone, one
phrase is recognised, and it shuts. No wake word and no listening loop — a pet
that is always listening is a microphone with a face on it.

Chromium's `SpeechRecognition` is the obvious way to add dictation to an Electron
app, and it uploads the audio to Google. **That is the one thing this app may
never do**, so there is a test asserting the string appears in none of the source
files rather than a comment asking nicely.

**Noise is the real failure mode, not silence.** Dictation does not return
"nothing" when nobody is speaking — it returns a fluent sentence with a terrible
score behind it. Measured on this machine, three seconds of an ordinary room:

```
heard:      "Note to the audit got a"
confidence: 0.029
```

So a result under `0.30` is discarded and the pet says it did not catch that. The
threshold clears the measured noise floor by an order of magnitude, but it has
**not** been calibrated against real speech on a quiet headset — rooms and
microphones differ. If a perfectly clear sentence keeps coming back as "I did not
catch that", lower it:

```bash
set SCREENPET_MIC_CONFIDENCE=0.15
```

Accuracy is SAPI's, which is fair for plain sentences and poor for technical
words. Swapping in whisper.cpp would fix that at the cost of a binary and a model
download; the trade is noted in `listen.ps1` rather than taken.

## Skills

Some things a model should not be asked to do. These are matched in
[skills.js](skills.js) **before** anything reaches Ollama, so they are instant,
exact, and identical every time:

| Say | Get |
| --- | --- |
| `set a timer for 5 minutes`, `wake me in half an hour` | A timer, and it survives a restart. `remind me to stretch in 20 minutes` keeps the reason and says it back when it fires. |
| `what time is it`, `what day is it` | The clock, from your machine. |
| `battery?` | Level and whether it is charging. |
| `flip a coin`, `roll a d20` | A result, and a spin while you get it. |
| `rock` / `paper` / `scissors` | An actual game. It dances if it wins and falls over if it does not. |
| `dance`, `spin`, `jump`, `fall over`, `look around` | See "A body" below. |
| `next track`, `pause the music`, `turn it up`, `mute the sound` | The keyboard's media keys. Whatever is already playing obeys. |
| `take a photo`, `say cheese` | One frame from the camera, into your Pictures folder. Needs the camera switched on. |
| `what is the weather` | A refusal, with the reason. |

**A reminder is the one thing here that writes down your words.** "Remind me to
call the bank in an hour" has to survive a restart to be worth setting, and
surviving a restart means a file: `timers.json`, beside your settings, holding
the time and the sentence. It stays on your machine like everything else, it is
capped at 20 entries and 200 characters, control characters are flattened before
anything reaches a speech engine, and each line is deleted the moment it fires.
Reminders that came due while the app was closed are said once on the next
launch — unless they are more than two days old, at which point nobody wants to
hear about them. Every bit of that validation is in
[reminders.js](reminders.js), on the assumption that the file may have been
hand-edited or corrupted.

**Weather is matched deliberately in order to turn it down.** Every weather
source is somebody else's server and it wants your location to be useful. Left
unmatched, the model cheerfully invents a forecast — which is worse than saying
no, so the pet says no.

**Music is one keypress, not an integration.** [media.ps1](media.ps1) taps a
single Windows media key — the same one on your keyboard — and whatever holds the
transport handles it: Spotify, a browser tab, the Groove app. Nothing comes back.
The pet cannot see a track name, an artist or even whether anything was playing,
which is exactly why it needs no account, no API key and no server. The only
codes it will press are `0xAD`–`0xB3`, the volume and transport block, checked
both in [media.js](media.js) and again in the script — this presses real keys on
a real machine and the caller is a regular expression.

**A photo is the one frame that gets written down.** Everything else the camera
sees is destroyed in place (see "Noticing you"); asking for a photo out loud
saves a single 640×480 JPEG to `Pictures\screenpet` and says the filename back.
The filename is generated in `main.js`, never taken from the renderer, so nothing
crossing the bridge can choose a path. It still goes nowhere near a network.

**The false positives are the whole difficulty.** A skill answers *instead* of
the model, with total confidence, and nothing anywhere reports that it did. So
`what is the time complexity of quicksort` must not return the clock — it did,
until the pattern was anchored to the end of the line. `spin up a server`,
`jump to line 40` and `walk me through this` were all making the pet perform
tricks instead of answering. `what does the next track index do` skipped the
song, and `take a photo of the receipt and email it` reached for the camera —
both fixed by anchoring the pattern to the end of the line, so a command has to
*end* after the command, give or take a `please`. Anything over 90 characters is
treated as a question rather than a command, on the grounds that commands are
short.

Those cases are pinned in `npm test`, and the test was checked by putting the
bug back and confirming it failed:

```
AssertionError: a skill hijacked: what is the time complexity of quicksort
```

Timers live in memory only. One that survived a restart would mean a file on
disk with your notes in it, and this app does not keep one.

## A body

Six whole-body movements, separate from the twenty-one faces:

`walk` `dance` `spin` `jump` `topple` `peek`

**The face and the body are different axes on purpose.** An expression is
`data-expr` on `.pet`; a movement is `data-move` on the `svg` inside it. Two
elements, two `animation` properties — so the pet can lose at rock-paper-scissors,
sulk about it and fall over at the same time. Putting both on one element means
whichever rule wins silently cancels the other, and the pet goes blank every
time it moves. There is a test that sets a movement on a raging pet and asserts
the anger mark is still there.

Wandering now walks rather than glides: the stage was always sliding along a CSS
transition, and the step cycle runs for exactly as long as that transition takes.
Idle quirks pick a whole movement about a third of the time. Dancing is not among
them — a pet that breaks into a dance at nobody is unsettling rather than
charming, so that one stays something you ask for.

`npm run verify:ui` writes `pet-moves.png`, each movement paused partway through
at the frame that has to look right: the apex of the jump, the pet on the floor.

One thing that only a render would have caught: **the shadow is drawn inside the
svg**, so toppling turned it over too and the pet fell next to a shadow standing
on its edge. It is now counter-rotated about the same origin, which cancels
exactly. Then the contact sheet kept showing the bug after it was fixed, because
the sheet blanks every descendant animation and only the body's was being put
back — the still was wrong, not the stylesheet.

## Noticing you

Off by default, and the least capable thing that answers the question.

With `Notice when I am at the desk` switched on, the pet greets you when you sit
down and settles to wait when you have been gone two minutes. That is all it
does, and all it *can* do:

- frames go to a **32×24** canvas — 768 pixels
- each is reduced to **one number**: how much changed since the last one
- that number becomes one of three words — `arrived`, `left`, `blind` — and the
  frame is discarded

Nothing is stored, encoded, recognised or sent — with exactly one exception, and
it is the one you asked for out loud: `take a photo` keeps that single frame, in
your Pictures folder, and nowhere else. **It cannot tell who you are**,
and no amount of prompting will make it say, because the information is gone
before anything else in the app can see it. The pet greets you vaguely for the
same reason: greeting you *by name* off a motion threshold would be claiming
something it does not know.

A green dot on the pet is lit for exactly as long as the stream is open.

**The permission gate is the real control.** Electron's default handler grants
most of what a page it loaded asks for; this app replaces it with a deny-by-all
rule and exactly one exception — `media`, video only, and only with the setting
on. Geolocation, notifications, the microphone through `getUserMedia`, and
anything Chromium adds in future are refused without being listed. It lives in
[settings.js](settings.js) as a pure function so the whole truth table is
testable without booting Electron, and both of Electron's handlers are installed,
because they are told the media type differently and wiring only one undoes the
other.

Verified in both directions rather than assumed:

```
run 1: camera OFF   permission media ["video"] -> denied    stream:false light:false
run 2: camera ON    permission media ["video"] -> ALLOWED   stream:true  light:true   -> arrived
run 3: switched off                                         stream:false light:false
```

The photo path was checked end to end against the real `main.js`, with Chromium's
fake capture device standing in for the lens so no real room was photographed to
prove a feature works:

```
camera ON    stream:true  640x480   "take a photo" -> *click* saved screenpet-....jpg
                                    wrote 8851 bytes, jpeg=true
camera OFF   stream:false 0x0       "take a photo" -> my eyes are shut! switch the camera on
                                    wrote nothing
```

## Getting out of the way

A desktop pet that talks over a game is not charming, it is a bug. Windows
already tracks whether now is a good time to interrupt — it is the same question
it asks itself before showing a toast — so the pet asks Windows rather than
guessing:

| `SHQueryUserNotificationState` says | The pet |
| --- | --- |
| a full screen app, a game, or presentation mode | goes quiet and gets off the screen |
| Focus Assist / Do Not Disturb on | same |
| the screen is locked or off | same |
| nothing in the way | behaves normally |
| something Windows adds in a future version | goes quiet — the list is of *talkative* states, so an unknown one keeps the pet silent rather than chattering |

**Quiet means unprompted talk only.** Everything you ask for still answers, and
answering brings the pet back for thirty seconds before it puts itself away
again. Reminders still fire; you set those on purpose. Showing the pet from the
tray while it is hiding overrides the whole thing until the quiet spell ends.

Nothing about the foreground application comes back from that call — not its
name, not its title, not its window. One integer describing the machine's mood,
which is both all the pet needs and the least it could ask for.

Measured on a machine genuinely in `QUNS_QUIET_TIME`, against the real
`main.js`:

```
QUNS state    -> 5 (quiet=true)
visible       -> false                       put itself away
after asking  -> visible=true "Tails!"       answered, and came back to say it
later         -> visible=false               and went away again on its own
```

## Two monitors

The pet stands on one display's bottom strip. Which one is up to you: **Move pet
here** in the tray menu moves it to whichever display the cursor is on.

Reading the screen does not wait to be told. `Ctrl+Shift+Space` captures the
display the **cursor** is on, not the primary one, because on two monitors the
question is almost always about the screen you are working on — and reading the
other one back is worse than useless, it is confidently wrong.

Unplugging a monitor with the pet standing on it used to leave the window running
somewhere that no longer existed. It now restages onto the nearest surviving
display, which covers a resolution change for free:

```
shoved to      {"x":-9000,"y":-9000,"width":400,"height":300}
restaged       {"x":0,"y":564,"width":1536,"height":300}   on a real display: true
```

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

That directory is the whole of what this app writes: `pet.json`, `settings.json`,
and `timers.json` if you have set a reminder. Every one of them is validated the
same way on load, and none of them holds a transcript — conversation history is
in memory and dies with the process.

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
| Speak replies out loud | On by default. Mute from the tray without opening this window. |
| Let me talk to it | Off by default. Adds `Listen…` to the pet's menu. |
| Notice when I am at the desk | Off by default. Motion only — see "Noticing you". |
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
- A microphone and a Windows speech recogniser, **only** if you switch on
  `Let me talk to it`. Check what you have:

  ```powershell
  Add-Type -AssemblyName System.Speech
  [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers()
  ```

  An empty list means no recogniser is installed and the pet says so rather than
  failing silently. Add one under Settings ▸ Time & language ▸ Speech.

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

- **Presence is motion, not people.** A still person reads as an empty room after
  two minutes, and a curtain moving reads as company. Real presence detection
  wants a face model and a model file to ship with it; this is thirty lines and
  answers the only question the pet asks.
- **Reminders survive a restart by writing your words down.** One file, capped,
  cleaned and deleted on firing — see "Skills". It is still a file with your
  notes in it, which is why it is the only one of its kind here.
- **The quiet check costs a process every twenty seconds.** ~750ms of background
  PowerShell per poll, most of it startup and compiling the P/Invoke, so the pet
  notices a game starting within twenty seconds rather than instantly. The
  alternative is shipping a native module to poll it faster, which is a build
  toolchain and a binary for something nobody will notice.
- **Quiet is Windows' opinion, not a heuristic.** If you leave Focus Assist on
  permanently, the pet stays quiet permanently, and that is the correct
  behaviour rather than a bug. Show it from the tray to override.
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
