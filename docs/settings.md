# Settings

Controls on the main page that configure capture and playback. Values that matter across visits are saved in `localStorage` key `dictation-prefs`.

## Language

| Applies to | How |
|---|---|
| Microphone | Web Speech `recognition.lang` |
| System / loopback | Whisper `language` when using multilingual models |

Options include major locales (English, Japanese, Chinese, Korean, Spanish, French, German, …) plus **Auto-detect (Whisper)** (`code: auto`).

- For Web Speech, `auto` uses `navigator.language`.  
- For Whisper, `auto` omits a forced language so the multilingual model can detect.

Default: best match to `navigator.language`, else `en-US`.

## Whisper model

Enabled only when **Other apps / speakers** is selected.

| Size | Trade-off |
|---|---|
| **Tiny** | Fastest, lowest accuracy, smallest download |
| **Base** | Balanced |
| **Small** | Best of the three, slower, larger download |

First use of each size downloads weights (cached afterward by the transformers runtime).

English sessions prefer `.en` checkpoints; other languages use multilingual checkpoints.

## Input / loopback input

| Mode | Control |
|---|---|
| Microphone | Lists `audioinput` devices (informative for labeling; Web Speech uses the browser default recognition input path) |
| Share | Disabled — source is the shared surface |
| Loopback | User must pick the virtual/loopback device |

Devices whose labels match hints such as `blackhole`, `cable`, `stereo mix`, `loopback`, etc. are tagged as loopback-likely and preferred when possible.

## Speaker output

Lists `audiooutput` devices when `HTMLAudioElement.setSinkId` exists. Used for monitoring shared audio (not for Speech Synthesis voice routing in all browsers).

## Read-aloud voice

Populated from `speechSynthesis.getVoices()`. Used by the **Speak** button (`speaker.ts`).

## Monitor captured audio

- **Share mode:** optional; plays the captured audio track to the selected output  
- **Loopback mode:** forced off to prevent feedback into the virtual device  

## Preference persistence

Saved in `localStorage`:

```json
{
  "languageCode": "en-US",
  "whisperModel": "tiny"
}
```

Device selections and monitor checkbox are session UI state (re-enumerated each load).

## Locking

While listening/capturing, source tabs, language, Whisper size, and most device controls are disabled until **Stop**.
