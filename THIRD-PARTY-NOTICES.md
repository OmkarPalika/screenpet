# Third-Party Notices

**screenpet** · version 0.1.0

screenpet has **no runtime npm dependencies**. Everything below is either
bundled by the packaging step, provided by the operating system, installed
separately by you, or contacted only when you switch a network setting on.

## Bundled in the packaged app

| Component | Version | Licence |
| --- | --- | --- |
| [Electron](https://github.com/electron/electron) | 43.4.0 | MIT |
| — Chromium (bundled inside Electron) | — | BSD-3-Clause and others |
| — Node.js (bundled inside Electron) | — | MIT |

Electron ships its own aggregated licence file (`LICENSES.chromium.html`) beside
the executable in every build; that file, not this one, is the authoritative
notice for Chromium and its own dependencies.

## Build and development only — not shipped

| Component | Version | Licence | Used for |
| --- | --- | --- | --- |
| [electron-builder](https://github.com/electron-userland/electron-builder) | 26.15.3 | MIT | Producing the installer |
| [gifenc](https://github.com/mattdesl/gifenc) | 1.0.3 | MIT | Recording the demo GIF |

## Provided by Windows

Used through operating-system APIs. Nothing is bundled or redistributed:

- `Windows.Media.Ocr` — reading text off the screen
- `System.Speech` — dictation and the wake word
- `System.Speech.Synthesis` — the pet's voice
- `Windows.Media.FaceAnalysis` — counting faces in a camera frame, never
  identifying them
- Windows DPAPI (`ProtectedData`) — wrapping a stored API key

## Installed separately by you

- **[Ollama](https://ollama.com)** (MIT) — the local model runtime. Not bundled,
  not installed by screenpet, and not supported by us.
- **The models you pull into it** carry their own licences — DeepSeek, Llama,
  Mistral, Moondream and others each have their own terms, including some with
  restrictions on commercial use. Complying with the licence of a model you run
  is your responsibility.

## Network services — only with the internet switch on

| Service | Used for | Terms and attribution |
| --- | --- | --- |
| [Open-Meteo](https://open-meteo.com) | Weather, and geocoding a town name | Free for non-commercial use without a key; weather data is CC BY 4.0 |
| [DuckDuckGo Instant Answer API](https://duckduckgo.com/api) | `look up ...` | DuckDuckGo's API terms |
| [Wikipedia / MediaWiki REST API](https://www.mediawiki.org/wiki/REST_API) | `look up ...`, when there is no instant answer | Article text is **CC BY-SA 4.0** |
| Anthropic, OpenAI, Google, NVIDIA, Mistral | An optional hosted model, if you select one and supply a key | Each provider's own terms and pricing |

Two obligations worth naming explicitly:

- **Wikipedia extracts are CC BY-SA 4.0.** When the pet reads one out it is
  quoting a licensed work. Attribution is required if you reproduce or
  redistribute that text elsewhere.
- **Open-Meteo's free tier is for non-commercial use.** Shipping a commercial
  build with the weather feature on by default would need their commercial plan;
  screenpet ships with it off, and it stays a per-user opt-in.

## screenpet itself

Copyright © 2026 Omkar Palika. All rights reserved. See [LICENSE](LICENSE) and
[TERMS.md](TERMS.md).
