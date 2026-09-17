# Microphone mode

## Purpose

Live dictation from the computer microphone using the browser **Web Speech API**.

## Entry

1. On the main page, select **Microphone**.  
2. Choose a **Language** (BCP-47 tag such as `en-US`, `ja-JP`).  
3. Click **Start** and allow microphone access if prompted.

## Functional specification

| Item | Detail |
|---|---|
| Engine | `DictationEngine` in `speech.ts` |
| API | `window.SpeechRecognition` or `webkitSpeechRecognition` |
| Continuity | `continuous = true`, auto-restart on browser `onend` while user still wants listening |
| Interim results | `interimResults = true` — shown in the interim transcript line |
| Language | `recognition.lang` from the Language dropdown (`auto` falls back to `navigator.language`) |
| Stop | User **Stop**, **New**, opening another session, or switching flows that call `engine.stop()` |

## UI behavior while listening

- Start button shows **Stop** and recording styling  
- Source/settings controls are locked  
- Status indicates listening + active language  
- Final phrases append to the transcript with light spacing rules  
- Session auto-saves shortly after text changes  

## Errors

| Condition | User-facing result |
|---|---|
| API unsupported | Start unavailable; status explains Chrome/Edge needed |
| Mic permission denied | Access blocked / denied state |
| Other recognition errors | Status message (abort / no-speech ignored quietly) |

## Quality and privacy

- Often higher live-dictation quality than on-device tiny Whisper  
- In Chrome/Edge, recognition is commonly performed by the **browser vendor’s cloud service** — this app does not implement its own upload, but audio may leave the device via the browser  
- See [Privacy](./privacy.md)  

## Out of scope for this mode

- Whisper model size selector (disabled)  
- Share / loopback capture  
- Level meter from Web Audio (meter is tied to system capture path)  
