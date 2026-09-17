# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html)-style sectioning for upcoming releases.

## [Unreleased]

### Added

- Vercel + Netlify static deploy config (`vercel.json`, `netlify.toml`)
- `build:vercel` / `build:netlify` scripts (same `vite build` output → `dist`)
- COOP / COEP `credentialless` headers for Whisper WASM
- `.vercel` / `.netlify` in `.gitignore`
- VM + Container nginx FrontendGateway deploy scripts under `deploy/` (`--no-tls`, `--self-signed`, `--certbot`)
- Root `DEPLOYMENT.md` with detailed VM/Container operations and certificate policy

### Documentation

- Added project `README.md` summary (stack, modes, quick start, links into `docs/`)
- Added deploy section for Vercel and Netlify (static `dist` publish)
- Added `docs/` specifications: overview, main page, microphone mode, system audio mode, sessions/storage, settings, privacy
- Added this `CHANGELOG.md`

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
