# Main page

The app is one screen. All dictation, settings, and history appear here (`#app` rendered by `main.ts`).

## Layout

```
┌─────────────────────────────────────────────────────────────┐
│  Brand: “Dictation” + short subtitle                        │
├──────────────────────────────┬──────────────────────────────┤
│  Composer (left / primary)   │  History (right / aside)     │
│                              │                              │
│  · Audio source tabs         │  · “Saved locally”           │
│  · Capture method (system)   │  · Session list              │
│  · Capture phase / status    │  · Open / Export / Delete    │
│  · Settings grid             │                              │
│  · Level meter               │                              │
│  · Live transcript           │                              │
│  · Start / Speak / New / …   │                              │
│  · Status line               │                              │
└──────────────────────────────┴──────────────────────────────┘
```

On narrow viewports the history stack sits under the composer.

## Regions and functionality

### 1. Brand header

- **Title:** Dictation  
- **Subtitle:** Describes mic / other-app capture and local save  

### 2. Audio source bar

| Control | Behavior |
|---|---|
| **Microphone** | Switches to Web Speech mic path |
| **Other apps / speakers** | Switches to system capture (share or loopback) |

Disabled while a capture session is active.

### 3. Capture method bar (system mode only)

| Control | Behavior |
|---|---|
| **Share app / screen** | `getDisplayMedia` with system/window audio preferences |
| **Loopback device** | `getUserMedia` on a selected audio input |

Contextual hint text explains the chosen method.

### 4. Capture phase banner

Shows the current step, for example:

- click Start / allow share  
- loading Whisper model  
- recording shared audio  
- converting audio → text  
- waiting for audible audio  

### 5. Settings grid

| Field | Purpose |
|---|---|
| **Language** | Web Speech `lang` and Whisper language (or auto-detect) |
| **Whisper model** | tiny / base / small — enabled only in system mode |
| **Input / Loopback input** | Mic list, or loopback device list; disabled for share mode |
| **Speaker output** | Output device when `setSinkId` is supported |
| **Read-aloud voice** | Speech Synthesis voice for **Speak** |
| **Monitor captured audio** | Replay shared audio to speakers (disabled for loopback) |

Settings lock while listening/capturing.

### 6. Level meter

Five bars reflect live input level during system/loopback capture (Web Audio analyser). Useful to confirm that audio is actually arriving.

### 7. Transcript panel

- Final committed text (editable only by appending from recognition)  
- Interim / in-progress line (italic, lighter)  
- Placeholder: “Speak to begin…” when empty  

### 8. Primary controls

| Button | Function |
|---|---|
| **Start / Stop** | Begin or end the active capture engine |
| **Speak / Stop voice** | Read transcript aloud / cancel TTS |
| **New** | Persist current session if needed; open a blank session |
| **Copy** | Copy transcript to clipboard |
| **Export** | Download active session as `.txt` |

### 9. Status line

Human-readable state and errors (permissions, empty audio, model download, soft transcription issues).

### 10. History aside

See [Sessions & storage](./sessions-storage.md).

## Visual / UX notes

- Dark ink background with moss and signal (recording) accents  
- Recording state: Start button turns red/orange and pulses  
- Full DOM re-render on major state changes; live text/meter/status update in place when possible to avoid disruptive refresh during capture  

## Related docs

- [Microphone mode](./microphone-mode.md)  
- [System audio mode](./system-audio-mode.md)  
- [Settings](./settings.md)  
