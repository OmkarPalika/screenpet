# Contributing to screenpet

Bug reports, ideas and patches are all welcome. Read this first — the licence
section is short but it matters, and the privacy rule below is not negotiable.

## The one rule that outranks everything

**On the default settings, nothing leaves the machine.** Not screen text, not
images, not telemetry, not crash reports, not a version ping. The only socket
the app opens by default is to loopback.

A change that widens that is not a small change. It needs a switch that is off
out of the box, a row in [PRIVACY.md](PRIVACY.md) saying exactly what is sent
and to whom, a line in [CHANGELOG.md](CHANGELOG.md), and a test. A pull request
that adds an unconditional network call will be closed, however good the
feature is.

If you are unsure whether something crosses that line, open an issue and ask
before writing it.

## Before you open a pull request

```bash
npm test
```

`test/test.js` imports nothing outside Node's standard library and runs in about
two seconds, so there is no excuse for skipping it. CI runs the same command.

If you touched the interface, also run:

```bash
npm run verify:ui
```

It launches real Electron windows and screenshots them, so it needs a desktop —
which is why it is not in CI. Look at the images it writes.

Several tests exist only to catch documentation drifting away from the code: the
README's feature counts, the changelog having a section for the current version,
[PRIVACY.md](PRIVACY.md) listing every file the app writes, and
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) crediting every package that
ships. If one of those fails, the documentation is what is wrong, not the test.

## What a good pull request looks like

- **One thing.** A fix and a refactor in the same branch is two reviews.
- **A commit message that says why.** What changed is in the diff. Why it needed
  to is not, and that is the half a reader six months from now actually needs.
- **A test that fails without your change.** Break your own fix and watch the
  test go red before you trust it. Every check in this repository was added that
  way.
- **Matching the surrounding code.** No new dependency for something a few lines
  of standard library can do — the app ships exactly one runtime dependency and
  that number is deliberate.

## Reporting bugs

Use the bug template. The single most useful thing you can attach is the output
of:

```bash
npm run doctor
```

It reports what your machine can and cannot do, which is usually the answer.

**Never paste a screenshot showing your own screen contents, an API key, or
anything from a private window.** The app redacts secrets before they reach a
model; an issue tracker does not redact anything.

## Security bugs do not go in the issue tracker

See [SECURITY.md](SECURITY.md). Email instead, and you will be credited in the
release notes.

## Licence

screenpet is [MIT](LICENSE). Use it, change it, redistribute it, sell something
built on it — keep the copyright notice and you are fine.

By opening a pull request you agree that you wrote the contribution or have the
right to submit it, and that you licence it under the same MIT terms. That is
the whole agreement; there is no separate copyright assignment and no
contributor licence agreement to sign.

It used to be PolyForm Noncommercial with a commercial tier. That was dropped in
favour of MIT so the project could qualify for free code signing from the
[SignPath Foundation](https://signpath.org/terms), which requires an
OSI-approved licence with no commercial dual-licensing. An unsigned Windows
download is a SmartScreen warning, and a warning costs more users than a
commercial tier would ever have earned.

The licences of the things screenpet talks to are a different question, and some
of them are stricter — see [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)
before you ship anything built on this.

If that is not acceptable to you, say so in the pull request rather than
withdrawing it. A description of the bug and how to fix it is still worth having
and costs you nothing.

## Behaviour

[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). It is short.
