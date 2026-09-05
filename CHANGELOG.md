# Changelog

Two documents promise this file exists. [PRIVACY.md](PRIVACY.md) says a change
that widens what leaves your machine is announced in the release notes for the
version that introduces it, and [SECURITY.md](SECURITY.md) says a reporter is
credited in them. Those notes are here.

Versions are [semantic](https://semver.org/spec/v2.0.0.html). Dates are the day
the version was tagged.

## [0.1.0] — unreleased

The first release. Everything in the repository is part of it, so there is no
list of changes against a previous version — there is no previous version.
What the app does is [README.md](README.md); why it behaves the way it does is
[DESIGN.md](DESIGN.md). The short form:

- A desktop pet that reads the screen with local OCR and answers with a local
  Ollama model. The screen text never leaves the machine.
- The care loop: ten pets, ten skins, a wardrobe, hunger, sleep, wandering,
  petting, moods and mischief.
- Timers, breaks, memory, skills, a voice, and dictation.
- Two answering tiers, a settings window, and a Windows installer.
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
