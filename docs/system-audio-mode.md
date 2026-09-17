# System audio mode

## Purpose

Capture audio that other applications play (meetings, videos, etc.) and convert it to text with **on-device Whisper**.

Two capture methods share the same transcription pipeline.

## Common setup

1. Select **Other apps / speakers**.  
2. Choose **Language** and **Whisper model** (tiny / base / small).  
3. Choose **Share app / screen** or **Loopback device**.  
4. Click **Start**.

## Method A — Share app / screen

### Behavior

1. Browser shows the display-media picker.  
2. User picks a **window** or **Entire Screen** (or a tab).  
3. User must enable **Share audio** / system audio.  
4. App verifies an audio track exists; otherwise it errors and stops.  
5. Whisper model is prepared, then PCM transcription starts.

### Technical notes

- Implemented in `systemAudio.ts` → `openDisplayAudio()`  
- Requests `systemAudio: 'include'` and `windowAudio` preferences when supported  
- Falls back through several constraint shapes if the browser rejects newer fields  
- Video track may be present to keep the share alive; transcription uses audio only  

### Expected UX after Allow

1. Start stays in recording state  
2. Phase: loading model (first time per model can take a while)  
3. Level meter moves if audio is flowing  
4. Transcript lines appear about every 4 seconds  

### Common failure

Share succeeded for video but **Share audio** was off → no audio track → clear error asking to retry with audio enabled.

## Method B — Loopback device

### Behavior

1. User selects a loopback-like input (BlackHole, VB-Cable, Stereo Mix, …).  
2. App opens that device with `getUserMedia` (echo cancellation / noise suppression off).  
3. Same Whisper + PCM pipeline as share mode.  

### Routing (macOS example)

1. Install BlackHole.  
2. Create a Multi-Output Device: Speakers + BlackHole.  
3. Set that Multi-Output as system output.  
4. In the app, set **Loopback input** to BlackHole.  
5. Start — meter should respond to other apps.

### Monitor control

**Monitor captured audio through speakers** is **disabled** for loopback to avoid feedback into the same virtual device.

## Transcription pipeline (both methods)

| Step | Module | Detail |
|---|---|---|
| Open stream | `systemAudio.ts` | Share or loopback |
| Configure Whisper | `transcribe.ts` | Size + language → model id |
| Load model | transformers.js | Cached after first download |
| Tap PCM | `streamTranscriber.ts` | ScriptProcessor + analyser |
| Segment | ~4 seconds | Quiet segments skipped |
| Infer | Whisper | Local WASM |
| Append text | `main.ts` | Same session append/save path |

### Model selection rules

- English languages → `Xenova/whisper-{tiny\|base\|small}.en`  
- Other languages / auto-detect → multilingual `Xenova/whisper-{tiny\|base\|small}`  
- English-only models are called **without** `language` / `task` options (required by the library)  

## Level meter & soft status

- Meter reflects input RMS  
- If little audio arrives for several seconds, status explains routing / share-audio checks  
- Soft transcription issues update the status line without tearing down the whole UI  

## Related docs

- [Settings](./settings.md)  
- [Privacy](./privacy.md)  
- [Main page](./main-page.md)  
