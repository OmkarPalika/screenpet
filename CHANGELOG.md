# Changelog

Two documents promise this file exists. [PRIVACY.md](PRIVACY.md) says a change
that widens what leaves your machine is announced in the release notes for the
version that introduces it, and [SECURITY.md](SECURITY.md) says a reporter is
credited in them. Those notes are here.

Versions are [semantic](https://semver.org/spec/v2.0.0.html). Dates are the day
the version was tagged.

## [Unreleased]

### Added

- **Playdates.** Two copies of screenpet on the same network find each other and
  the two pets meet: confetti the first time, and after that they wave, bounce,
  dance, cheer, hug, spin, share a snack, sing and sit about together. Off by
  default, with its own switch in Settings.

  This is the first thing in the app that opens a socket nobody asked a question
  through, so, as [PRIVACY.md](PRIVACY.md#pets-on-your-own-network) now says at
  length: **the pets talk, the people do not.** A message is a species, a
  palette, a hat, the name you gave your pet, a mood word, a bond number and one
  verb from a list of ten. There is no free-text field and nowhere to put one.
  Every message is rebuilt field by field from a fixed table on the way out and
  on the way in, so a field that is not in the table cannot survive the trip in
  either direction.

  There is no server, no relay, no account and no pairing code. It is a UDP
  multicast group sent with a hop limit of one, which the first router drops —
  so it cannot leave the network segment your machine is on. Two things this
  widens, said plainly rather than buried: the name you gave your pet is
  readable by anyone on that network running the app, and anyone on that network
  can join in, because there is nothing worth guarding in a message that can
  only be a mood.

- `friends.json`: a random id for this install and the ids of up to 24 pets it
  has met, so the confetti happens once per friend rather than every time. No
  names, no addresses, no record of when anyone was online. Only written while
  playdates are on.

### Changed

- The pet's species, palette and outfit moved from the `<html>` element to the
  pet element itself, and the nineteen `[data-pet="…"] .pet.is-idling` rules in
  `pets.css` became `.pet[data-pet="…"].is-idling`. Two pets in one document
  cannot both read their look off the root. No visible change on its own.

## [0.1.0] — 2026-09-05

The first release. Everything in the repository is part of it, so there is no
list of changes against a previous version — there is no previous version.
What the app does is [README.md](README.md); why it behaves the way it does is
[DESIGN.md](DESIGN.md). The short form:

- A desktop pet that reads the screen with local OCR and answers with a local
  Ollama model. The screen text never leaves the machine.
- The care loop: ten pets, ten skins, a wardrobe, hunger, sleep, wandering,
  petting, moods and mischief. Sing at it while it is bopping along and it
  dances and says something nice, worked out from the spectrum it was already
  listening to rather than from anything new being opened or kept.
- A name, if you give it one. Up to 24 characters in any script; the pet
  answers to it, and says one line when you first choose it.
- A house. The pet walks out of it when the app starts and back into it when
  you quit, rather than appearing and vanishing.
- Talking to it can be a conversation rather than a click per sentence: it
  answers, then listens again, and stops on the first turn where you say
  nothing. Off by default, and it never holds the microphone open.
- Timers, breaks, memory, skills, a voice, and dictation. The voice is a
  Windows one by default; drop a Piper binary and a voice model in a folder
  and the pet speaks with that instead, still entirely on your machine.
- Two answering tiers, a settings window, and a Windows installer. The settings
  window ranks the models you already have and says which one it would use, and
  why, rather than listing nine names and leaving you to guess.
- A `Download and install` button that replaces the app without the setup
  wizard.

The pet runs with no model installed at all — it wanders, naps, eats, is
petted, wears hats, sets timers and pulls faces without Ollama anywhere.
Reading the screen is the one thing gated on a model, and until one is there
the pet says so in its own words rather than showing a failed request.

### Security

- On the default settings nothing leaves the machine: no screen text, no
  image, no telemetry, and the only socket opened is to loopback. Blocking the
  app in Windows Defender Firewall changes nothing about how it works, which is
  how to check the claim from outside the code. The internet switch and a
  hosted provider are opt-in and off.
- The update feed is baked in at build time and nothing in the settings can
  redirect it. This is the one path in the app that downloads an executable
  and then runs it, so a field pointing it elsewhere would be arbitrary code
  execution.
- **The binaries are not signed.** The download is checked against a hash
  served from the same release as the installer, so the trust boundary is the
  GitHub account rather than the binary itself, and Windows SmartScreen will
  warn on first run. [SECURITY.md](SECURITY.md) has the detail.
- `electron-updater` puts sixteen packages inside `app.asar`, two of them
  under licences that require their notice to travel with the software. All
  sixteen are credited in
  [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md), and a test fails if a
  seventeenth arrives without a row.
