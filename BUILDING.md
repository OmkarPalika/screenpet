# Building screenpet

## Windows

```bash
npm install
```
```bash
npm run dist
```

Produces `dist/screenpet-<version>-setup.exe` and a portable build, where the
version is whatever `package.json` says. Nothing else is
needed: the PowerShell scripts in `src/system/` are interpreted, not compiled.

## Publishing a release

`Check for updates` in Settings reads GitHub's release list for
`OmkarPalika/screenpet`, which is the `publish` block in `package.json`. Two
things have to be true for it to find anything:

1. That repository has to exist and have a release. It does not yet — there is
   no git remote on this checkout.
2. The release has to carry `latest.yml` next to the installer. That file is
   what electron-updater reads, and it holds the SHA-512 the download is checked
   against. `npm run dist` does not produce it; publishing does.

```bash
npm version patch
```
```bash
npm run release
```

`release` is `electron-builder --publish always`, which needs a GitHub token
with `repo` scope in `GH_TOKEN`. It uploads the installer, the portable build
and `latest.yml` to a draft release for the current `version` in
`package.json` — publish the draft and the button in Settings will see it.

Bump the version before every release. electron-updater compares semver, so a
release that reuses a version number is invisible to everyone already running
it.

## Signing the Windows build

Unsigned, SmartScreen warns on first install, and electron-updater skips its
publisher-signature check on the downloaded installer — the SHA-512 in
`latest.yml` is then the only thing standing between a compromised release feed
and code running as you. Signing is what turns that into two independent checks.

**Since June 2023 every code-signing certificate's private key has to live on
FIPS 140-2 Level 2 hardware.** No CA issues a plain `.pfx` any more, so the
choice is a USB token that has to be plugged in, or a cloud signing service.

| Route | Rough cost | Notes |
| --- | --- | --- |
| Azure Trusted Signing | ~$10/month | Cheapest, no hardware, signs in CI. Organisations need three years of verifiable trading history; there is an individual tier |
| Certum open-source certificate | ~€60–100/year | Aimed at open-source authors, cheapest one-off. Physical USB token, so signing happens on your machine |
| SSL.com / DigiCert / Sectigo OV | ~$200–400/year | Token or the CA's own cloud signer |
| Any of the above, EV | ~2–3× the OV price | The only reason to pay it: EV gets SmartScreen reputation immediately. OV builds it over downloads and time |

Whichever you pick, the identity check is the slow part — expect days, and for a
personal certificate expect to prove your address.

Once you have one, sign at build time. electron-builder 25 and later nest the
Windows options, which older guides on the web do not:

```jsonc
// package.json, inside "build"
"win": {
  "signtoolOptions": {
    // Exactly as it appears in the certificate. electron-updater compares this
    // against the signature on a downloaded installer before running it.
    "publisherName": "Omkar Palika",
    "certificateSubjectName": "Omkar Palika",
    "rfc3161TimeStampServer": "http://timestamp.digicert.com"
  }
}
```

With a USB token that is all of it — signtool finds the certificate in the
Windows store by subject name, and the token asks for its PIN. For Azure Trusted
Signing use `azureSignOptions` instead and put the credentials in
`AZURE_TENANT_ID`, `AZURE_CLIENT_ID` and `AZURE_CLIENT_SECRET`; never in
`package.json`.

Timestamping is not optional. Without it every signature you have ever made
stops verifying the day the certificate expires.

## macOS

macOS needs one thing Windows does not — a small compiled helper. Vision (text
and face recognition) and the Keychain are frameworks, not shell commands, and
there is no CLI on the system that exposes either. So:

```bash
npm install
```
```bash
npm run build:helper
```
```bash
npm run dist
```

`build:helper` runs `swiftc` over `src/system/mac/screenpet-helper.swift` and
needs Xcode's command line tools (`xcode-select --install`). It produces
`src/system/mac/screenpet-helper`, which is git-ignored — **the binary is not
committed on purpose.** A compiled artefact in a repository is a thing nobody
can review, in the one part of this app that holds your API keys.

Check what the machine can do before running anything:

```bash
npm run doctor
```

If the helper is missing, `doctor` says so and the app still runs — reading the
screen, faces and the key store each say what is missing rather than failing
with a stack trace. Everything else works without it.

### Permissions macOS will ask for

- **Screen Recording** — required, this is how the pet sees the screen at all.
  System Settings ▸ Privacy & Security ▸ Screen Recording.
- **Camera** and **Microphone** — only if you switch those settings on.
- **Automation** — only the first time the pet touches the music controls;
  macOS asks before letting it talk to Music or Spotify.

macOS denies all four silently until granted, so if a feature does nothing at
all, that list is the first place to look.

### What is different on macOS

| | Windows | macOS |
| --- | --- | --- |
| Reads the screen | Windows.Media.Ocr | Vision |
| Faces | Windows.Media.FaceAnalysis | Vision |
| Dictation | Windows' own recogniser, or whisper/Parakeet | **whisper or Parakeet only** |
| Wake word | Built in | **Not available** |
| Volume and mute | Media keys | System volume |
| Play, skip, previous | Any player | **Music or Spotify only** |
| Do not disturb | Focus, games, full screen, presenting | **Focus only** |
| API keys at rest | DPAPI | Keychain + AES-GCM |

The two in bold that are missing rather than different are both a recogniser
holding the microphone open. macOS has `SFSpeechRecognizer`, but it goes to
Apple's servers unless asked very specifically not to, and this app does not
ship a maybe on that question. whisper.cpp and Parakeet run locally on macOS
exactly as they do on Windows, so dictation still works — see
[Out loud, and back](DESIGN.md#out-loud-and-back).

## Linux and everything else

Not implemented. The app starts, the pet is there and chat works, and every
capability that needs the operating system says what it cannot do. Adding a
platform means one new entry per capability in `src/system/host.js` and nothing
else — that file is the whole of what is platform-specific.

## Android and iOS

Not planned, and not a port.

Electron does not run on either. Android would need the screen read through
`MediaProjection` or an accessibility service, a model running on-device
through llama.cpp or MLC rather than Ollama, and `SYSTEM_ALERT_WINDOW` for the
pet itself — a separate application sharing the idea and none of the code.

iOS cannot do the central feature at all: the sandbox does not let an app read
another app's screen, and no entitlement changes that.
