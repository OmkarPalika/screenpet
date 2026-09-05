# Changelog

Two documents promise this file exists. [PRIVACY.md](PRIVACY.md) says a change
that widens what leaves your machine is announced in the release notes for the
version that introduces it, and [SECURITY.md](SECURITY.md) says a reporter is
credited in them. Those notes are here.

Versions are [semantic](https://semver.org/spec/v2.0.0.html). Dates are the day
the version was tagged.

## Unreleased

### Added

- The pet runs with no model installed at all. It wanders, naps, eats, is
  petted, wears hats, sets timers and pulls faces without Ollama anywhere;
  reading the screen is the one thing gated on a model, and until one is there
  the pet says so in its own words instead of showing a failed request.
- A `ci` workflow running the unit tests on every push and pull request.
- `DESIGN.md` — the behaviour and the measurements behind it, moved out of the
  README so that installing the app does not mean scrolling past two thousand
  lines first.

### Fixed

- A model that could not be reached returned its error as though it were an
  answer, so `npm run smoke` exited 0 with Ollama switched off and the pet
  spoke a failure in the voice it uses for facts. All four failure paths now
  throw.
- `npm run verify:ui` failed roughly one run in five, in two unrelated ways:
  `capturePage` dropping the first frame a window ever composites, and a
  randomised check that drew too few samples to tell a real regression from a
  bad afternoon.
- `npm run doctor` said the pet "cannot think" without Ollama, which stopped
  being true with the change above.

### Security

- Nothing new leaves the machine. This release changes no network behaviour.
- [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) said the app had no runtime
  dependencies. Adding the update button in 0.1.1 put sixteen packages inside
  `app.asar`, two of them under licences that require their notice to travel
  with the software. All sixteen are now credited, and a test fails if a
  seventeenth arrives without a row.
- [SECURITY.md](SECURITY.md) never described the update channel, which is the
  one path in the app that downloads an executable and then runs it. It now
  states where the feed comes from, that nothing may redirect it, and what
  being unsigned actually costs: the download is checked against a hash served
  from the same release as the installer, so the trust boundary is the GitHub
  account rather than the binary.
- [PRIVACY.md](PRIVACY.md) said everything stored is in one folder. Pressing
  `Download and install` writes the installer to `%LOCALAPPDATA%\screenpet-updater\`,
  which is now documented along with how to remove it.
- Two advisories cleared in build-only dependencies: `fast-uri` (four SSRF and
  host-confusion issues) and `@xmldom/xmldom`. Neither ships in the app.

## [0.1.2] — 2026-09-03

A version bump and nothing else. Tagged to exercise the release flow.

## [0.1.1] — 2026-09-03

The first tagged build, and everything up to it — the care loop, ten pets, ten
skins, the wardrobe, the voice, dictation, the skills, memory, breaks, the two
answering tiers, the settings window, the Windows installer, and the button
that replaces the app without the setup wizard. The commit history before this
tag is the detail.
