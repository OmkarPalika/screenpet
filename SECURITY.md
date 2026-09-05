# Security Policy

## Reporting a vulnerability

Email palikaomkar@gmail.com with the words "screenpet security" in the subject.
Please include what you found, how to reproduce it, and what an attacker gets
out of it.

Please do not open a public issue for anything that would put existing users at
risk before there is a fix.

This is a one-person project, so: expect an acknowledgement within a week, and a
fix or a plain explanation of why not within thirty days. If a fix ships, you
are credited in the release notes unless you would rather not be.

Supported version: the most recent release. There are no backported fixes for
older ones.

## What this app is guarding

screenpet reads the screen and can hold a microphone, a camera and an API key.
The design rules that follow from that are the things worth testing:

- **Nothing leaves the machine on default settings.** The only socket opened is
  to loopback. If you find a way to make a default install talk to anything else,
  that is the highest-severity bug in this app.
- **Destination hosts are hardcoded.** The weather service, the lookup services
  and every model provider URL are constants in the source. Nothing in
  `settings.json`, and nothing a model or a skill can produce, may point them at
  another host. A path traversal through a model name, a settings field that
  becomes a URL, or a redirect that lands off-host all count.
- **The update feed is baked in at build time.** `app-update.yml` inside the
  installed app names this repository's releases, written from the `publish`
  block at package time. Nothing in `settings.json` and no environment variable
  can change it, deliberately: this is the one path in the app that downloads an
  executable and then runs it, so a field that redirects it is arbitrary code
  execution. Nothing checks on a timer, nothing downloads until the second
  button is pressed, and the request that goes out carries no settings, no
  screen, no memory, no account and no identifier. A way to make the updater
  fetch from another host, or to make it run anything it did not verify, is the
  highest-severity bug in this app after a default install reaching the
  internet.
- **The local endpoint is loopback-only**, validated in `src/core/settings.js`. A
  hand-edited settings file must not be able to send screen text to a remote
  "Ollama".
- **API keys are one-way.** A key is wrapped - DPAPI on Windows, AES-GCM under a
  Keychain-held key on macOS - stored in `keys.json`, and never returned to the renderer, a log line, an error message,
  a command line or a URL. Any path that reads one back out is a vulnerability.
- **Screenshots never reach a hosted provider.** An image cannot be redacted, so
  the vision tier is local-only, locked in two places.
- **Devices stay shut unless a literal `true` says otherwise.** Camera,
  microphone, wake word and beat detection each require their own explicit
  setting; the Electron permission handler denies everything and then allows
  exactly the one device you switched on.
- **The renderer is not trusted.** Context isolation is on, node integration is
  off, and everything crosses a preload bridge. IPC input that reaches a
  PowerShell spawn, the filesystem, or a URL is worth attacking.
- **Error text is user-visible.** Anything that puts a key, a prompt, or a
  provider's raw response body into a speech bubble is a leak.

## Known limits, already documented

These are stated in the README and the Privacy Policy, so they are not
vulnerabilities — but a way to *widen* one is:

- **Redaction is a coarse net.** `SECRET_PATTERNS` in `src/core/brain.js` catches shapes
  it knows — keys, tokens, JWTs, card-like digit runs, `password:` assignments.
  It cannot know that a paragraph is confidential. A pattern that misfires or
  can be trivially evaded is worth reporting; the fact that the net is coarse is
  by design and is documented as such.
- **Choosing a hosted provider sends screen text to that company.** That is the
  documented trade, behind three deliberate switches. Making it happen without
  all three is a vulnerability.
- **Anything on screen is fair game to the local model.** That is the feature.
- **Builds are unsigned** until there is a code-signing certificate, so
  SmartScreen will warn. Verify what you downloaded against the hash published
  with the release. It weakens the updater too, and this is worth stating
  plainly: electron-updater checks the download's sha512 against `latest.yml`,
  but with nothing signed there is no publisher check on top of that, and
  `latest.yml` is served from the same release as the installer it vouches for.
  So the trust boundary is the GitHub account, not the binary - anyone who can
  publish a release can hand every running copy something it will execute.
  A certificate is what closes that, and there is not one yet.
- **Local dictation runs a binary you supplied.** If a known engine binary and
  its matching model are present in the `whisper` folder inside the app data
  directory, the app executes that binary. Only the filenames in `src/system/dictate.js`'s `ENGINES` table are
  ever run, the folder is fixed, and there is no setting that can point it
  elsewhere — deliberately, because a path to an executable in `settings.json`
  would be arbitrary code execution with a nice label on it. Anyone who can write
  to your `%APPDATA%` can already run code as you, so this adds no privilege they
  did not have; verify what you download from the whisper.cpp releases page all
  the same. A way to make the app run a binary from anywhere *else* is a
  vulnerability.

## The macOS helper

macOS needs a compiled helper for Vision and the Keychain, built from
`src/system/mac/screenpet-helper.swift` by `npm run build:helper`. It is worth
attacking on its own terms:

- It is **not committed as a binary**, deliberately. A prebuilt artefact in a
  repository is unreviewable, and this one holds the key that unwraps
  `keys.json`.
- It takes base64 on stdin and nothing on argv, for the same reason keys.ps1
  does: arguments are visible to anything that can list processes.
- The Keychain item is `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` - not
  synced to iCloud, not in a backup that leaves the machine. A change that
  widens that is a vulnerability.
- The AppleScript for media control takes its key as an argument to a fixed
  script file. Anything that turns it into an interpolated `-e` string is an
  AppleScript injection and should be reported as one.

## Out of scope

- Vulnerabilities in Ollama, in a model you pulled, or in a hosted provider's
  API — report those to them.
- Anything that requires an attacker to already have code execution or file
  write access under your own user account. At that point they can read
  `%APPDATA%` directly and the app is not the weak link.
- Missing hardening that changes nothing an attacker could reach.
