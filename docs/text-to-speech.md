# Text to Speech mode

## Purpose

Convert typed or uploaded **text into speech**. The app offers two independent paths:

- **Speak** — plays audio through the speakers using the browser **Web Speech synthesis API**. Nothing is saved.
- **Download audio (WAV)** — generates speech **on-device** with a local Hugging Face TTS model (transformers.js) and saves a `.wav` file.

This is the inverse of the Dictation tab (which turns speech into text).

## Entry

1. Click the **Text to Speech** tab at the top of the page.
2. **Paste** text into the textarea, or click **Upload .txt** to load a plain-text file.
3. Either press **Speak** (play) or **Download audio (WAV)** (save a file).

## UI layout

| Region | Controls |
|---|---|
| Toolbar | **Upload .txt** button, live character counter |
| Text input | Multi-line textarea (paste target / upload destination) |
| Browser voice controls | **Voice**, **Rate** (0.5–2×), **Pitch** (0–2) — apply to **Speak** only |
| Download model | **Download voice model (Hugging Face)** dropdown + optional **Custom model ID** input — apply to **Download (WAV)** only |
| Controls | **Speak / Stop**, **Download audio (WAV)**, **Clear** |
| Status | Progress and result messages |

## Speak (browser Web Speech synthesis)

| Item | Detail |
|---|---|
| Engine | `SpeakerPlayback` in `speaker.ts` (`window.speechSynthesis`) |
| Options | `voiceId`, `rate`, `pitch` via `SpeakOptions` |
| Voices | From `speechSynthesis.getVoices()` (OS/browser provided) |
| Stop | **Stop** button, **Clear**, or switching tabs |
| Save | **Not possible** — the Web Speech API gives no capturable audio stream |

Long text is handled by the browser's own queueing. No model download is involved.

## Download audio (WAV, local model)

Because the Web Speech API cannot be recorded, file output uses a local neural
TTS model (the same on-device transformers.js approach as Whisper in the
system-audio mode).

| Item | Detail |
|---|---|
| Module | `synthesize.ts` |
| Pipeline | `pipeline('text-to-speech', modelId)` from `@huggingface/transformers` (lazy-loaded) |
| Default model | **Auto (match language)** → an MMS/VITS voice chosen from the selected Dictation language (falls back to English) |
| Output | `{ audio: Float32Array, sampling_rate }` → encoded to 16-bit PCM mono **WAV** by `encodeWav` |
| File name | `speech-<timestamp>.wav` |
| First use | Downloads the chosen model from Hugging Face (cached afterward); runs fully local after that |

### Sentence chunking

VITS/MMS-TTS is trained on sentence-level utterances, so very long input in one
pass degrades prosody and can exhaust memory. `chunkText()` splits input:

- Splits on sentence terminators (`.`, `!`, `?`, and CJK `。！？`), keeping the terminator with its sentence.
- Packs consecutive short sentences up to **~240 characters** per chunk (`MAX_CHARS_PER_CHUNK`).
- A single sentence longer than the cap is hard-split on word boundaries; an over-long token is sliced directly (no text is dropped).

Each chunk is synthesized sequentially (status shows `Generating audio… (i/total)`),
separated by ~0.25s of silence, then concatenated into one WAV.

## Model selection (Hugging Face)

| Item | Detail |
|---|---|
| Dropdown | Curated list in `TTS_MODELS` (MMS/VITS voices) + **Auto** + **Custom model ID…** |
| Custom input | Free-text `owner/name`; validated by `isValidModelId()` (strict `owner/name` regex) |
| Resolution | `effectiveTtsModelId(selected, language)` — a valid explicit selection wins; otherwise the language default |
| Persistence | Saved in `localStorage` prefs under `ttsModel` |
| Scope | Applies to **Download (WAV)** only; **Speak** always uses browser voices |

A **custom** model only works if it is a transformers.js-compatible
`text-to-speech` checkpoint whose output is `{ audio, sampling_rate }`. Models
that need speaker embeddings (e.g. SpeechT5) or produce different output (e.g.
Bark) are not supported by the current pipeline and surface an error in the
status line.

## Errors

| Condition | User-facing result |
|---|---|
| Speech synthesis unsupported | Notice shown; controls disabled (needs Chrome/Edge) |
| Empty text | Speak / Download disabled |
| Invalid custom model ID | Status asks for `owner/name` format; download not attempted |
| Model load / generation failure | Status: `Could not generate audio with <model>: <message>` |

## Privacy

- **Speak**: in some browsers (notably Chrome), certain voices are cloud-backed, so text may be sent to the browser vendor's service. On-device OS voices stay local.
- **Download (WAV)**: the model file is fetched once from Hugging Face; all synthesis then runs locally in the browser. No text or audio is uploaded by this app.

See [Privacy](./privacy.md).

## Source

| File | Responsibility |
|---|---|
| `main.ts` | `renderTts`, `bindTtsEvents`, `downloadTtsWav`, tab navigation |
| `speaker.ts` | `SpeakerPlayback`, `SpeakOptions`, voice listing |
| `synthesize.ts` | pipeline load, `chunkText`, `encodeWav`, model list + resolution |
