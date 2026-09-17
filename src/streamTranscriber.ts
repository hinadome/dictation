import { preloadTranscriber, transcribePcm } from './transcribe'

export interface StreamRecorderCallbacks {
  onInterim: (text: string) => void
  onFinal: (text: string) => void
  onError: (message: string) => void
  onStatus?: (message: string) => void
  onLevel?: (level: number) => void
  onPhase?: (phase: CapturePhase) => void
}

export type CapturePhase =
  | 'idle'
  | 'recording'
  | 'loading-model'
  | 'transcribing'
  | 'waiting-audio'

const SEGMENT_MS = 4000

/**
 * Captures PCM from a live MediaStream via Web Audio and transcribes segments.
 * Avoids MediaRecorder rotate/restart issues that break loopback capture.
 */
export class StreamTranscriber {
  private sourceStream: MediaStream | null = null
  private active = false
  private segmentTimer: number | undefined
  private levelTimer: number | undefined
  private quietSeconds = 0
  private heardAudio = false
  private audioContext: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private processor: ScriptProcessorNode | null = null
  private sourceNode: MediaStreamAudioSourceNode | null = null
  private pendingPcm: Float32Array[] = []
  private pendingSamples = 0
  private transcribeBusy = false
  private readonly callbacks: StreamRecorderCallbacks

  constructor(callbacks: StreamRecorderCallbacks) {
    this.callbacks = callbacks
  }

  get isActive(): boolean {
    return this.active
  }

  start(sourceStream: MediaStream): void {
    this.stop(false)

    const audioTracks = sourceStream.getAudioTracks().filter((track) => track.readyState === 'live')
    if (audioTracks.length === 0) {
      this.callbacks.onError('No live audio track on the selected source.')
      return
    }

    this.sourceStream = sourceStream
    this.active = true
    this.quietSeconds = 0
    this.heardAudio = false
    this.pendingPcm = []
    this.pendingSamples = 0
    this.transcribeBusy = false

    const label = audioTracks[0]?.label || 'audio input'
    this.callbacks.onPhase?.('recording')
    this.callbacks.onStatus?.(`Recording “${label}”. First transcript in a few seconds…`)

    try {
      this.setupAudioGraph(new MediaStream(audioTracks))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Audio graph failed'
      this.callbacks.onError(`Could not capture audio: ${message}`)
      this.stop(false)
      return
    }

    this.segmentTimer = window.setInterval(() => {
      void this.flushSegment()
    }, SEGMENT_MS)
  }

  stop(stopSourceTracks = true): void {
    if (!this.active && !this.sourceStream && !this.audioContext) {
      this.callbacks.onPhase?.('idle')
      return
    }

    this.active = false
    window.clearInterval(this.segmentTimer)
    this.segmentTimer = undefined
    this.teardownAudioGraph()
    this.pendingPcm = []
    this.pendingSamples = 0

    if (stopSourceTracks) {
      this.sourceStream?.getTracks().forEach((track) => track.stop())
    }
    this.sourceStream = null
    this.callbacks.onInterim('')
    this.callbacks.onLevel?.(0)
    this.callbacks.onPhase?.('idle')
  }

  private setupAudioGraph(stream: MediaStream): void {
    const context = new AudioContext()
    this.audioContext = context
    void context.resume()

    this.sourceNode = context.createMediaStreamSource(stream)
    this.analyser = context.createAnalyser()
    this.analyser.fftSize = 2048

    // ScriptProcessor is deprecated but reliable for PCM tap in all Chromium builds.
    const bufferSize = 4096
    this.processor = context.createScriptProcessor(bufferSize, 1, 1)
    this.processor.onaudioprocess = (event) => {
      if (!this.active) return
      const input = event.inputBuffer.getChannelData(0)
      this.pendingPcm.push(new Float32Array(input))
      this.pendingSamples += input.length
    }

    this.sourceNode.connect(this.analyser)
    this.sourceNode.connect(this.processor)
    // Processor must connect somewhere to run; silent gain keeps it off the speakers.
    const mute = context.createGain()
    mute.gain.value = 0
    this.processor.connect(mute)
    mute.connect(context.destination)

    const data = new Uint8Array(this.analyser.frequencyBinCount)
    this.levelTimer = window.setInterval(() => {
      if (!this.analyser) return
      this.analyser.getByteTimeDomainData(data)
      let sum = 0
      for (let i = 0; i < data.length; i += 1) {
        const centered = (data[i] ?? 128) - 128
        sum += centered * centered
      }
      const rms = Math.sqrt(sum / data.length) / 128
      const level = Math.min(1, rms * 4)
      this.callbacks.onLevel?.(level)

      if (level > 0.03) {
        this.heardAudio = true
        this.quietSeconds = 0
      } else {
        this.quietSeconds += 0.1
      }

      if (!this.heardAudio && this.quietSeconds >= 4) {
        this.callbacks.onPhase?.('waiting-audio')
        this.callbacks.onStatus?.(
          'Connected, but little/no audio yet. For loopback: set Multi-Output (Speakers + BlackHole) as system output, and select BlackHole as the loopback input.',
        )
      }
    }, 100)
  }

  private teardownAudioGraph(): void {
    window.clearInterval(this.levelTimer)
    this.levelTimer = undefined

    try {
      this.processor?.disconnect()
      this.sourceNode?.disconnect()
      this.analyser?.disconnect()
    } catch {
      // already disconnected
    }
    this.processor = null
    this.sourceNode = null
    this.analyser = null

    void this.audioContext?.close()
    this.audioContext = null
  }

  private async flushSegment(): Promise<void> {
    if (!this.active || this.transcribeBusy) return
    if (this.pendingSamples < 1600) return

    const sampleRate = this.audioContext?.sampleRate ?? 48000
    const merged = mergePcm(this.pendingPcm, this.pendingSamples)
    this.pendingPcm = []
    this.pendingSamples = 0

    // Skip near-silent segments so Whisper is not hammered with noise.
    if (rmsOf(merged) < 0.008) {
      this.callbacks.onStatus?.(
        this.heardAudio
          ? 'Listening… (quiet segment skipped)'
          : 'Listening… waiting for louder audio on the loopback/share input.',
      )
      return
    }

    this.transcribeBusy = true
    this.callbacks.onPhase?.('transcribing')
    this.callbacks.onInterim('Transcribing…')
    this.callbacks.onStatus?.('Transcribing captured audio…')

    try {
      const text = await transcribePcm(merged, sampleRate, (message) => {
        this.callbacks.onPhase?.('loading-model')
        this.callbacks.onStatus?.(message)
      })
      if (!this.active) return

      this.callbacks.onInterim('')
      if (text) {
        this.callbacks.onFinal(text)
        this.callbacks.onPhase?.('recording')
        this.callbacks.onStatus?.('Listening…')
      } else {
        this.callbacks.onPhase?.('recording')
        this.callbacks.onStatus?.(
          this.heardAudio
            ? 'Heard audio, but no clear speech in that segment.'
            : 'No speech detected yet.',
        )
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Transcription failed'
      // Non-fatal: keep capturing; surface the message without tearing down the session.
      this.callbacks.onStatus?.(`Transcription issue: ${message}`)
      this.callbacks.onPhase?.('recording')
      this.callbacks.onInterim('')
    } finally {
      this.transcribeBusy = false
    }
  }
}

export async function ensureModelLoaded(
  onStatus?: (message: string) => void,
): Promise<void> {
  await preloadTranscriber(onStatus)
}

function mergePcm(chunks: Float32Array[], totalSamples: number): Float32Array {
  const output = new Float32Array(totalSamples)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.length
  }
  return output
}

function rmsOf(samples: Float32Array): number {
  if (samples.length === 0) return 0
  let sum = 0
  for (let i = 0; i < samples.length; i += 1) {
    const value = samples[i] ?? 0
    sum += value * value
  }
  return Math.sqrt(sum / samples.length)
}
