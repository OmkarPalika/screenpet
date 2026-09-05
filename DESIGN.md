# How screenpet behaves, and why

The long half of the documentation: what the pet does when nobody is asking it
anything, and the measurements behind the decisions that look arbitrary from the
outside. Split out of the README so that installing the thing does not require
reading two thousand lines about a cartoon cat first.

Nothing here is needed to run it. That is all in **[README.md](README.md)**.

## Pets

Ten of them: **blob**, **cat**, **pup**, **bun**, **bird**, **dragon**, **fox**,
**axolotl**, **ghost**, **robot**. Pick one in Settings, next to the ten skins — butter, mint, blossom, slate, coal, cream,
moss, plum, sky, coral. They are orthogonal: every pet works in every palette,
and every outfit works over both, so it is 10 × 10 × 9 rather than ten.

A palette is **three CSS variables** — `--body`, `--ear`, `--cheek` — defined in
one place. The settings swatch paints itself from the same three off its own
`data-skin`, so a new skin is one rule in one file; a test asserts `settings.css`
never names a skin, because the version of this that hardcoded four swatch
colours is exactly how a skin ships as a colourless circle.

### Lit, not drawn

The shapes are flat paths and stay flat paths, and the pet is not flat. What
makes something look solid on a screen is light rather than geometry, so the
geometry is left alone and a light is put on it: the shape's own alpha, blurred,
is the surface; that surface is lit; the result goes back over the colour. It is
an SVG filter, in [lighting.js](src/renderer/lighting.js), and because it works
off the alpha it applies to **any** shape — ten species, every outfit, and
whatever the next one is, all round without anybody drawing a highlight on
anything.

One light, up and to the left, for every pet on the screen. Two pets lit from two
directions is the thing that reads as wrong. The shadow underneath is blurred
rather than a hard ellipse — a hard one is a sticker, a soft one is contact, and
contact is most of what says the pet is standing on something.

The head **turns towards the cursor**, a few degrees on both axes. Nothing in a
still frame; most of what makes it read as an object in a room rather than a
picture of one. Everything except the shadow is inside that group, because the
floor does not turn.

**And the light stays where the lamp is while the pet turns.** A filter is
applied in the shape's own coordinates, before the CSS transform, so a highlight
painted on it goes round with it — which is precisely what a sticker on a
turntable does, and it was what gave the spin away. Halfway through, the pet is
mirrored and the bright side is the side facing away from the light.

So the shape is left to rotate and the light is rotated the other way about the
same axis. The angle is **read back out of the pet's computed transform** rather
than counted — `m11` is the cosine, `m31` the sine, measured in a browser
because both conventions are defensible and only one is Chromium's — so the
duration, the easing and the number of turns all stay in the stylesheet where
they belong, and the light cannot end up a frame behind the body.

The part that sells it falls out for free: past a quarter turn the light is
*behind* the pet, and the side you are looking at goes dark on its own. That
needed one addition — an ambient floor, because with nothing but the lamp the
pet became a silhouette at half a turn, and nothing real does that. A toy with
the lamp behind it is dark on this side, not absent.

Every document that draws a pet loads the same file — the pet window, the
settings previews and the demo stage — so a preview cannot be lit differently
from the thing it is previewing.

The alternative was a real mesh: ten models, forty faces and nine outfits
rebuilt in 3D, and no artist. This is one filter, and the whole rig below it
still works.

Every species keeps the **same face rig**: same classes, same coordinates. Only
ears, body outline and extras (tail, crest, whiskers) change. That is the whole
trick — all thirty-nine expressions work on all ten pets without a single extra
rule, and the next pet is one CSS block, not a new sprite sheet. The ghost and
the robot are the two that swap `.body` as well; everything else hangs off it.

Shapes live in `src/renderer/pets.css`, which the pet window, the settings previews
and the demo stage all load. One definition per pet, so the picker previews are
drawn by the same rules as the real thing and cannot disagree with it. A test
asserts no species rule sneaks into `style.css`, which only the pet window
loads — a shape hiding in there would render correctly and preview as a blob.

`npm run verify:ui` writes `pet-species.png`: every pet in every skin.

### They each behave a bit differently

**Voices.** Each species has its own lines for the things it says most — idling,
being fed, patted, played with. Everything else falls through to the shared bank,
so a new pet means writing the lines it actually has an opinion about rather
than filling in a 15-cell grid. The cat says `you may continue`; the pup says
`again again again`.

**Idle quirks.** Every 9–23 seconds of nothing happening, the pet does something:
the cat stretches and flicks its tail, the pup hops and wags, the bun twitches an
ear, the bird pecks, the dragon rumbles and sways, the blob squishes, the fox
pounces, the axolotl paddles, the ghost fades as it drifts up, and the robot
glitches in four hard steps rather than easing anywhere — the one that is not a
creature should not move like one. They all glance around while doing it.

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
So they cost no images, and they compose with all ten skins for free.

`rage` is deliberately the `annoyed` face turned up — steeper brows, angrier
mouth, a shake and a hue shift — rather than a face of its own. That is what
makes it read as the same pet getting angrier instead of a different pet turning
up.

**The bow** is an accessory on the shared rig, not part of any body, so all six
species wear it with no per-species rules. It appears for the cute half of the
range only — `love` `shy` `giggle` `proud` `joy` `wink` — and a test asserts
`rage`, `cry` and `oops` never get one. A pet in tears wearing a party bow is a
different feeling entirely.

### The wardrobe

Eight outfits, picked in Settings, worn by every species:

`bow` `shades` `halo` `hero` `party` `wizard` `crown` `headphones`

The first three were already drawn — the bow for the cute faces, the shades for
`cool`, the halo for `innocent` — so wearing one costs a CSS rule rather than a
shape. `hero` is a **mask and a cape**, and the cape is drawn before the body in
the markup for the same reason the tail is: in front, it is a bib.

The mask is cut with **holes rather than lenses**. A solid mask over both eyes
would take the gaze, the blink and most of the thirty-nine faces with it, so it
is one path with `fill-rule="evenodd"` and two ellipses punched out of it. A
check asserts the eyes are still `display: block` under every outfit.

What is on is **one value** on the root element, not a set. An outfit is a
decision — "hero" is two shapes and one choice — and a list of items would need a
second validator to stop a hand-edited settings file asking for four hats.

Nothing in the wardrobe is species-aware. A hat on a bun sits between the ears
rather than on top of them; six sets of per-species nudges to make it read as a
slightly better hat is not a trade worth making. `npm run verify:ui` writes
`pet-wardrobe.png` — every outfit on every pet — so that stays a decision rather
than an accident.

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

The pet answers the way a person answers out loud — not like a search result, and
not like a greetings card either:

> Three hundred ninety-one. That's seventeen times twenty-three.
>
> A 401 means Unauthorized — you asked for something without valid credentials,
> like a login token.

**The answer itself is not negotiable.** The prompt says to give it plainly and
completely, never to hide it or hint at it. That clause is load-bearing: this same
file used to open with "you are a desktop pet" and produced 79–240 character
replies that narrated the screen and talked about themselves, which is why the
wording was stripped back to something that answered but sounded like a lookup.
The version with the answer pinned down measured **9/9 correct across three
screens**, three runs each, with the voice back. Re-measure before editing it.

**Warmth was asked for as an "affectionate flourish", and that phrasing is what
produced the tildes, the emoji and the third-person cooing.** It now asks for how
a person actually speaks — contractions, plain words, nothing stiff — and caps the
humour at one dry aside *after* the answer, with an explicit way out: if nothing
about it is funny, leave it out. The escape hatch matters. Without it a small
model strains for a joke on questions that do not have one in them, and a strained
joke is worse than a straight answer. Emoji, asterisks and narrated actions are
now forbidden outright rather than rationed.

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

**It speaks two different ways, and which one depends on whose words they are.**

**Its own lines are chirps** — a run of little square blips, synthesised on the
spot by the same code that makes the woofs and the meows. Everything it says off
its own bat goes out that way: greetings, small talk, banter, the sulk, being
tickled, "I did not catch that". The words are still in the bubble; this is how
they sound, not what is said.

The rule is mechanical rather than a judgement call: **words that came out of the
line bank are chirped, and everything else is spoken.** An answer off your
screen, a lookup, the time, a battery level, an error — those are information you
asked a question to get, and an answer you cannot hear is not an answer. There is
a test that walks every line-bank send in `main.js` and fails on one that has not
said which it is.

The blips carry as much of the sentence as blips can. Length comes from the
vowels, so a long line chirps longer, capped so an answer never turns into a
modem. The last two blips carry the final punctuation: up for a question, flat
and hard for a shout, down for anything else. The pitch inside a blip never
bends, which is the whole of what makes a thing sound built rather than born —
the same rule the robot's own bark follows. And the same sentence chirps the
same way every time, from a hash of the text: a line that sounds different twice
reads as noise rather than as a voice.

**The words it speaks** go through Windows' installed voices, via the platform
synthesiser. The only voices it will use are ones flagged `localService`: some
platforms list network-rendered voices next to the installed ones and nothing
else tells them apart. Emoji and `*stage directions*` are stripped before
speaking, because "money with wings" read aloud is not the joke. Mute lives in
the tray, one click, because the moment you want it quiet is the moment a call
starts — and it silences both, including a line already halfway out.

Chromium hands out no audio for a spoken utterance — which is why the chirps had
to be synthesised separately, and for a while it was also why the pet sounded
like a train station announcement. **Windows will hand the audio over; Chromium
just will not.** `say.ps1` synthesises to a buffer with `SetOutputToWaveStream`
and prints it as base64, and from there it is an ordinary `AudioBuffer` and
anything can be done to it.

`robot.js` is what is done to it. Five stages, each with a job:

| | |
| --- | --- |
| pitch | synthesised slow, played back fast. Chromium has no pitch shifter, and slow-then-fast raises the pitch without changing how long the sentence takes — the difference between a small creature and a tape on the wrong speed |
| ring | a 52Hz oscillator multiplying the signal. This is the sound people mean by "robot", and the one effect that is unmistakably not a throat. Mixed at 0.3, because a full ring modulator is a Dalek and a Dalek is not a pet |
| grit | a soft clip, so a quiet consonant does not sound like it came from another room |
| box | 13ms of feedback delay — a small metallic resonance, the sound of being inside a case |
| band | 170Hz to 5.2kHz, twice over. A machine the size of a mug has no chest and no air, and that absence is most of the illusion |

The band limit goes **last**, and that was measured rather than assumed: in the
middle of the chain it made the low end *worse* than the untouched voice. Ring
modulation puts sidebands below every frequency it touches, the soft clip makes
intermodulation products out of them, and a 13ms comb resonates at 77Hz — all
three arrive after the filter and walk straight past it.

`verify:ui` renders a real sentence from the real speech engine through the real
chain and checks four things: it is audible, it does not clip, its shape is not
identical to the untouched voice, and the share of it below 170Hz is well under
what went in. That last one was wrong twice before it was right — first
comparing absolute energy between signals at different volumes, then measuring
"under 170Hz" with a filter too gentle to mean it.

`SetOutputToAudioStream` is the trap, incidentally. It sounds like the more
precise of the two and writes raw PCM with no RIFF header, which
`decodeAudioData` refuses.

Nothing is written to disk on the way. A WAV of everything the pet has ever said
to you is exactly the sort of file this app promises not to leave lying around,
and a `MemoryStream` costs nothing to use instead. A host that cannot do any of
this is not mute — the renderer falls back to the platform voice, which is what
every version before this one used.

The mouth moving while it talks is a **class**, not an expression, and that
distinction is load-bearing: an expression would replace whatever face the pet
was already making, and a raging pet that goes blank the moment it opens its
mouth is not raging. There is a test pinning it.

**It makes a noise first.** A woof, a meow, a chirp, a rumble — whichever it is —
in the moment before the words. There are no audio files: nothing is recorded,
licensed or unpacked out of the asar, because each voice is six lines of
oscillators and filtered noise in [voices.js](src/renderer/voices.js). A
bark is a low thump with a burst of noise on it; a meow is a sawtooth whose pitch
goes up before it comes down, through a lowpass filter standing in for a mouth; a
chirp is over before you can place it.

The **face** decides how it comes out. Five feelings — neutral, happy, sad,
cross, sleepy — each a pitch, a speed and a volume, so the cat has one meow and
five ways of meaning it. A crying pet is slower and lower than a delighted one
without a second recipe existing.

**That is enough for most faces and a lie for the rest.** A cross cat does not
meow faster, it *hisses*, and there is no setting of pitch and speed that turns a
meow into a hiss. So there is a second table of hand-written calls — about thirty
— for the feelings where the animal has a different sound entirely, and the
species' own voice is used everywhere else:

| | what it does instead of its voice |
| --- | --- |
| cat | hisses when cross, yowls when sad, **trills** when pleased, **purrs** when sleepy |
| pup | growls, whines — a whine goes *up*, which is why it reads as asking for something |
| bun | **thumps a foot and says nothing at all**, and honks when pleased, which rabbits genuinely do |
| bird | rattles its beak, sings three rising notes |
| dragon | roars, idles like an engine, and snores in two parts — in, then out |
| fox | **gekkers**: the stuttering row foxes have at 3am |
| axolotl | has no vocal cords, so every feeling is water moving |
| ghost | moans, and the moan is the one sound allowed to outstay itself |
| robot | powers down when sad — the only place it is allowed to bend a pitch |

A call is played *straight*, with the feeling not bent into it, because it
already is the feeling: running a hiss through cross's 1.3× speed makes a shorter
hiss and nothing else.

Two things had to be measured rather than written. An exponential envelope spends
over half its length below anything you can hear, so the pulse-based calls — the
purr, the rattle, the dragon's idle — needed to be about twice as long and twice
as loud as they looked on paper; the first purr rendered as *silence*. And
`verify:ui` now renders all fifty species-and-feeling combinations, checking each
is audible, does not clip, and — the check that matters — sounds measurably
**different from that species' ordinary voice**. A feeling that renders
identically has not been expressed.

Assertions can measure a sound but cannot tell you it is *wrong*, so
`verify:ui` renders every voice into an `OfflineAudioContext` and checks the
three things a broken one fails: it is audible at all, it does not clip, and it
lasts between 40 and 700ms. The bun and the bird both failed that last check on
the first pass — a squeak at the top of the range is most of the way to a sound
you cannot hear — and were lengthened until they passed.

**And two noises that are not its voice at all.** A footfall while it walks -
eight of them in a walk, timed off the step cycle in the stylesheet rather than
guessed, because steps that drift out of time with the legs are worse than no
steps - and a thud when it lands from a throw, loud in proportion to how hard it
hit. A pet dropped two pixels and a pet thrown across the screen making the same
noise is the thing that gives away that neither is real.

`Little noises` in settings, and `Mute noises` in the tray, separate from the
voice: muting a pet that reads your screen aloud and muting a pet that goes
"woof" are two different wants, and the second outstays its welcome first.

**It notices you moving between windows.** Switch to your browser and the pet
looks over at it; every so often it leans across to see what turned up. It says
nothing — a pet that pipes up every time you alt-tab is the single most annoying
thing this app could do — and it goes still in the same three places everything
else the pet starts goes still: mid-answer, asleep, and while Windows says keep
quiet.

What crosses that boundary is a rectangle. Not the title, not the process, not
the class: the pet cannot tell a bank from a browser game, and nothing about it
is written down, remembered between switches, or shown to a model. It is the
same `window.ps1` that crops a screen read, left running with `-Watch` — which
is the whole reason this works at all. The reaction has to land inside about a
second to read as noticing, and starting PowerShell is ~400ms, so a check on the
pet's twenty second tick was never going to be one. One process for the session
polls `GetForegroundWindow` every 400ms and prints only when the handle changes
— the handle rather than the rectangle, because typing moves nothing and
dragging a window around is not you looking somewhere else.

It also has to die when the app does. `unwatch()` covers quitting; the loop
holds a handle to its parent and breaks when that exits, which covers the crash
and the kill. Without it, force-quitting the app leaves something polling the
foreground window until you reboot.

There is no keyboard hook here and there is not going to be one. The other half
of "react to what I am doing" is reacting to typing, and the only way to know
you are typing is to watch every key you press — which is a keylogger whatever
the settings window calls it.

**It listens** through one of two recognisers, both on this machine: Windows'
`System.Speech`, driven from `listen.ps1` exactly the way OCR is driven from
`ocr.ps1`, or whisper.cpp if you have installed it — see
[the measurement below](#that-threshold-was-hiding-a-much-worse-problem), which is
not a close call. Push to talk either way: `Listen…` opens the microphone, one
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

### That threshold was hiding a much worse problem

The paragraph above used to end by saying SAPI is "fair for plain sentences and
poor for technical words", and that swapping in whisper.cpp was a trade worth
noting rather than taking. Then it was measured: fourteen phrases spoken into the
actual microphone, the same WAV file fed to both engines — `SetInputToWaveFile`
for System.Speech, so neither gets an advantage from the recording.

| | System.Speech | whisper tiny.en | whisper base.en |
| --- | --- | --- | --- |
| Word error rate | **88%** | 51% | 49% |
| ...with the vocabulary prompt | — | 27% | **21%** |
| Discarded by the `0.30` floor | **14 of 14** | — | — |
| Median latency | 1218ms (544ms engine, rest is the PowerShell spawn) | 831ms | 1647ms |

**88% is not "poor at technical words", it is not working.** `git rebase onto
main` came back as "The leaders of the way". `run npm install then npm test` as
"And humans who didn't have this". And the confidence floor this page defends so
carefully discarded *every single result* — median confidence 0.107, a third of
the threshold. On this voice, dictation never answered at all; it always said it
did not catch that.

Two things were ruled out rather than assumed. The recordings average −25 dBFS,
so they were peak-normalised to −3 and re-run: whisper moved 49% → 46% and SAPI
got **worse**, so level is not the story. Two of the fourteen files are clipped
mid-phrase; excluding them moves base.en to 18% and leaves SAPI at 88%.

**The largest single win is a string, not a model.** whisper takes an initial
prompt that biases decoding, and the app knows its own vocabulary — npm, JSON,
rebase, Postgres, async. That one constant took base.en from 49% to 21%, and the
technical phrases from 87% to 29%. Eight of fourteen improved and none regressed.
It lives in [dictate.js](src/system/dictate.js) and it looks exactly like a magic string
somebody should tidy away, which is why there is a test pinning it.

### Turning it on

`Recognised by` in settings, three values, matching the shape `vision` already
uses: **a local engine if installed, Windows otherwise** (the default), or either
by name. Everything runs on this machine; nothing reaches the network.

Neither engine is bundled — shipping someone else's build inside this installer
is a licensing and signing question this project has not answered. Put a binary
and its model in the app's own folder and the app picks up whichever is there:

```
%APPDATA%\screenpet\whisper\whisper-cli.exe    + model.bin       (whisper)
%APPDATA%\screenpet\whisper\parakeet-cli.exe   + parakeet.bin    (parakeet)
```

Both binaries are in the same [whisper.cpp release](https://github.com/ggml-org/whisper.cpp/releases)
(`whisper-bin-x64.zip`, 7.9MB — copy the whole `Release` folder, the .dlls are
needed). Models: whisper's are on [Hugging Face](https://huggingface.co/ggerganov/whisper.cpp)
(`ggml-tiny.en.bin` 75MB, `ggml-base.en.bin` 142MB), parakeet's are at
[ggml-org/parakeet-GGUF](https://huggingface.co/ggml-org/parakeet-GGUF)
(`ggml-parakeet-tdt-0.6b-v3-q4_k.bin`, 397MB — note the **`.bin` from ggml-org**,
not the community GGUF conversions, which this binary rejects with
`invalid model data (bad magic)`). Rename to the name in the table above.

**Each engine has its own model name, and that is what picks the engine.** The
release ships both binaries in one folder, so "both `.exe`s present, one model"
is the ordinary case for anyone who copied the folder as instructed. Choosing on
the binary would hand a whisper model to parakeet and kill dictation for exactly
the people who followed the directions.

Which to install: **whisper `tiny.en` if you want this over with** — 75MB, and
with the prompt it beats bare `base.en` while being *faster than the PowerShell
spawn SAPI needs*. **Parakeet if accuracy on commands matters more than 397MB.**

The folder is fixed and there is no setting for it. A path to an executable in
`settings.json` is arbitrary code execution with a nice label on it, and this app
hardcodes its OCR script, its weather host and its provider URLs for that reason.

**The audio still never touches disk.** whisper-cli reads the WAV from stdin,
which costs one piece of arcana: with `-f -` it derives its output name from the
input name, ends up with `-`, decides that means stdout and silently prints
nothing. `-of` gives it a name to be quiet about. Removing that flag looks like
tidying and turns dictation off.

**Neither engine has a confidence score**, so the noise problem the `0.30` floor
exists for comes back in a different shape: handed two seconds of a quiet room,
whisper base.en answers "you". The gate is therefore in two places — the recorder
does not send audio it measured as silence, and a short list of known
hallucinations is dropped in [dictate.js](src/system/dictate.js). Both are measured, not
guessed. Parakeet returns nothing at all on silence and needs neither.

### Parakeet was measured too, and it is a tie

NVIDIA's Parakeet TDT overtook Whisper on the open ASR leaderboards in 2026, and
`parakeet-cli.exe` ships inside the same whisper.cpp release this app already
asks you to download. So it was run against the same fourteen recordings:

| | whisper base.en | +prompt | parakeet q4_k |
| --- | --- | --- | --- |
| commands | 33% | 23% | **10%** |
| technical | 87% | **29%** | 35% |
| chat | 0% | 0% | 0% |
| **all** | 49% | 21% | **19%** |
| median latency | 1564ms | 1564ms | **1110ms** |
| model on disk | 142MB | 142MB | 397MB |

**Two points apart on fourteen phrases is a tie**, so the decision is made on the
things that are structural rather than statistical:

- **Parakeet is better at commands and worse at technical words.** It heard
  `forget everything` correctly where whisper heard "Forward everything" — which
  in this app is a wrong word that fires a real skill. But it has no equivalent
  of the vocabulary prompt, so `git rebase onto main` came back as "Get rebassed
  on to main" where prompted whisper was exact.
- **Parakeet returns nothing on silence.** Whisper answers "you". A transducer
  emitting nothing is a better shape than a list of known hallucinations.
- **It is 2.8x the disk of base.en and 5x tiny.en**, for a tray pet.
- The widely quoted "27x faster than whisper.cpp" **did not reproduce here**: it
  was 1.4x, against base.en on this CPU. Those comparisons are generally against
  a larger whisper model than this app would ever load.

So both are supported, and the model file you install decides which runs. That
costs about twenty lines in [dictate.js](src/system/dictate.js) — the engines differ in an
argument list and a model name — and it beats picking a winner on a two-point
difference across fourteen phrases. Parakeet is preferred when both are properly
installed; whisper stays the one to reach for first, on size.

**Known limits.** One speaker, one room, fourteen phrases: this sizes an effect,
it does not measure a population. 21% is better, not solved — one word in five is
still wrong. `small.en` would likely close more of that at 465MB. Latency is the
CPU build; CUDA would cut it. And SAPI was measured through a WAV file rather
than live, so "the floor rejects everything" is strongly indicated rather than
proven — if a clear sentence still comes back as "I did not catch that", that is
the confirmation.

The harness that produced all of this is a recording booth, a WER scorer with its
own self-check, and a runner; it lives outside the repo because it needs a
microphone and 215MB of models to say anything.

## Skills

Some things a model should not be asked to do. These are matched in
[skills.js](src/core/skills.js) **before** anything reaches Ollama, so they are instant,
exact, and identical every time:

| Say | Get |
| --- | --- |
| `set a timer for 5 minutes`, `wake me in half an hour` | A timer, and it survives a restart. `remind me to stretch in 20 minutes` keeps the reason and says it back when it fires. |
| `what time is it`, `what day is it` | The clock, from your machine. |
| `battery?` | Level and whether it is charging. |
| `flip a coin`, `roll a d20` | A result, and a spin while you get it. |
| `rock` / `paper` / `scissors` | An actual game. It dances if it wins and falls over if it does not. |
| `dance`, `spin`, `jump`, `fall over`, `look around` | See "A body" below. |
| `sit`, `good boy`, `roll over`, `stretch`, `achoo`, `brrr` | The other five. `roll over` is the trick, `play dead` is the collapse. |
| `next track`, `pause the music`, `turn it up`, `mute the sound` | The keyboard's media keys. Whatever is already playing obeys. |
| `take a photo`, `say cheese` | One frame from the camera, into your Pictures folder. Needs the camera switched on. |
| `wake me every weekday at 7`, `remind me to stand up every 30 minutes` | A recurring alarm. Daily, weekdays, one weekday, or an interval. |
| `dance` | A dance, to whatever is actually playing if the microphone is on. |
| `what is the weather` | A refusal — unless you switched the weather on, in which case a forecast. |
| `look up the speed of light`, `who is ada lovelace` | A refusal — unless you switched web lookups on. See [Going outside](README.md#going-outside). |
| `remember my standup is at 9:30`, `forget everything` | See "What it remembers". |
| `flirt with me`, `tease me`, `roast me` | See "Banter" below. |
| `chatgpt is faster than you`, `sorry` | See "Jealousy, and the sulk" below. |
| `look smug`, `act cool`, `😎`, `make a face` | Any face on the keyboard, by name or by emoji. |

**A reminder is the one thing here that writes down your words.** "Remind me to
call the bank in an hour" has to survive a restart to be worth setting, and
surviving a restart means a file: `timers.json`, beside your settings, holding
the time and the sentence. It stays on your machine like everything else, it is
capped at 20 entries and 200 characters, control characters are flattened before
anything reaches a speech engine, and each line is deleted the moment it fires.
Reminders that came due while the app was closed are said once on the next
launch — unless they are more than two days old, at which point nobody wants to
hear about them. Every bit of that validation is in
[reminders.js](src/core/reminders.js), on the assumption that the file may have been
hand-edited or corrupted.

**Recurring alarms are four shapes and no more**: every day, every weekday, every
named weekday, or every N minutes. Anything expressible there is also expressible
in one sentence out loud, which is the test for whether it belongs in a pet — cron
syntax has no business here. The pet reads the rule back as `every weekday at
07:00`, because a bare "at 7" is read on a 24-hour clock rather than guessed at,
and the readback is how you catch a wrong guess when you set it rather than at
seven in the evening.

**Weather is matched deliberately in order to turn it down** — which is still
what happens with the setting off, and off is how it ships. Every weather source
is somebody else's server. Left unmatched entirely the model cheerfully invents a
forecast, which is worse than saying no. Web lookups work the same way and for
the same reason. See [Going outside](README.md#going-outside) for exactly what switching either on sends.

## Banter

```
flirt with me   -> I would defragment a hard drive for you
                   *goes pink*
I love you      -> you cannot just SAY that
tease me        -> the mouse pointer has been in the same place for eleven minutes
roast me        -> no notes. well. some notes. many notes.
you are useless -> rude, and accurate
```

Six line banks in [pet-state.js](src/core/pet-state.js), where the rest of the pet's voice
lives, so the banter skills point at a bank rather than carrying their own words
— which also means they pick up the per-species variations for free.

**All of it is asked for. None of it fires on its own.** A pet that starts
roasting you unprompted is a different product. The remarks that *are* unprompted
come from [memory.js](src/core/memory.js), are built from numbers it actually recorded,
and have their own switch.

Flirting is cheesy and wholesome, and there is a test asserting it stays that
way — this bank ships to strangers on a cartoon blob, and "keep it PG" is exactly
the kind of intention that survives right up until somebody adds one more line.
The same test checks every line fits a speech bubble, and that `I love this bug`,
`roast the coffee beans` and `how do I tease apart these two functions` all reach
the model instead of the banter.

Teasing is never about your work. The pet cannot see it well enough to have an
opinion worth having, and one that mocks code it half-read is just wrong with a
face on.

## Jealousy, and the sulk

```
chatgpt is faster than you -> and what does IT do that I do not      [😤]
sorry                      -> say it again. like you mean it         [🥺]
sorry                      -> you cannot speedrun this bit           [🙄]
...25 seconds later...
sorry, I mean it           -> fine. come here                        [🫠]
```

Name a rival and it takes offence; say sorry and it wants another one. How many
it wants lives in `pet.json` as a single number — `owed` — so it works with the
memory switched off, and so it survives a restart the way a mood should.

Three rules keep this a joke rather than a guilt trip, and all three are in
[pet-state.js](src/core/pet-state.js) with a test each:

- **One apology counts per 25 seconds.** Otherwise the whole bit is a three-word
  speedrun, and the pet is a button again.
- **It caps at four.** Clearing it should be funny, not a chore.
- **It forgives you on its own after six hours, whatever you do.** A pet that can
  be permanently broken by one sentence is a bug report, not a mood.

Forgiven means forgiven: the count goes to zero and nothing is kept to be cross
about later. Being poked until it cries owes two — that one *is* also remembered,
as a number, in [memory.js](src/core/memory.js), and the two are different things: the
grudge clears when you say sorry and the count never does.

**An apology has to be the whole message.** `sorry, what does this error mean` is
a politeness on the front of a real question, and a pet that ate it to sulk at
you would have cost you the answer. Same anchoring as every other command here,
and there is a test with four of these in it.

While there is an apology outstanding the pet sulks *quietly* — it spends its
small-talk slot on `I am still thinking about it` rather than adding a new
interruption, and that slot is throttled to one line per 45 minutes as it always
was. It never blocks an answer, never refuses to help, and never asks twice in a
row unprompted.

Rivals are a short, named list: ChatGPT, Copilot, Siri, Alexa, Cortana, Clippy.
Models you might genuinely have configured — Gemini, Mistral — are deliberately
*not* on it, because `what is mistral` is a question, and answering it with a
jealous quip would be the pet eating a real message.

## Being ignored

The pet counts the lines it says to you that you do not answer, and only ever
while you are actually at the machine — five minutes of system idle and it naps
instead, because talking to an empty room is not being ignored. A line dropped by
do not disturb is not counted either: it was never said, and holding a setting
you switched on against you would be inventing a grievance.

```
2 unanswered  -> you are busy. I know                       [😞]
4 unanswered  -> I am RIGHT HERE                            [😤]
6 unanswered  -> right. I will stop                         [😐]
then          -> (nothing at all)
you pat it    -> there you are. I had gone quiet            [🥳]
```

**The ladder ends in silence rather than in more nagging.** Past the last rung
both unprompted channels close — small talk *and* the hunger nag — and it says
nothing at all until you speak first. That is the honest reaction and it is also
the only version that cannot become a notification loop: a pet that escalates
forever gets uninstalled. Anything clears it — a message, a headpat, asking it to
read the screen — and coming back after it had noticed gets its own line.

**It never gets a channel of its own.** The ignored line takes whichever slot was
already coming due, so a pet being ignored talks exactly as often as one that is
not: 45 minutes between lines, as always. Being upset does not buy it more of
your attention.

Each unanswered line past the second costs a little happiness, so this is not
only a set of lines. Ignore it long enough and it genuinely drifts into the sad
mood, with the face and the slower bob that already go with it. Coming back gives
some of that straight back.

## Faces, by name or by emoji

Thirty-nine faces are drawn, and thirty-six of them can be asked for by name
or by emoji (the other three - the resting smile, the surprised `oh`, the
listening face - only ever arrive on their own):

```
look smug -> *smirks*                 😎 -> too cool for this taskbar
be shocked -> WHAT                    🥺 -> please?
act innocent -> who, me?              make a face -> (it picks one)
```

The list is one table — `FACES` in [pet-state.js](src/core/pet-state.js) — holding the
name, the emoji, the words people actually type for it, and what the pet says
while pulling it. [skills.js](src/core/skills.js) builds its matcher from that table, so
adding a face is one edit rather than four, and a test walks it to check every
entry has a rule in [style.css](src/renderer/style.css) *and* that every rule in the
stylesheet is reachable from something. A face drawn but unreachable is a block
of CSS nobody will ever see; a face reachable but undrawn is a pet that just
sits there.

Only two of them needed new SVG — the shades and the halo. Everything else is
the same rig moved around: lids lowered over the eyes for 😏, the glints blown up
and throbbing for 🤩, the bob removed entirely for 😐, the whole body rotated 180°
for 🙃. Both props are worn rather than drawn into a body, like the bow, so all
ten species get them without anyone redrawing anything ten times.

A face word inside a sentence is somebody talking: `that is cool` and `this looks
cool` reach the model, and an emoji only counts when the message is nothing but
emoji. Verbs are required — `be`, `look`, `act`, `make`, `give me` — because
"cool" typed at a pet usually means "nice".

**Music is one keypress, not an integration.** [media.ps1](src/system/media.ps1) taps a
single Windows media key — the same one on your keyboard — and whatever holds the
transport handles it: Spotify, a browser tab, the Groove app. Nothing comes back.
The pet cannot see a track name, an artist or even whether anything was playing,
which is exactly why it needs no account, no API key and no server. The only
codes it will press are `0xAD`–`0xB3`, the volume and transport block, checked
both in [media.js](src/system/media.js) and again in the script — this presses real keys on
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

Eleven whole-body movements, separate from the thirty-nine faces:

`walk` `dance` `spin` `jump` `topple` `peek`
`sit` `stretch` `roll` `sneeze` `shiver`

Each is one `@keyframes` block and one row in the renderer's `MOVE_MS`, and a
test asserts every movement a command can ask for has both, plus a rule in the
stylesheet and something to say. `roll` is the only one that turns about its own
middle rather than its feet — a roll pivoting on the floor is a pratfall, which
`topple` already is — and its shadow counter-rotates, or the pet appears to roll
in mid-air. `roll over` used to answer with `topple`: the trick and the collapse
were the same movement, and now they are not.

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

Nothing is stored, encoded, recognised or sent — with exactly two exceptions,
both of which need a setting switched on. `take a photo` keeps that single frame,
in your Pictures folder and nowhere else. And with "tell a face from a curtain"
on, one frame at the moment somebody arrives goes to Windows' own detector, which
answers with a count and never writes it down — see [Counting faces](#counting-faces). **Neither of them
can tell who you are**,
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
[settings.js](src/core/settings.js) as a pure function so the whole truth table is
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

## Which of your models

Nine installed models is an ordinary state, and eight of them are the wrong
answer — one is a vision model too small to read a page of text, one is a
fine-tune somebody made for writing fiction, and two are the same 12B at
different quantisations. Listing the names and leaving you to it is fair to
somebody who chose them on purpose and no help at all to anybody else.

So `advise.js` ranks them. The rules are about what the pet actually asks a
model to do:

| Rule | Because |
| --- | --- |
| at least 8k of context | A screen of OCR is a lot of prompt. Under that it is truncated before the model sees the bottom of the screen, which looks exactly like the model being stupid. |
| roughly 6.5B to 14B | Under it the answers are confident and wrong, which is worse than none on a tool whose whole job is answering about something you can see. Over it you wait, and you are waiting at the bubble. |
| reasoning preferred | It is what catches a screen that was only half read. The pet already switches thinking off for small talk and for timed reads, so the wait is charged only to the question you asked. |
| a vision model is not a candidate | Different job. It gets its own line. |

**And the measurement outranks all of it.** The model this app ships as its
default was picked by running eight of them against real screens, and it was
the only one that said so when OCR had mangled what it was asked about.
Everything in the table above is reasoning about a name and a size. Without an
explicit rule putting the benchmark first, the ranking cheerfully recommends
its way past the one number anybody actually took — on the strength of a
tool-calling flag for tools the pet does not call.

It suggests and stops there. The list marks one entry, a sentence under it says
why, and the setting does not move: a model is a taste as well as a
measurement, and an app that quietly repoints your pet at a different one is
worse than one that says what it thinks and leaves it alone.

## The voice it was given

`robot.js` is written about Microsoft David, and the first line of it says so.
Windows will speak a sentence but it will not hand over the audio, so the pet
was stuck with a voice that sounds like a train station — and the answer was to
make it sound like a robot on purpose, which is at least a decision. Five
effects, of which the ring modulator is the one doing the real work: it is what
a vocoder does to a voice, and it is unmistakably not a human throat.

Give the pet a Piper voice and the premise goes away. It already has a throat,
so the ring modulator comes off entirely — leaving it on would spend the whole
of what installing a voice bought. What stays is the part that was never about
the robot at all:

| | Windows | A voice you installed |
| --- | --- | --- |
| ring modulator | 0.3 of the signal | **none** |
| playback | 1.22× — synthesised slow, played fast, which raises the pitch without shortening the line | 1.12×, which does shorten it, and a small creature talking slightly quickly is the right way to be wrong |
| band | 170–5200 Hz | 140–7600 Hz |
| soft clip | 2.2 | 1.15 |
| case | 0.18 feedback | 0.10 |

The second column is a pet rather than a person: pitched up a little, and coming
out of something the size of a mug. That was always what the chain was for. The
robot was only ever how it was reached from the voice Windows gives you.

Which engine made the audio comes back with the audio, because nothing
downstream can tell by listening — and a chain picked by guessing would sooner
or later put a neural voice through a ring modulator, which is the one mistake
here that undoes a deliberate purchase rather than merely sounding wrong.

Nothing is bundled and nothing is downloaded. See [the README](README.md#giving-it-a-voice)
for where the files go and why the licences differ per voice.

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

**And opening the app is asking for it.** Five of the six states above are
quiet, and Windows 11 ships Do Not Disturb switched on for a full screen app —
so "not now" is the ordinary answer, not the rare one. A launch that obeys it
is a pet that never appears, with nothing on screen to say why, and the only
way out is a tray icon Windows has filed under *Show hidden icons*. So the
Start menu gets the rule the tray click has always had: it shows, and the
override lapses with the quiet spell rather than for good. Being started at
login is not you asking, and that one still keeps out of the way — the login
item is registered with `--hidden` so the two can be told apart.

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

## Stopping for water

Every fifty minutes the pet **has a thought**: a little bubble beside it holding
💧 or 🧘, alternating, because the two things worth stopping for are different —
water is somewhere to go, sitting still is something to do where you sit, and one
reminder repeated becomes wallpaper inside a day.

That thought is the whole of the interruption. It is the size of a coin, there
are no words in it, and **nothing happens unless you click it** — ignored, it
goes away by itself after forty-five seconds and the pet asks again later.

Click it and the pet takes the break, and you watch it:

- everything behind it **dims**
- it walks into the **middle of the screen**
- and then it either **sits and breathes**, eyes shut, a ring of calm going out
  from it — or it **drinks a glass of water**, and the glass is the clock: the
  number underneath is only there for people who want a number.

The drink is the fussiest thing in the app, because a glass of water is a thing
everybody has held and nobody has to think about to know is wrong. Three details
carry it, and each one was added after watching the version without it:

- **The level goes down because the pet drank, not because time passed.** The
  break is divided into a whole number of mouthfuls and the water drops during
  the tip, held steady between drinks. Draining it smoothly against the clock is
  a progress bar with a cup drawn on it, and reads as one.
- **The water does not tip with the glass.** It cancels the glass's rotation
  about the same corner and is clipped by it, so the surface stays horizontal
  and the water runs down into the lip — which is what water does, and what the
  first version did not do.
- **The glass goes up once and comes down when it is empty**, rather than
  shuttling back to the pet's side between mouthfuls and going on miming drinks
  out of nothing until the timer runs out.

Click anywhere on the dimmed screen to stop it early. The pet stays pattable
throughout, which is the entire reason the dimmed layer is *underneath* it.

Nobody is told to take a break. The pet takes one, and it is more persuasive than
a dialog telling you to, which is the thing that makes this worth building at
all.

Even so, the thought only appears when it should:

| It stays away when | Because |
| --- | --- |
| Windows says do not disturb — a game, a call, presentation mode | the same check the pet already passes before it speaks |
| an answer is being written | you asked for that, and it is on the screen |
| you are away from the machine | time away *is* the break, so the clock is pushed along rather than left running — five minutes in the kitchen must not be rewarded with a thought bubble the moment you sit back down |

The main process holds a backstop timer that undims the screen whatever the
renderer is doing, because a dimmed screen that never comes back is a fault
rather than a reminder. And **only a thought that is actually on screen can be
clicked into a break** — a renderer sending the message on its own gets nothing.

**Take a break now** is in the tray menu, and asking by hand skips the thought
and starts it. Both timings are settings, clamped to something survivable — no
closer together than five minutes, no longer than ten minutes on screen — because
a hand-edited `"breakEvery": 0` is a denial of service with a face on it.

Nothing about a break is recorded. There is no streak, no history and no count of
the ones you ignored: the file that would hold that is the whole of what anybody
would object to, so it does not exist.

## Where it stands

**Anywhere on the display, and never off it.** Pick the pet up and drop it where
you want it: a corner, the middle, against the top edge. The window is the whole
of one display's work area and the pet is a div inside it, clamped to that box,
so there is no gesture that can send it somewhere you cannot reach it. The work
area rather than the display, so it cannot go behind the taskbar either.

Placing it by hand makes that spot **home** rather than a peg. It wanders around
it — within a sixth of the room either side — and comes back to it every other
trip, because "stays where I put it" and "moves like it is alive" are both true
of a real pet and only the first was true of this one. Parking it used to stop it
moving at all, and the spot was restored from disk at launch, so a pet parked once
in March was still standing in exactly that place in June. Where you put it is
kept in `pet.json` as two fractions of the room available rather than as pixels,
so it comes back to the same place on a different resolution, and the same place
on the other monitor.

### Roaming, and sitting on your windows

With **Let it get into things** on — it is, by default — the pet stops treating
the bottom of the screen as the only place it is allowed to be. Three in ten
wanders go up the screen instead of along it, and it hops rather than walks when
there is nothing under it. Coming home means all the way home, off whatever it
climbed onto.

It also, a third of the times it notices you change windows, climbs up and sits
on the **top edge of the window you just switched to** — somewhere along that
edge rather than the same pixel every time, which is the difference between a pet
and a widget. Its own window ignores the mouse, so nothing it perches on stops
being clickable.

What it is told about that window is a **rectangle**. Not the title, not the
process, not the application — so it has no idea whether it just sat on a
spreadsheet or a game, and there is no version of this that does. It moves
itself and nothing else: it cannot close, minimise, move or touch a single one of
your windows, and it is not asking Windows for the ability.

Switching it off puts the pet back on the floor and stops it perching. Measured
rather than assumed — forty wanders from a parked pet stood at **eight** different
heights with the setting on, and at **one** with it off: the floor.

Near the top of the screen there is no room above the pet for a speech bubble, so
everything that normally sits above it - the bubble and the menu - **flips to
below it** instead. The anchor flips with it, bottom edge to top edge, and that
half is load-bearing: the stage grows away from whichever edge it is pinned to,
so without it the pet would jump every time it opened its mouth.

## Two monitors

Which display it stands on is up to you: **Move pet here** in the tray menu moves
it to whichever display the cursor is on.

Reading the screen does not wait to be told. `Ctrl+Shift+Space` captures the
display the **cursor** is on, not the primary one, because on two monitors the
question is almost always about the screen you are working on — and reading the
other one back is worse than useless, it is confidently wrong.

Unplugging a monitor with the pet standing on it used to leave the window running
somewhere that no longer existed. It now restages onto the nearest surviving
display, which covers a resolution change for free — and the pet inside is
re-placed by fraction rather than by pixel on the resize that follows, so a pet
parked halfway up a tall display arrives halfway up the short one instead of
somewhere off the bottom of it. `verify:ui` shrinks the window under a placed pet
and checks it is still on it.

## Conversations

Right-click → **Talk…** and type. No screenshot, no OCR: the model is told
plainly that it cannot see your screen, because otherwise a small model will
cheerfully invent what is on it — and if you ask it what you are looking at, it
says it cannot see rather than guessing. Same voice as above, plus two rules the
typed path needs on its own: lead with the answer rather than a sentence built
around it, and never open with a greeting or its own name. Both were what made
short replies sound like a form letter.

> **you:** I've been staring at this bug for three hours
> **pet:** Three hours? It should have given up and quit gracefully by now.

**Follow-up questions about the screen work.** Read the screen, then open Talk…
and ask "what about the second one?" — what it read is put in front of the model
along with the conversation. It is the redacted copy, capped at 700 characters,
held in this process only, replaced by the next screen read, and dropped after
five minutes: answering a follow-up about a screen you left ten minutes ago is
worse than admitting it does not know. `forget everything`, and switching memory
off, drop it immediately — a pet that says it forgot and then quotes your screen
back has not.

The prompt says one of two things and never both: it has just read your screen
and here is the text, or it cannot see your screen. A pet that says it cannot
see your screen one line after answering a question about it is worse than one
that never could.

The last three exchanges are kept for context **in memory only, never written to
disk**. A desktop pet that keeps a transcript of your evening in `userData` is a
liability, not a feature. It does remember things across sessions, but only the
ones you told it to — see "What it remembers".

The pet window is `focusable: false` so it can never steal focus from what you
are actually doing, which also means it cannot receive typing. Focus is granted
for exactly as long as the box is open and handed straight back.

State lives in `pet.json` in Electron's `userData` directory. It is validated on
load, so a corrupted or hand-edited file degrades to a fresh pet instead of
crashing.

That directory is the whole of what this app writes: `pet.json`,
`settings.json`, `timers.json` if you have set a reminder, and `memory.json` if
you have told it to remember something. Every one of them is validated the same
way on load, and none of them holds a transcript — conversation history is in
memory and dies with the process.

## What it remembers

The pet keeps something between sessions. This is the only feature here that
accumulates a file with your words in it, so the rules are narrow and stated
plainly.

**Your words are written down only when you say `remember`.** Nothing you type
at it, nothing it reads off your screen, nothing it hears and nothing it sees
ever reaches `memory.json`. There is no inference, no summarisation of your
chat, and no "learning from your conversations" — those three commands are the
entire write path.

```
remember my standup is at 9:30       -> Noted, and I will bring it up around 09:00
remember the cat is called biscuit   -> Noted: the cat is called biscuit
what do you remember                 -> the cat is called biscuit; my standup is at 9:30
forget the standup                   -> Forgetting anything about standup
forget everything                    -> Forgotten. All of it
```

A time in what you tell it becomes a routine, and the pet brings it up at that
hour — once a day at most. `remember to X in ten minutes` is a reminder rather
than a fact, and the timer skill takes it first.

Facts go through the same redaction that guards the model prompt, and the pet
reads back what it actually stored rather than what you typed:

```
remember my key is sk-abcdefghijklmnop1234
  -> Noted, with a bit taken out: my key is [REDACTED]
```

**Everything else it learns is a counter.** Which hour you tend to ask it
things, how many times you looked after it today, how many times a poking bout
went all the way to tears. Twenty-four integers per event and three events —
there are no words in that half of the file at all. It is enough for the pet to
say `21:00 again. 14 times now. we are both very predictable`, and not enough to
reconstruct anything you did.

Every line it volunteers is built from something recorded. It teases you with
your own numbers or it says nothing:

```
you gave me 9 of those on 2026-01-04. today: nothing. no notes
I still remember the 2 times you poked me until I cried
you were gone 7 days. I waited
30 days now. that is a real friendship, I think
```

At most one such remark every ninety minutes, it spends the small-talk slot
rather than adding a second one, and quiet hours silence it like everything
else. `Let it be cheeky about it` turns off the needling half and keeps the
rest.

When a fact shares a word with what you just typed, it is put in front of the
model — which is Ollama, on loopback. That is the only place a memory is ever
read out to anything.

**Off deletes it.** Unticking the setting removes `memory.json` rather than
pausing it, because a memory you can only pause is one that quietly keeps the
file, and the file is the whole of what anyone would object to.

Matching is shared words, not embeddings. It misses paraphrases and always
will; a vector index inside a desktop pet is not a trade worth making, and the
miss costs nothing — the model still answers, just without the reminder.

## How answering works

1. You press `Ctrl+Shift+Space`.
2. The pet asks Windows where the window you are working in is, hides itself, and
   grabs one frame of the display the cursor is on.
3. The frame is cropped to that window — see below.
4. Windows' built-in OCR (`Windows.Media.Ocr`) reads the text off it.
5. The text goes to a local model on `127.0.0.1:11434` via Ollama.
6. **The bubble fills in as the answer is written**, rather than after it.

### The window, not the wall

A 1536 pixel screen is your editor, a browser, a chat window and the taskbar,
and OCR hands the model all of it shredded into one column of text. So the
screenshot is cropped to the window you are actually in first.

What comes back from Windows is **a rectangle and nothing else** — not the
title, not the process, not the class. The pet crops a screenshot with it and
has no idea what it cropped. Same reasoning as the do-not-disturb check, which
asks for one integer rather than for a window list.

Cropping is refused, and the whole screen read instead, whenever it would not
help: a maximised window (nothing to gain, and a rounding error could cost an
edge), a window mostly on the other monitor, or one too small to hold a
question. Those judgements are in [window.js](src/system/window.js), separate
from the part that talks to Windows, so all of them are testable anywhere. Turn
it off in Settings and it reads the whole screen, which is what it always did.

macOS reads the whole screen: the API exists there, but it needs the Screen
Recording permission to say anything useful about another app's window, and
that is a second permission to explain in exchange for a crop.

### Filling in as it is written

The answer used to appear all at once after six to twelve seconds of a thinking
face. Ollama is asked to stream now, and the bubble fills as the words arrive.
It is not faster; it is completely different to wait for.

**The monologue never reaches the screen.** The default model is a reasoner: it
narrates its whole approach inside `<think>` before it answers. `stripThinking`
drops an unterminated block outright, so the bubble stays on the thinking face
through the reasoning and then fills with the answer. Measured on this machine,
`deepseek-r1:8b` asked what 17 × 23 is: first visible character at 5.3s, whole
answer by 5.5s. With a model that does not think first, text appears almost
immediately — and so does small talk, which asks the same model not to think at
all. See the model table below.

Two things are deliberately not applied to the pieces as they arrive: the quote
stripper and the echo stripper. Both are decisions about a whole answer, and a
line that vanishes halfway through being typed out reads as a bug. They run once
at the end.

The stream is throttled to about fifteen updates a second — the window cannot
draw faster than that, and the last piece is always sent, because a stream that
stops mid-word because the final token landed inside the throttle window is
exactly the bug this is meant to prevent. Hosted providers are not streamed;
they answer in one piece.

The screenshot is never written to disk. It is passed to OCR as bytes on stdin
and decoded from an in-memory stream. Nothing is stored — no history, no cache.

OCR is the OS's, not a bundled model, so there is no download and it runs fine on
a laptop with no GPU. That matters more than it sounds: a vision model would gate
the whole app behind 8GB of VRAM.

### Without being asked

**Read the screen without being asked** in Settings turns the hotkey into a
timer. Every minute — 20 seconds to 10 minutes, your choice — the pet reads the
screen on its own, and answers if it finds a question on it.

Off by default, and it stays off unless you go and switch it on. It is the only
thing in the app that reads your screen at a moment you did not pick, so
everything about it is built to be quiet:

- **It usually says nothing.** The prompt it gets is not the one the hotkey
  uses. It is told that nobody asked, that it may only speak if there is a
  question it can answer, and that the right answer most of the time is the
  single word `NOTHING`. That word never reaches the bubble — `ask()` turns it
  back into no answer at all, which is why this path is also the one that never
  streams.
- **It never answers the same screen twice.** Each read is compared with the
  last one by word set: if fewer than 35% of the words on screen are new, it
  does not go near the model. A clock ticking over, or a page scrolling a little,
  is the same screen. Switching windows is not. Comparing sets rather than
  characters is deliberate — OCR of one unchanged screen differs by a few glyphs
  every time, and re-flowed text is not new text.
- **It never uses the vision tier.** A screenshot cannot be redacted, vision on
  a CPU takes minutes rather than seconds, and "no text to read" is the most
  common screen there is — so watching would spend its life in the expensive
  tier on the screens least likely to hold a question.
- **A hosted model turns it off.** Reading your screen every minute and sending
  each read to a company is a different decision from doing it when you press a
  key, and nobody made that one. Choosing a provider switches this off in the
  same pass; a hand-edited settings file is refused a second time in `main.js`.
- **It stops when you are not there.** The same rules as the break reminders:
  nothing while Windows is set to do not disturb, nothing while an answer is
  already being written, and nothing at all once the machine has been idle for
  five minutes — with the clock pushed along while you are away, so sitting back
  down is not met with a read of the screen you left.
- **A failure is quiet.** Ollama not running would otherwise be a red bubble
  every minute; it goes to the console instead, and an answer identical to the
  last one is dropped rather than repeated.
- **An amber dot** sits on the pet for as long as the setting is on — the same
  idea as the green one for the camera, on the other side of its head and in
  another colour, because they mean different things and can be lit at once.

Nothing is written down. What it last read and what it last said about it live
in memory, are dropped the moment you switch the setting off, and never survive
a restart.

## The wake word

Off by default, and it needs "Let me talk to it" on as well, because it is the
same microphone.

**It holds that microphone open for as long as it is on.** That is what a wake
word costs and there is no version of it that does not. The honest mitigation is
not a promise, it is the shape of the thing doing the listening:

[wake.ps1](src/system/wake.ps1) loads a SAPI recogniser with a `Choices` grammar containing
exactly the wake phrases. This is not a transcriber that happens to be looking
for a word — it is **structurally incapable of recognising anything else**. Say
your card number in front of it and there is no code path that produces those
digits, because the only symbols in its grammar are "hey pet", "hello pet",
"okay pet" and "wake up pet".

The only line the process can print is `WAKE`. [wake.js](src/system/wake.js) drops anything
else rather than passing it on, so the single fact that crosses into the app is
*that you said it* — not what you said, not how confident it was.

It is the same local Windows engine dictation uses. No audio is recorded, buffered
or sent, and the process has no network access of any kind.

## Counting faces

Off by default, needs the camera, and answers exactly one question: **how many
faces are in this frame.**

It exists because motion cannot tell a person from a door. With it off the pet
greets a curtain; with it on it says "hm, nobody there" instead.

- It uses **Windows' own face detector** (`Windows.Media.FaceAnalysis`), which
  ships with Windows 10 and later — no model file, no download, no dependency.
- That API **has no identify, no compare and no embedding**. There is no call
  here that could tell one person from another even if this app wanted to.
- **Nothing is enrolled and no template is stored.** The pet cannot greet you by
  name because it does not know your name, and there is nothing on disk that
  could learn it.
- The frame goes to the detector **down a pipe**, is converted to `Gray8` — which
  throws the colour away before the detector ever sees it — and is gone when the
  process exits a second later. It is never written to disk.

Verified in both directions with drawn images, so that no real person was
photographed to prove a face detector detects faces:

```
flat grey field   -> 0 faces   (935ms)
crude flat doodle -> 0 faces
drawn face, 3 sizes -> 1, 1, 1 faces
```

...and through the real `main.js`, camera and all:

```
a face    -> "welcome back"
a curtain -> "hm. nobody there"
```

## A conversation

Push to talk is one phrase: you click *Listen…*, it hears one thing, it
answers, and you click again. **Keep listening after it answers** takes the
clicking-again out, which is most of the difference between an assistant and a
form with a microphone on it.

It is off by default, it needs the microphone switch, and — unlike the wake word
and bopping along — **it does not hold the microphone open**. It reopens it for
each turn and closes it in between. Nothing carries across a turn but the
intention to take another one.

Four separate ways out, because the failure that matters here is a microphone
nobody remembers leaving open:

| | |
| --- | --- |
| **You stop talking** | The first turn where nothing is said ends it, which is also how conversations end between people. It says goodbye rather than "I did not catch that" — you were not trying to say anything. |
| **Ten turns** | For the case where the first one never fires. |
| **Three minutes** | Same, on the clock instead of the count. Both are checked, or one of them is decoration. |
| **Anything else you do with it** | Feeding it or opening the chat box is not a lull in the conversation, it is the end of one. So is quitting, and so is switching either setting off mid-turn. |

### Turns do not overlap, and that costs an IPC message

The recorder asks for **raw capture** — echo cancellation, noise suppression and
automatic gain all off — because that is the audio the dictation benchmark was
run on. So a microphone opened while the pet is still speaking does not merely
hear the pet: it hears it clearly and transcribes it, and the conversation
starts answering itself.

So the next turn waits for the mouth to stop. The renderer says when, off the
same class-watching observer the blink track uses — watching the result rather
than calling from each of the seven places that stop speech, so none of them can
forget. Behind it is a timer, because a line that is never spoken out loud —
voice off, muted, or chirped rather than said — never reports having stopped.
Whichever arrives first wins.

One guard is worth naming: not every silence is a cue. The label that goes up
when the microphone opens is itself a line, and it finishes like any other. The
turn is only taken when one was actually armed.

### No barge-in

Talking over it needs the microphone open while the pet speaks, which needs echo
cancellation on, which is the one audio setting this app deliberately turns off.
Clicking the bubble already stops a line, and the pet's lines are two sentences.

The upgrade is a second capture stream with cancellation on, used for nothing
but deciding whether you have started talking — a real amount of work for a
three-second wait.

## Dancing

Asking the pet to `dance` opens the microphone **for the length of the dance**
— twenty seconds — and closes it. It listens for a beat and moves on it. The
"bop along to music" setting holds the microphone open instead, so it bops at
whatever is playing without being asked.

Both need "Let me talk to it", which is the same consent dictation and the wake
word run on, and which is what the permission gate actually checks.

What the beat detector gets is a spectrum forty times a second. What it keeps is
one number — how much energy is in the bottom eighth of it, which is where a
drum lives and where speech mostly does not. Nothing is buffered, recognised or
stored, and **the beat never crosses into the main process**: the pet moves in
the renderer, because nothing on the other side needs to know.

### And if it is you making the noise

The same spectrum answers a second question for free: whether that is a record
or whether it is you. The pet dances and says something nice when you sing at
it, and it works out that you are out of the bins it was already reading — no
second microphone, no second consent, and still nothing kept.

There is no pitch tracker in it, and there does not need to be. The difference
between singing and talking that is visible in a magnitude spectrum without one
is that **talking drops out and singing holds**: every consonant is a gap, a
spoken vowel rarely lasts a fifth of a second, and holding a note is the entire
point of a note. So: a tonal, voice-band sound, held for nearly a second, with
gaps under a fifth of a second forgiven because sung words have consonants too.

Three things fall out of that, and all three are the right way round:

- **humming counts**, which it should
- **a long "aaaah" counts**, which is close enough
- **a sustained church organ would count**, which is the honest ceiling. The
  upgrade is a pitch tracker watching for notes that *change*; it is a real
  amount of work, and nobody has yet been annoyed by an over-enthusiastic pet.

This is the one place the beat's rule is broken on purpose. A beat is a
movement and the main process has no use for it, so it never crosses. Singing
is answered with a *line*, and every line the pet says goes through one door in
the main process so the bank and the face cannot drift apart — which also means
quiet hours and a half-written answer both get to refuse it, in the one place
that already knows about either. What crosses is that it happened. Not the
words, not the tune, not a measurement of either.

Without a microphone the pet still dances when asked. It just dances to nothing,
which is what it always did.

## Why it is not slow any more

Two lines in [brain.js](src/core/brain.js), both found by measuring rather than guessing,
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

## Two pets

The feature is two people on one network getting two pets that know about each
other. The design problem is not the animation - the pet already has ten
movements and forty faces, and a second one on screen is a clone of an SVG. The
design problem is that this is the first thing in the app that opens a socket
nobody asked a question through, in an app whose entire proposition is that
nothing about your screen leaves the machine.

So the rule came first and the feature was built inside it: **the pets talk, the
people do not.**

### A channel that can only carry a mood cannot leak a screen

Nothing about the wire is a general-purpose transport. There is no message
envelope, no free-text field, no key-value bag, no pass-through of anything. A
message is one of three shapes, and every field in each of them is an enum from a
list this repository owns, a number clamped to 0-100, or the pet's name through
the same cleaner the pet's own name goes through.

That is not enforced by review, because review is a thing that stops happening.
`build()` in [playdate.js](src/core/playdate.js) starts from an empty object and
copies in only the keys in `FIELDS`, each through its own validator. Encoding
goes through it, so this process cannot leak a field by accident; decoding goes
through the same function, so a peer cannot introduce one. The test suite hands
it a message carrying screen text, a hostname, a username, an IP and an API key,
and asserts none of them appear in the bytes - in both directions.

The reason it is one function rather than two is that two would eventually
disagree, and the direction they would disagree in is the one that matters.

### No server, and no way to add one later by accident

There is no relay. Discovery and messaging are the same UDP multicast socket:
both copies join `239.255.42.99:41234`, each says what its pet is every three
seconds, and that is the whole of the mechanism. No account, no pairing code, no
infrastructure of mine in the middle, nothing to log and nothing to shut down.

The packets go out with `setMulticastTTL(1)`. A router that sees one decrements
the TTL to zero and drops it. "This cannot reach the internet" is therefore a
property of the packets rather than a sentence in a policy - and the test suite
reads every TTL in the file and fails on any that is not 1, which it does
because the first version of that check read the *comment* explaining the TTL
and passed happily while the code said 8.

The transport file is also asserted not to contain `http`, `fetch(`,
`net.connect` or `WebSocket`. If this feature ever grows a relay, it does not
grow one quietly.

### Why it is not under the internet switch

`Let it out on the internet` is the master switch for everything that reaches a
server. Playdates reach no server, and cannot leave the local segment. Putting
them behind that switch would mean turning the internet on for a feature that
cannot use it, which makes the master switch mean less rather than more. So this
is its own switch, off by default, and the settings window says in full what
crosses and who can hear it.

### Two pets in one document, which cost a rewrite

The pet's species, palette and outfit used to live on `<html>` - one pet, one
document, so the root was as good a place as any. A second pet made that wrong
in a way that would not have shown up until two people actually tried it: both
pets would have read the same root and worn the same species, and every test
would have passed.

They live on the pet element now, and the nineteen rules in `pets.css` shaped
like `[data-pet="cat"] .pet.is-idling` became `.pet[data-pet="cat"].is-idling`.
The friend is a `.pet` with its own attributes, so every mood, face, species and
movement applies to it unchanged and a new one is new for both. Its SVG is
cloned from the pet at startup rather than written out twice, for the same
reason.

The check that would have caught the old arrangement is in `verify-ui.js`: it
renders both pets and asserts the computed `fill` of their bodies differs.

### The confetti is once per friend, ever

The first time two pets meet is the moment worth decorating, and the fiftieth is
not. `friends.json` holds a random id for this install and the ids of up to 24
pets it has met, with a date and a count each - no names, no addresses, no record
of when anyone was online. `meet()` returns whether this is the first time, and
the confetti is on that latch rather than on arrival.

The id is random and derived from nothing about the machine: not the hostname,
not a MAC address, not the user's name. It exists so two pets can be told apart
and so the party happens once. It is the only stable thing about you a peer ever
sees, and `newId()` takes its randomness as an argument so the test suite can
prove it is not derived from anything else.

### Both pets do the same thing at the same time

A shared activity is one verb on the wire. Both ends map it to a movement, a face
and a line of speech - and the lines are different on the two machines, because
the words are not on the wire and each pet says something of its own about the
same act. One pet dancing while the other watches would be the bug; the check for
it is that every verb in `ACTS` has lines in `pet-state.js`, a face in
`EXPRESSIONS`, a movement in `main.js` that exists in the renderer's `MOVE_MS`,
and something to throw in the air in `friend.js`. A verb missing any of those
fails the suite.

Our own half goes out through `talk()`, the same door as everything else the pet
says off its own bat. That is deliberate: do not disturb silences our half of a
playdate on exactly the rule it silences the hunger nag, rather than this feature
having a quiet-hours rule of its own to get wrong.

### A friend in another city, without becoming somebody's infrastructure

Multicast with a TTL of 1 is a guarantee, and the price of a guarantee that
strong is that it also rules out the thing a lot of people will want next: a
friend who is not in the building.

The three ways to have that are a relay, a rendezvous server, and an address you
were given. The first two are the same answer wearing different hats - both mean
a machine of mine in the middle that sees every IP address and every pairing,
which is precisely the thing the front page of this project says does not exist.
A dancing cartoon animal is not worth becoming a piece of infrastructure over,
and "it only does signalling" is how every one of those starts.

So: an address list. The user types where their friend is, the socket sends there
as well, and screenpet learns nothing about how that address came to work. In
practice it will usually be a personal mesh - Tailscale, ZeroTier, WireGuard,
free at this size - and the deliberate decision is that the app does not know,
check, require or mention any of them beyond a sentence of advice. It sends UDP
to a string. Somebody who port-forwards gets the same feature; somebody who
invents a fourth way in 2029 gets it too.

Three things make this cost less than it looks:

**The LAN guarantee is untouched.** `setMulticastTTL` and `setTTL` are separate
options on the same socket, so group packets still die at the first router
whatever the unicast one says. The far path was added without weakening the near
one - which is worth noting because the obvious implementation, raising the one
TTL there was, would have quietly converted the whole feature's guarantee into a
policy.

**Empty means empty.** The unicast TTL is raised only while the list has
something in it. With nobody named, `setTTL(1)` too, so "no packet this socket
can emit leaves the segment" is true of *every* packet rather than most of them.
It changes no behaviour - with an empty list there is no unicast send to have a
hop limit - and it makes the claim checkable instead of argued.

**The list is symmetrical.** It decides who we send to *and* who we will read
from, so the people you can play with are exactly the people who can play with
you. That half closed a hole older than the feature: the socket binds `0.0.0.0`
and therefore receives unicast as well as its group, so before the list existed
anything that could reach port 41234 had its message parsed by the allowlist.
Nothing leaked - the allowlist held - but a stranger could put a pet on your
desk, and could fill the throttle table, which is why the check runs before that
table is written to rather than after.

What the address costs is the part no allowlist can help with, so the settings
window says it in full rather than in a footnote. The far end learns your IP,
which is roughly your city, and it learns when your machine is on, because a
beacon every three seconds is exactly that log. Neither is in the message.
Neither can be taken out of it. They are properties of having sent a packet at
all, and the honest thing to do with a cost you cannot remove is to name it
before somebody opts in rather than after.

Hostnames are refused, which reads as pointless strictness and is not. Accepting
`friend.example.com` would put the names of everybody you play with into a DNS
query - the one thing in this feature that would leave the machine without
anybody having chosen to send it. Leading zeros are refused for a smaller
reason and the same shape of one: `0177.0.0.1` is 127.0.0.1 to a parser that
reads octal and something else to one that does not, and an allowlist entry that
means two things depending on who reads it is not an allowlist entry.

### One message, two routes

The first thing anybody will do is add the address of a machine on their own
network, because that is how you test whether you typed it right. That machine
is then reached twice - once through the group, once directly - and the two
copies arrive from two different source addresses, so the throttle, which is
keyed on the address, lets both through and the pet does the activity twice.

The symptom is a stutter. The cause is that one message is being counted as two,
so the fix is keyed on the payload rather than on either address, and windowed
rather than remembered: two copies of one packet land milliseconds apart, while a
real repeat is a beacon three seconds later or a button press held off for two.

This was not found by a test. It was found by opening the socket and looking at
what arrived, which was two things.

### What was left out

- **Pairing.** There is nothing worth guarding in a message that can only be a
  mood, and a pairing code is a feature that has to be explained. The cost is
  that anyone on the network can join in, which PRIVACY.md says plainly. An
  address in the far list is closer to pairing than the LAN path has - you chose
  them and only they can reach you - but it authenticates an address, not a
  person, and anybody who can send from that address inherits it.
- **Reliability.** UDP, no retries, no ordering. A dropped verb is a missed
  dance. Three missed beacons and the friend walks off, so one lost packet does
  not make a pet vanish.
- **Sending on every interface.** A Windows laptop has five, and membership is
  joined on all of them so the pets are *heard*; sending still goes out of
  whichever one the OS prefers. A machine whose default route is a VPN can hear
  the pets on the LAN without being heard back. Marked in `lan.js` and worth
  fixing when somebody reports it, not before.
