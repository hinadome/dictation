# Privacy

## Summary

| Path | Audio leave the device? | Text storage |
|---|---|---|
| Microphone (Web Speech) | **Often yes** via browser vendor speech service | Local IndexedDB |
| Share / loopback (Whisper) | **No** for inference after model download | Local IndexedDB |
| Speak (TTS) | Local Speech Synthesis | N/A |
| UI fonts | Google Fonts request (no audio) | N/A |

This app does **not** implement its own speech-upload API. Network use is limited to:

1. Loading the web app / assets  
2. Google Fonts (typography)  
3. First-time Whisper model download from Hugging Face (system modes)  
4. Whatever the **browser** does internally for Web Speech in mic mode  

## Microphone mode detail

`speech.ts` calls `SpeechRecognition.start()`. The browser owns the mic stream and recognition backend. Chrome/Edge commonly send audio to a cloud recognizer. Safari/other engines differ and support varies.

## System / loopback detail

1. Audio is captured in-page (`getDisplayMedia` or `getUserMedia`).  
2. PCM is processed in the tab.  
3. Whisper runs in-browser (WASM / ONNX via `@huggingface/transformers`).  
4. Model files are fetched once per model id, then cached by the library/browser mechanisms.  

English-only models do not receive `language`/`task` generation options; multilingual models may receive a language hint.

## Local data

| Store | Contents |
|---|---|
| IndexedDB `dictation` | Transcript sessions |
| `localStorage` `dictation-prefs` | Language + Whisper size |

Clearing site data for the origin removes both.

## Recommendations

- Prefer **system / loopback + Whisper** when voice must stay on-device.  
- Prefer **microphone + Web Speech** when live quality matters more than keeping audio fully local.  
- Use a private window or separate browser profile if you need isolated session history.  
