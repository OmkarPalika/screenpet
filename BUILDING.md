# Building screenpet

## Windows

```bash
npm install
```
```bash
npm run dist
```

Produces `dist/screenpet-0.1.0-setup.exe` and a portable build. Nothing else is
needed: the PowerShell scripts in `src/system/` are interpreted, not compiled.

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
exactly as they do on Windows, so dictation still works — see the README.

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
