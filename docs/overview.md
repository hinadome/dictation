# Overview

## Purpose

Dictation turns spoken audio into text inside the browser and keeps notes on the local device (per origin). Users can dictate with a microphone or capture audio that other applications are playing.

## Application type

- Single-page app (SPA) served by Vite
- No backend server in this project
- Runtime: modern Chromium browsers (Chrome / Edge)

## High-level architecture

```
┌──────────────────────────────────────────────────────────┐
│                     Main page (main.ts)                   │
│  source controls · settings · transcript · history       │
└───────────────┬───────────────────────────┬──────────────┘
                │                           │
        Microphone mode              System audio mode
                │                           │
         speech.ts                  systemAudio.ts
      Web Speech API            getDisplayMedia / getUserMedia
                │                           │
                │                    streamTranscriber.ts
                │                      (PCM segments)
                │                           │
                │                     transcribe.ts
                │                   Whisper (local WASM)
                │                           │
                └─────────────┬─────────────┘
                              │
                         storage.ts
                      IndexedDB sessions
```

## Source modules

| File | Responsibility |
|---|---|
| `main.ts` | UI render, events, session orchestration |
| `speech.ts` | Continuous Web Speech recognition for mic mode |
| `systemAudio.ts` | Open share or loopback streams; load Whisper; start transcription |
| `streamTranscriber.ts` | Web Audio PCM tap, level meter, ~4s segments |
| `transcribe.ts` | Whisper model select/load and inference |
| `storage.ts` | Create / list / save / delete / export sessions |
| `devices.ts` | Enumerate audio inputs/outputs; detect loopback-like devices |
| `speaker.ts` | Speech Synthesis read-aloud |
| `languages.ts` | Language list and Whisper model size options |
| `types.ts` | Shared TypeScript types |
| `style.css` | Visual design |

## End-to-end flows

### A. Microphone dictation

1. User selects **Microphone** and a language.  
2. **Start** → `DictationEngine.start(lang)`.  
3. Browser captures mic and runs Web Speech recognition.  
4. Interim and final text update the transcript panel.  
5. Debounced save writes the session to IndexedDB.

### B. Share app / screen

1. User selects **Other apps / speakers** → **Share app / screen**.  
2. Chooses language + Whisper size.  
3. **Start** → browser share picker (must enable audio).  
4. Whisper model loads (download on first use of that size).  
5. PCM is segmented ~every 4 seconds and transcribed locally.  
6. Text appends to the session and auto-saves.

### C. Loopback

1. User routes system audio into a virtual device (e.g. BlackHole).  
2. Selects that device under **Loopback device**.  
3. Same Whisper pipeline as share mode (PCM → Whisper → text).  
4. Monitor-through-speakers is disabled in this mode to avoid feedback.

## Runtime dependencies

- **Dev/build:** Vite, TypeScript  
- **Runtime (system mode):** `@huggingface/transformers` (lazy-loaded)  
- **Fonts:** Google Fonts (Figtree, Fraunces) — UI only, not audio  

## Browser permissions

| Permission / prompt | When |
|---|---|
| Microphone | Mic mode, loopback, device label enumeration |
| Display / screen share + audio | Share app / screen mode |
| Clipboard | Copy button |
