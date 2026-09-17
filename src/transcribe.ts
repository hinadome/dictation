import { findLanguage } from './languages'
import type { WhisperModelSize } from './types'

type TranscribeOptions = {
  language?: string
  task?: 'transcribe' | 'translate'
}

type Transcriber = (
  audio: Float32Array,
  options?: TranscribeOptions,
) => Promise<{
  text?: string
}>

interface TranscriptionConfig {
  modelSize: WhisperModelSize
  languageCode: string
}

let config: TranscriptionConfig = {
  modelSize: 'tiny',
  languageCode: 'en-US',
}

let loadedModelId: string | null = null
let transcriberPromise: Promise<Transcriber> | null = null
let modelReady = false

export function isTranscriberReady(): boolean {
  return modelReady
}

export function getTranscriptionConfig(): TranscriptionConfig {
  return { ...config }
}

export function configureTranscription(next: Partial<TranscriptionConfig>): void {
  const modelSize = next.modelSize ?? config.modelSize
  const languageCode = next.languageCode ?? config.languageCode
  const nextModelId = resolveModelId(modelSize, languageCode)

  config = { modelSize, languageCode }

  if (loadedModelId && loadedModelId !== nextModelId) {
    transcriberPromise = null
    loadedModelId = null
    modelReady = false
  }
}

export function resolveModelId(modelSize: WhisperModelSize, languageCode: string): string {
  const language = findLanguage(languageCode)
  const englishOnly = language.whisper === 'english'
  // English-only checkpoints are smaller/faster when dictating English.
  if (englishOnly) return `Xenova/whisper-${modelSize}.en`
  return `Xenova/whisper-${modelSize}`
}

async function getTranscriber(onStatus?: (message: string) => void): Promise<Transcriber> {
  const modelId = resolveModelId(config.modelSize, config.languageCode)

  if (!transcriberPromise || loadedModelId !== modelId) {
    loadedModelId = modelId
    modelReady = false
    transcriberPromise = (async () => {
      onStatus?.(`Downloading ${modelId} (cached after first time)…`)
      const { pipeline } = await import('@huggingface/transformers')
      onStatus?.(`Initializing ${config.modelSize} model…`)
      const transcriber = (await pipeline('automatic-speech-recognition', modelId, {
        dtype: 'q8',
      })) as unknown as Transcriber
      modelReady = true
      onStatus?.(`Speech model ready (${config.modelSize}).`)
      return transcriber
    })().catch((error) => {
      transcriberPromise = null
      loadedModelId = null
      modelReady = false
      throw error
    })
  }

  return transcriberPromise
}

async function blobToMono16k(blob: Blob): Promise<Float32Array> {
  const buffer = await blob.arrayBuffer()
  if (buffer.byteLength < 64) return new Float32Array()

  const context = new AudioContext()
  try {
    const decoded = await context.decodeAudioData(buffer.slice(0))
    const mixed = mixToMono(decoded)
    return resample(mixed, decoded.sampleRate, 16000)
  } finally {
    await context.close()
  }
}

function mixToMono(buffer: AudioBuffer): Float32Array {
  const channels = buffer.numberOfChannels
  const length = buffer.length
  const output = new Float32Array(length)

  for (let channel = 0; channel < channels; channel += 1) {
    const data = buffer.getChannelData(channel)
    for (let i = 0; i < length; i += 1) {
      output[i] += data[i] / channels
    }
  }

  return output
}

function resample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input

  const ratio = fromRate / toRate
  const outputLength = Math.max(1, Math.round(input.length / ratio))
  const output = new Float32Array(outputLength)

  for (let i = 0; i < outputLength; i += 1) {
    const position = i * ratio
    const index = Math.floor(position)
    const fraction = position - index
    const current = input[index] ?? 0
    const next = input[index + 1] ?? current
    output[i] = current + (next - current) * fraction
  }

  return output
}

export async function transcribeAudioBlob(
  blob: Blob,
  onStatus?: (message: string) => void,
): Promise<string> {
  const audio = await blobToMono16k(blob)
  if (audio.length < 1600) return ''
  return runTranscription(audio, onStatus)
}

export async function transcribePcm(
  samples: Float32Array,
  sampleRate: number,
  onStatus?: (message: string) => void,
): Promise<string> {
  if (samples.length < Math.floor(sampleRate * 0.1)) return ''
  const audio = resample(samples, sampleRate, 16000)
  if (audio.length < 1600) return ''
  return runTranscription(audio, onStatus)
}

async function runTranscription(
  audio: Float32Array,
  onStatus?: (message: string) => void,
): Promise<string> {
  const modelId = resolveModelId(config.modelSize, config.languageCode)
  const transcriber = await getTranscriber(onStatus)

  // English-only checkpoints (.en) reject `language` / `task` options.
  const englishOnlyModel = modelId.endsWith('.en')
  let result: { text?: string }

  if (englishOnlyModel) {
    result = await transcriber(audio)
  } else {
    const whisperLang = findLanguage(config.languageCode).whisper
    const options: TranscribeOptions = { task: 'transcribe' }
    if (whisperLang) options.language = whisperLang
    result = await transcriber(audio, options)
  }

  return (result.text ?? '').trim()
}

export async function preloadTranscriber(
  onStatus?: (message: string) => void,
): Promise<void> {
  await getTranscriber(onStatus)
}
