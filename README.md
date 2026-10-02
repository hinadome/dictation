# Dictation

Browser-based voice notes. **Dictation** captures from a microphone or other apps/speakers and converts speech to text; **Text to Speech** reads pasted or uploaded text aloud and can export it as a WAV file. Everything is stored locally in the browser.

## What it does

The app has two tabs:

### Dictation (speech → text)

| Mode | How audio is captured | How text is produced | Privacy note |
|---|---|---|---|
| **Microphone** | Computer mic | Browser Web Speech API | May use the browser vendor’s cloud speech service |
| **Share app / screen** | Tab, window, or screen audio | On-device Whisper | Model download from Hugging Face; transcription is local |
| **Loopback device** | Virtual input (e.g. BlackHole) | On-device Whisper | Same as above |

### Text to Speech (text → speech)

| Action | Input | How audio is produced | Output |
|---|---|---|---|
| **Speak** | Paste or upload `.txt` | Browser Web Speech synthesis | Plays through speakers |
| **Download audio (WAV)** | Paste or upload `.txt` | On-device transformers.js TTS model | Saves a `.wav` file |

The WAV path chunks long text by sentence, runs a local Hugging Face TTS model (selectable, default **Auto** by language), and encodes 16-bit PCM WAV in the browser.

Also supported: language selection, Whisper model size (tiny / base / small), voice / rate / pitch, read-aloud via speakers, session history, copy, and `.txt` export.

## Quick start

```bash
npm install
npm run dev
```

Open **http://localhost:5173/** (Chrome or Edge recommended).

```bash
npm run build    # production build
npm run preview  # preview the build
```

## Deploy (Vercel / Netlify)

This is a **static Vite SPA**. Publish directory is `dist` (not `dist/client` — there is no Nitro SSR server).

### Vercel

1. Import the repo in Vercel (or `npx vercel`).
2. Framework preset: Vite (see `vercel.json`).
3. Build: `npm run build` → output `dist`.

```bash
npm run build:vercel
npx vercel deploy --prebuilt   # optional CLI path after linking
```

### Netlify

1. Import the repo in Netlify (or `npx netlify deploy`).
2. Config is in `netlify.toml`: publish `dist`, SPA fallback to `/index.html`.
3. Do **not** set publish to `dist/client` (that path is for Nitro SSR apps only).

```bash
npm run build:netlify
npx netlify deploy --prod --dir=dist
```

Both platforms send `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless` to help Whisper / ONNX WASM.

**Note:** Mic and screen-share APIs require a secure context (HTTPS or localhost). Hosted deploys must use HTTPS (default on Vercel/Netlify).

## Deploy on a VM or with Docker

Idempotent nginx FrontendGateway scripts (separate VM vs Container paths):

- Full guide: **[DEPLOYMENT.md](./DEPLOYMENT.md)**
- Short pointer: [`deploy/README.md`](./deploy/README.md)

```bash
# Verify first (HTTP only, no certificates)
sudo ./deploy/vm/deploy.sh --domain dictation.example.com --no-tls
./deploy/container/deploy.sh --domain dictation.example.com --no-tls

# Then HTTPS (self-signed or Let's Encrypt)
sudo ./deploy/vm/deploy.sh --domain dictation.example.com --self-signed
sudo ./deploy/vm/deploy.sh --domain dictation.example.com --certbot --email you@example.com
```

## Stack

- Vite + TypeScript (vanilla)
- Web Speech API — recognition (mic mode) and synthesis (Speak)
- `@huggingface/transformers` — Whisper (system / loopback) and MMS/VITS TTS (WAV download)
- IndexedDB for sessions, `localStorage` for preferences

## Documentation

Detailed specs live in [`docs/`](./docs/):

| Doc | Contents |
|---|---|
| [Overview](./docs/overview.md) | Architecture, modules, data flow |
| [Main page](./docs/main-page.md) | Full UI layout and controls |
| [Microphone mode](./docs/microphone-mode.md) | Mic capture + Web Speech |
| [System audio mode](./docs/system-audio-mode.md) | Share screen + loopback + Whisper |
| [Text to Speech](./docs/text-to-speech.md) | Paste/upload text, Speak, WAV download, model selector |
| [Sessions & storage](./docs/sessions-storage.md) | History, IndexedDB, export |
| [Settings](./docs/settings.md) | Language, Whisper size, devices |
| [Privacy](./docs/privacy.md) | What stays local vs external |
| [Deployment](./docs/deployment.md) | Vercel / Netlify static hosting |
| [Changelog](./CHANGELOG.md) | Implementation history |

## Requirements

- Chrome or Edge (best Web Speech and display-audio support)
- Mic permission for microphone / loopback
- For share mode: enable **Share audio** in the browser dialog
- For loopback on macOS: [BlackHole](https://existential.audio/blackhole/) + Multi-Output Device is typical

## Project layout

```
src/
  main.ts              UI and app wiring
  speech.ts            Web Speech (mic)
  systemAudio.ts       Share / loopback capture
  streamTranscriber.ts PCM capture + segmenting
  transcribe.ts        Whisper pipeline
  storage.ts           IndexedDB sessions
  devices.ts           Input/output device listing
  speaker.ts           Text-to-speech playback (Speak)
  synthesize.ts        Local TTS → WAV download + model selection
  languages.ts         Language + model options
docs/                  Specifications
```
