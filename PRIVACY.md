# Privacy Policy

**screenpet** · version 0.1.0 · effective 14 August 2026

## The short version

screenpet reads your screen and answers what is on it using a model running on
your own computer. There is no screenpet account, no screenpet server, and no
screenpet analytics. **We collect nothing, because there is nowhere for it to
go.**

On default settings the only network socket the app opens is to `127.0.0.1` —
your own machine. You can prove that without reading any code: block the app in
Windows Defender Firewall and use it. Everything still works.

Three settings can change that, and each one is off until you turn it on. They
are listed in [What can leave this computer](#what-can-leave-this-computer).

## Who this policy is from

screenpet is published by Omkar Palika ("we", "us").

Because the app has no server component, we are not a data controller for
anything you do in it — the files it writes are yours, on your disk, under your
account. This policy exists to describe what the software does with your data,
not to describe data we hold about you, because we hold none.

Questions: palikaomkar@gmail.com

## What we collect

Nothing.

Specifically, screenpet contains no analytics SDK, no telemetry, no crash
reporter, no advertising identifier, no licence check, no "phone home" on
launch, and no automatic update check. There is no code in the app that sends
anything to us, and there is no server to send it to.

## What the app reads on your computer

| Source | When | Where it goes |
| --- | --- | --- |
| Your screen | Only when you press the hotkey or ask the pet to look | Windows OCR on this machine, then the local model |
| A screenshot image | Only on the vision tier, when OCR finds too little text to work with | The local model only. **Never sent to a hosted provider** — an image cannot be redacted the way text can |
| Microphone | Only with `Let me talk to it` on, and only while a phrase is being spoken | A recogniser on this machine: Windows' own, or whisper.cpp / Parakeet if you installed one. None of them reach the network, and with a local engine the audio is piped to it and never written to disk |
| Camera | Only with the camera setting on | Answers "did anything move" and "is there a face" — never *whose* face. The Windows API used has no identify, no compare and no face embedding |

Screen captures and camera frames are held in memory for the length of one
request and are never written to disk — with one exception you trigger by hand:
asking the pet to take a photo saves a JPEG to `Pictures\screenpet\`, and tells
you the filename it used.

## What is stored on your computer

All of it under `%APPDATA%\screenpet\`, readable and deletable by you at any
time:

| File | What is in it |
| --- | --- |
| `settings.json` | Your settings. Never a key |
| `pet.json` | The pet's own state — mood, hunger, how long you have known each other |
| `memory.json` | Only what you explicitly said "remember ..." about, plus counters. See below |
| `timers.json` | Timers and reminders you set |
| `keys.json` | API keys for a hosted provider, if you chose one — wrapped with Windows DPAPI under your user account |

**Nothing typed at the pet, read off your screen, heard through the microphone
or seen through the camera is ever written to `memory.json`.** Conversation
history lives in memory for the session and is gone when the app closes. What the
pet learns beyond your explicit notes is counters — "you ask things around 9pm"
is six numbers in a bucket, not a sentence you said. Memory is redacted on the
way in by the same patterns that guard the model prompt, capped at 40 notes,
emptied by "forget everything", and deleted outright if you switch the memory
setting off.

To remove everything screenpet has ever stored: uninstall it and delete
`%APPDATA%\screenpet\`.

## What can leave this computer

`Let it out on the internet` is off by default, and off is the point of the app.
While it is off, every networked feature answers honestly that it cannot go out.

Turning it on **sends nothing by itself**. It unlocks three settings, each with
its own switch, each off until you turn it on. Turning the master switch back off
turns all three off in the same pass.

| Setting | What leaves | Who receives it |
| --- | --- | --- |
| Weather | A town name you typed into Settings, and coordinates rounded to about 1 km | open-meteo.com |
| Look things up | The words you typed after `look up`, cleaned and redacted, capped at 120 characters | DuckDuckGo, Wikipedia |
| A hosted model | **The text read off your screen**, redacted — and your typed messages | Whichever company you selected |

Notes that matter:

- The app never asks Windows, or anyone else, where you are. The weather is
  based on a town name you typed and can lie about.
- The weather and lookup services need no account and no key, so nothing ties
  either request to you. No cookies, no device identifier, no login.
- The destination hosts are hardcoded. Nothing in a settings file, and nothing a
  model or a skill produces, can point them somewhere else.
- **Choosing a hosted model is a different order of decision from the other
  two**, and the app says so where you make it. It means the text read off your
  screen is sent to that company, and their privacy policy governs it from that
  point, not this one. It requires three deliberate acts: the master switch, the
  provider, and a stored key.
- Screenshots are never sent to a hosted provider under any setting.

## Redaction, and what it does not promise

Before screen text reaches any model, it is scanned for things shaped like
secrets — API keys, GitHub tokens, AWS key IDs, JWTs, long hex blobs,
card-shaped digit runs, and `password:`-style assignments — and those are
replaced with `[REDACTED]`.

**This is a coarse net, not a guarantee.** It catches the shapes it knows. It
cannot know that the paragraph on your screen is confidential. On the default
local setup that matters less, because the text crosses to loopback and no
further. It matters a great deal if you have selected a hosted provider, and it
is the reason the default is a model that runs on your own machine.

## Your API keys

If you choose a hosted provider, its key is wrapped with Windows DPAPI under
your user account and written to `keys.json` — never to `settings.json`, which
the settings window round-trips through the renderer process. The key is never
shown back to you, never written to a log, never put on a command line, never
placed in a URL, and never included in an error message. The settings window can
set a key and clear a key; there is no channel that returns one.

## Children

screenpet is not directed at children and collects no information from anyone,
of any age.

## Your rights

Because we hold no data about you, there is nothing for us to disclose, correct,
export or erase. Everything the app stores is a file on your own disk: you can
read it in Notepad, and deleting `%APPDATA%\screenpet\` erases all of it.

If you have selected a hosted model provider, requests about data that company
received go to that company under their policy.

## Security

The app runs the renderer with context isolation and a preload bridge, denies
every browser permission by default and allows exactly one — the camera and
microphone you switched on — and restricts the local model endpoint to loopback
addresses only, so a hand-edited settings file cannot quietly turn the privacy
claim into a lie.

To report a vulnerability, see [SECURITY.md](SECURITY.md).

## Verify any of this yourself

Do not take it on trust. Block screenpet's outbound access in Windows Defender
Firewall and use it on default settings: reading the screen, answering,
speaking, listening, the camera, reminders and memory all still work, because
none of them need the network. Turn the internet switch on and the firewall
becomes the thing that shows you exactly what each unlocked setting was for.

## Changes

If this policy changes, the effective date at the top changes with it, and the
previous version stays in the project's git history. A change that widens what
leaves your machine will also be announced in the release notes for the version
that introduces it.
