# Third-Party Notices

**screenpet** · version 0.1.0

screenpet has **one runtime npm dependency**, `electron-updater`, which brings
fifteen of its own. Everything below is either bundled by the packaging step,
provided by the operating system, installed separately by you, or contacted only
when you switch a network setting on.

## Bundled in the packaged app

| Component | Version | Licence |
| --- | --- | --- |
| [Electron](https://github.com/electron/electron) | 43.4.0 | MIT |
| — Chromium (bundled inside Electron) | — | BSD-3-Clause and others |
| — Node.js (bundled inside Electron) | — | MIT |

Electron ships its own aggregated licence file (`LICENSES.chromium.html`) beside
the executable in every build; that file, not this one, is the authoritative
notice for Chromium and its own dependencies.

### Inside `app.asar`

The update check and download. These are the packages `npm ls --omit=dev` lists,
and they are in the shipped archive — `@electron/asar`'s own listing of
`resources/app.asar` is where this table came from, rather than the manifest,
because what ships is the thing that needs a notice.

| Component | Version | Licence |
| --- | --- | --- |
| [electron-updater](https://github.com/electron-userland/electron-builder) | 6.8.9 | MIT |
| [builder-util-runtime](https://github.com/electron-userland/electron-builder) | 9.7.0 | MIT |
| [argparse](https://github.com/nodeca/argparse) | 2.0.1 | Python-2.0 |
| [debug](https://github.com/debug-js/debug) | 4.4.3 | MIT |
| [fs-extra](https://github.com/jprichardson/node-fs-extra) | 10.1.0 | MIT |
| [graceful-fs](https://github.com/isaacs/node-graceful-fs) | 4.2.11 | ISC |
| [js-yaml](https://github.com/nodeca/js-yaml) | 4.3.1 | MIT |
| [jsonfile](https://github.com/jprichardson/node-jsonfile) | 6.2.1 | MIT |
| [lazy-val](https://github.com/develar/lazy-val) | 1.0.5 | MIT |
| [lodash.escaperegexp](https://github.com/lodash/lodash) | 4.1.2 | MIT |
| [lodash.isequal](https://github.com/lodash/lodash) | 4.5.0 | MIT |
| [ms](https://github.com/vercel/ms) | 2.1.3 | MIT |
| [sax](https://github.com/isaacs/sax-js) | 1.6.1 | BlueOak-1.0.0 |
| [semver](https://github.com/npm/node-semver) | 7.7.4 | ISC |
| [tiny-typed-emitter](https://github.com/binier/tiny-typed-emitter) | 2.1.0 | MIT |
| [universalify](https://github.com/RyanZim/universalify) | 2.0.1 | MIT |

All permissive. Two are not MIT or ISC and both require the notice above to
travel with the software: `argparse` is under the Python licence, and `sax` is
under Blue Oak 1.0.0.

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
