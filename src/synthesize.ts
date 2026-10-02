// Local, offline text-to-speech using transformers.js (MMS-TTS / VITS).
// Generates raw audio samples in the browser so the result can be saved to a
// WAV file — unlike the Web Speech API, which can only play to the speakers.

type SynthOutput = {
  audio: Float32Array
  sampling_rate: number
}

type Synthesizer = (text: string) => Promise<SynthOutput>

// MMS-TTS checkpoints are per-language and end-to-end (no speaker embeddings).
// Map the app's BCP-47 language codes to Xenova MMS-TTS model ids.
// Falls back to English when a language has no bundled checkpoint here.
const MMS_BY_PREFIX: Record<string, string> = {
  en: 'Xenova/mms-tts-eng',
  es: 'Xenova/mms-tts-spa',
  fr: 'Xenova/mms-tts-fra',
  de: 'Xenova/mms-tts-deu',
  it: 'Xenova/mms-tts-ita',
  pt: 'Xenova/mms-tts-por',
  ru: 'Xenova/mms-tts-rus',
  hi: 'Xenova/mms-tts-hin',
  ar: 'Xenova/mms-tts-ara',
  nl: 'Xenova/mms-tts-nld',
  pl: 'Xenova/mms-tts-pol',
  tr: 'Xenova/mms-tts-tur',
  vi: 'Xenova/mms-tts-vie',
  th: 'Xenova/mms-tts-tha',
  id: 'Xenova/mms-tts-ind',
  sv: 'Xenova/mms-tts-swe',
  ko: 'Xenova/mms-tts-kor',
  // Note: MMS does not ship Japanese or Chinese VITS checkpoints; those fall back.
}

const DEFAULT_MODEL = 'Xenova/mms-tts-eng'

export function resolveTtsModelId(languageCode: string): string {
  const prefix = (languageCode || 'en').split('-')[0]!.toLowerCase()
  return MMS_BY_PREFIX[prefix] ?? DEFAULT_MODEL
}

export function isTtsLanguageSupported(languageCode: string): boolean {
  const prefix = (languageCode || 'en').split('-')[0]!.toLowerCase()
  return prefix in MMS_BY_PREFIX
}

// Sentinel meaning "pick the model automatically from the selected language".
export const AUTO_TTS_MODEL = 'auto'

export interface TtsModelOption {
  id: string
  label: string
  hint: string
}

// Curated, transformers.js-compatible text-to-speech checkpoints.
// All are VITS/MMS-TTS (end-to-end, no speaker embeddings) so the pipeline
// handles them uniformly and the WAV encoder works without changes.
export const TTS_MODELS: TtsModelOption[] = [
  { id: AUTO_TTS_MODEL, label: 'Auto (match language) — default', hint: 'Chooses an MMS voice from the selected language (original behavior)' },
  { id: 'Xenova/mms-tts-eng', label: 'English — MMS', hint: 'facebook/mms-tts-eng' },
  { id: 'Xenova/mms-tts-spa', label: 'Spanish — MMS', hint: 'facebook/mms-tts-spa' },
  { id: 'Xenova/mms-tts-fra', label: 'French — MMS', hint: 'facebook/mms-tts-fra' },
  { id: 'Xenova/mms-tts-deu', label: 'German — MMS', hint: 'facebook/mms-tts-deu' },
  { id: 'Xenova/mms-tts-ita', label: 'Italian — MMS', hint: 'facebook/mms-tts-ita' },
  { id: 'Xenova/mms-tts-por', label: 'Portuguese — MMS', hint: 'facebook/mms-tts-por' },
  { id: 'Xenova/mms-tts-rus', label: 'Russian — MMS', hint: 'facebook/mms-tts-rus' },
  { id: 'Xenova/mms-tts-hin', label: 'Hindi — MMS', hint: 'facebook/mms-tts-hin' },
  { id: 'Xenova/mms-tts-ara', label: 'Arabic — MMS', hint: 'facebook/mms-tts-ara' },
  { id: 'Xenova/mms-tts-kor', label: 'Korean — MMS', hint: 'facebook/mms-tts-kor' },
  { id: 'Xenova/mms-tts-vie', label: 'Vietnamese — MMS', hint: 'facebook/mms-tts-vie' },
  { id: 'Xenova/mms-tts-tur', label: 'Turkish — MMS', hint: 'facebook/mms-tts-tur' },
]

export function isCuratedTtsModel(id: string): boolean {
  return TTS_MODELS.some((model) => model.id === id)
}

// A Hugging Face model id looks like "owner/name"; keep it conservative to
// avoid passing junk to the pipeline loader.
export function isValidModelId(id: string): boolean {
  return /^[\w.-]+\/[\w.-]+$/.test(id.trim())
}

// Rebuild a validated model id from an explicit allow-list of characters.
// Returns '' if the input is not a well-formed "owner/name". Because the output
// is constructed here from a fixed character set (not sliced from the input),
// no untrusted substring is carried forward into callers / the DOM.
const MODEL_ID_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-/'
export function sanitizeModelId(id: string): string {
  const trimmed = (id ?? '').trim()
  if (!isValidModelId(trimmed)) return ''
  let out = ''
  for (const ch of trimmed) {
    if (MODEL_ID_CHARS.includes(ch)) out += ch
    else return '' // any disallowed char => reject outright
  }
  // Re-check the reconstructed string still matches the owner/name shape.
  return isValidModelId(out) ? out : ''
}

// Resolve the effective model id: an explicit (non-auto, valid) selection wins,
// otherwise fall back to the language-based default. A custom id is run through
// sanitizeModelId so the returned value is reconstructed from a fixed character
// set — no untrusted input substring is ever returned to callers.
export function effectiveTtsModelId(selectedModelId: string, languageCode: string): string {
  const chosen = (selectedModelId || AUTO_TTS_MODEL).trim()
  if (chosen && chosen !== AUTO_TTS_MODEL) {
    const curated = TTS_MODELS.find((model) => model.id === chosen)
    if (curated) return curated.id // in-code constant
    const safe = sanitizeModelId(chosen)
    if (safe) return safe // reconstructed from allow-listed chars
  }
  return resolveTtsModelId(languageCode)
}

let loadedModelId: string | null = null
let synthesizerPromise: Promise<Synthesizer> | null = null

async function getSynthesizer(
  modelId: string,
  onStatus?: (message: string) => void,
): Promise<Synthesizer> {
  if (!synthesizerPromise || loadedModelId !== modelId) {
    loadedModelId = modelId
    synthesizerPromise = (async () => {
      onStatus?.(`Downloading ${modelId} (cached after first time)…`)
      const { pipeline } = await import('@huggingface/transformers')
      onStatus?.('Initializing speech model…')
      const synth = (await pipeline('text-to-speech', modelId)) as unknown as Synthesizer
      onStatus?.('Speech model ready.')
      return synth
    })().catch((error) => {
      synthesizerPromise = null
      loadedModelId = null
      throw error
    })
  }

  return synthesizerPromise
}

export interface SynthesizeResult {
  audio: Float32Array
  sampleRate: number
}

// VITS/MMS-TTS is trained on sentence-level utterances. Long input in one pass
// hurts prosody and can exhaust memory, so we split into bounded chunks and
// synthesize each separately, then concatenate the audio.
export const MAX_CHARS_PER_CHUNK = 240

export function chunkText(text: string, maxChars = MAX_CHARS_PER_CHUNK): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) return []

  // First split on sentence boundaries (., !, ?, and common CJK terminators),
  // keeping the terminator with its sentence. The final alternative captures a
  // trailing run of text that has no terminator (so nothing is dropped).
  const sentences = normalized.match(/[^.!?。！？]+[.!?。！？]+|[^.!?。！？]+$/g) ?? [normalized]

  const chunks: string[] = []
  let current = ''

  const pushCurrent = (): void => {
    const trimmed = current.trim()
    if (trimmed) chunks.push(trimmed)
    current = ''
  }

  for (const sentence of sentences) {
    const piece = sentence.trim()
    if (!piece) continue

    // A single sentence longer than the cap is hard-split on word boundaries.
    if (piece.length > maxChars) {
      pushCurrent()
      chunks.push(...hardSplit(piece, maxChars))
      continue
    }

    if ((current + ' ' + piece).trim().length > maxChars) {
      pushCurrent()
    }
    current = current ? `${current} ${piece}` : piece
  }
  pushCurrent()

  return chunks
}

function hardSplit(text: string, maxChars: number): string[] {
  const words = text.split(' ')
  const parts: string[] = []
  let current = ''

  for (const word of words) {
    if (word.length > maxChars) {
      // A single token longer than the cap: slice it directly.
      if (current.trim()) parts.push(current.trim())
      current = ''
      for (let i = 0; i < word.length; i += maxChars) {
        parts.push(word.slice(i, i + maxChars))
      }
      continue
    }
    if ((current + ' ' + word).trim().length > maxChars) {
      if (current.trim()) parts.push(current.trim())
      current = word
    } else {
      current = current ? `${current} ${word}` : word
    }
  }
  if (current.trim()) parts.push(current.trim())
  return parts
}

function concatFloat32(parts: Float32Array[]): Float32Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const result = new Float32Array(total)
  let offset = 0
  for (const part of parts) {
    result.set(part, offset)
    offset += part.length
  }
  return result
}

export interface SynthesizeProgress {
  onStatus?: (message: string) => void
  onProgress?: (done: number, total: number) => void
}

export async function synthesizeToSamples(
  text: string,
  languageCode: string,
  progress?: SynthesizeProgress | ((message: string) => void),
  modelIdOverride?: string,
): Promise<SynthesizeResult> {
  const callbacks: SynthesizeProgress =
    typeof progress === 'function' ? { onStatus: progress } : progress ?? {}

  const trimmed = text.trim()
  if (!trimmed) throw new Error('No text to synthesize.')

  const modelId = effectiveTtsModelId(modelIdOverride ?? AUTO_TTS_MODEL, languageCode)
  // Paint any pending status (e.g. "Preparing speech model…") before the
  // potentially long, blocking model load / import.
  await yieldToPaint()
  const synth = await getSynthesizer(modelId, callbacks.onStatus)

  const chunks = chunkText(trimmed)
  if (chunks.length === 0) throw new Error('No text to synthesize.')

  const audioParts: Float32Array[] = []
  let sampleRate = 16000
  // ~0.25s of silence between chunks for natural phrasing.
  let gapSamples = 0

  for (let i = 0; i < chunks.length; i += 1) {
    callbacks.onStatus?.(
      chunks.length > 1
        ? `Generating audio… (${i + 1}/${chunks.length})`
        : 'Generating audio…',
    )
    callbacks.onProgress?.(i, chunks.length)

    // Synthesis runs on the main thread (WASM). Yield to the event loop so the
    // browser can paint the status update above before the next blocking call —
    // otherwise all intermediate progress text is overwritten before any repaint.
    await yieldToPaint()

    const output = await synth(chunks[i]!)
    sampleRate = output.sampling_rate
    gapSamples = Math.round(sampleRate * 0.25)

    if (i > 0 && gapSamples > 0) {
      audioParts.push(new Float32Array(gapSamples))
    }
    audioParts.push(output.audio)
  }

  callbacks.onProgress?.(chunks.length, chunks.length)
  return { audio: concatFloat32(audioParts), sampleRate }
}

// Let the browser render pending DOM updates (e.g. progress text) before the
// next synchronous WASM call. rAF (double) ensures a paint; falls back to a
// macrotask when rAF is unavailable (e.g. non-browser test envs).
function yieldToPaint(): Promise<void> {
  if (typeof requestAnimationFrame === 'function') {
    return new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    )
  }
  return new Promise<void>((resolve) => setTimeout(resolve, 0))
}

// Encode mono Float32 PCM samples ([-1, 1]) into a 16-bit PCM WAV Blob.
export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const numChannels = 1
  const bytesPerSample = 2 // 16-bit
  const blockAlign = numChannels * bytesPerSample
  const byteRate = sampleRate * blockAlign
  const dataSize = samples.length * bytesPerSample

  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  const writeString = (offset: number, value: string): void => {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(offset + i, value.charCodeAt(i))
    }
  }

  // RIFF header
  writeString(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeString(8, 'WAVE')

  // fmt chunk
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true) // PCM chunk size
  view.setUint16(20, 1, true) // audio format = PCM
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bytesPerSample * 8, true) // bits per sample

  // data chunk
  writeString(36, 'data')
  view.setUint32(40, dataSize, true)

  // PCM samples
  let offset = 44
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i] ?? 0))
    const value = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff
    view.setInt16(offset, value, true)
    offset += 2
  }

  return new Blob([buffer], { type: 'audio/wav' })
}

// Convenience: synthesize text and return a ready-to-download WAV Blob.
export async function synthesizeToWav(
  text: string,
  languageCode: string,
  onStatus?: (message: string) => void,
): Promise<Blob> {
  const { audio, sampleRate } = await synthesizeToSamples(text, languageCode, onStatus)
  return encodeWav(audio, sampleRate)
}
