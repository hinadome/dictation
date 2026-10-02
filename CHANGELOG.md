# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html)-style sectioning for upcoming releases.

## [Unreleased]

### Added

#### Text to Speech tab

- New top-level **tab navigation** (Dictation / Text to Speech) in `main.ts`
- **Text to Speech** view: paste into a textarea or **upload a `.txt`** file, then **Speak** to read it aloud via the browser Web Speech synthesis API (`speaker.ts`)
- Voice / **Rate** / **Pitch** controls for the Speak (browser) path; `SpeakerPlayback.speak()` extended with a `SpeakOptions` object (`voiceId`, `rate`, `pitch`, `onDone`, `onError`)
- **Download audio (WAV)** — generates speech on-device with a local transformers.js TTS model and saves a `.wav` file (`synthesize.ts`); the Web Speech API cannot capture audio, so a model is used for file output
- **Sentence-chunked synthesis**: long text is split into bounded (~240-char) chunks on sentence boundaries, synthesized sequentially with progress, and concatenated with short gaps — removes the practical single-pass length limit of VITS/MMS-TTS
- In-browser **WAV encoder** (`encodeWav`, 16-bit PCM mono) — no extra dependency
- **Hugging Face TTS model selector** for the download path: curated MMS/VITS voices plus a **custom model ID** field (`owner/name`), validated before use; defaults to **Auto (match language)** (original behavior)
- TTS model choice persisted in `localStorage` prefs (`ttsModel`)

#### Deploy / tooling

- Vercel + Netlify static deploy config (`vercel.json`, `netlify.toml`)
- `build:vercel` / `build:netlify` scripts (same `vite build` output → `dist`)
- COOP / COEP `credentialless` headers for Whisper WASM
- `.vercel` / `.netlify` in `.gitignore`
- VM + Container nginx FrontendGateway deploy scripts under `deploy/` (`--no-tls`, `--self-signed`, `--certbot`)
- Root `DEPLOYMENT.md` with detailed VM/Container operations and certificate policy

### Documentation

- Added `docs/text-to-speech.md` (TTS tab: paste/upload, Speak, WAV download, model selector)
- Added project `README.md` summary (stack, modes, quick start, links into `docs/`)
- Added deploy section for Vercel and Netlify (static `dist` publish)
- Added `docs/` specifications: overview, main page, microphone mode, system audio mode, sessions/storage, settings, privacy
- Added this `CHANGELOG.md`

### Changed

- **Container deploy now runs non-root**: `app` and `gateway` use
  `nginxinc/nginx-unprivileged` (UID 101); gateway listens on `8080`/`8443`
  inside the container, with Compose mapping host `80→8080` and `443→8443`
- Certificate PEMs written world-readable (`644`) so the non-root nginx user can
  read them through the read-only mount (self-signed and Certbot paths)
- `DEPLOYMENT.md`: added a **Rootless / non-root Docker** section (docker-group
  vs rootless), updated the Compose services table (user + internal ports), and
  noted the **Text to Speech WAV** model download alongside Whisper (COOP/COEP +
  outbound Hugging Face egress)

### Technical notes (Text to Speech)

| Area | Implementation |
|---|---|
| TTS tab UI / state | `src/main.ts` (`renderTts`, `bindTtsEvents`, tab navigation) |
| Browser read-aloud | `src/speaker.ts` (`SpeakerPlayback`, `SpeakOptions`) |
| Local WAV synthesis | `src/synthesize.ts` (pipeline load, chunking, `encodeWav`) |
| Model selection | `src/synthesize.ts` (`TTS_MODELS`, `effectiveTtsModelId`, `isValidModelId`) |

## [0.1.0] - 2026-09-16

Initial implementation of the Dictation browser app (Vite + TypeScript).

### Added

#### Core application

- Scaffolded Vite vanilla TypeScript project
- Single-page dictation workspace with brand header, composer, and session history
- Auto-save transcripts to IndexedDB (`dictation` / `sessions`)
- Session actions: New, Copy, Export `.txt`, Open, Delete
- Text-to-speech read-aloud via Web Speech Synthesis (`Speak`)
- Visual level meter and capture-phase / status messaging for system capture

#### Microphone mode

- Live dictation via browser Web Speech API (`speech.ts`)
- Continuous recognition with interim + final transcript updates
- Language selection wired to `recognition.lang`

#### System audio mode (other apps / speakers)

- **Share app / screen** capture via `getDisplayMedia` with `systemAudio` / `windowAudio` preferences when supported
- **Loopback device** capture via `getUserMedia` on a selected audio input (e.g. BlackHole, VB-Cable)
- On-device transcription with `@huggingface/transformers` + Whisper
- Whisper model size selector: **tiny**, **base**, **small**
- Language list for Whisper (including auto-detect) and English `.en` checkpoints when dictating English
- PCM-based segment transcription (`streamTranscriber.ts`) instead of fragile MediaRecorder rotate/restart
- Device enumeration for inputs/outputs; loopback-likely device detection and preference
- Optional monitor of shared audio through speakers (disabled for loopback to avoid feedback)
- Preferences persisted in `localStorage` (`languageCode`, `whisperModel`)

#### Privacy / engine split

- Mic path: Web Speech API (browser may use vendor cloud speech)
- Share / loopback path: local Whisper inference after model download from Hugging Face

### Fixed

- Share/system capture UX: clearer post-share steps (model load, recording, transcribing)
- Empty or silent MediaRecorder segments on loopback — switched to Web Audio PCM capture
- UI “refresh loop” during capture — soft transcription errors no longer full-reset the page; intentional stop flag avoids re-entrant `onEnd` from track `ended`
- Whisper English-only models: stop passing `language` / `task` options (library rejects them on `.en` checkpoints)
- Loopback monitor path disabled to prevent feedback into the virtual device

### Changed

- System capture records/transcribes ~4s PCM segments; near-silent segments are skipped
- Capture settings (source, language, Whisper size, devices) lock while listening
- README evolved from minimal setup notes to a summary that points at detailed `docs/`

### Technical notes

| Area | Implementation |
|---|---|
| UI / state | `src/main.ts`, `src/style.css` |
| Mic STT | `src/speech.ts` |
| Share / loopback | `src/systemAudio.ts`, `src/devices.ts` |
| PCM + meter | `src/streamTranscriber.ts` |
| Whisper | `src/transcribe.ts` |
| TTS | `src/speaker.ts` |
| Storage | `src/storage.ts` |
| Languages / models | `src/languages.ts`, `src/types.ts` |
