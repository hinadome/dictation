import type { SystemCaptureMode, WhisperModelSize } from './types'
import { configureTranscription } from './transcribe'
import {
  ensureModelLoaded,
  StreamTranscriber,
  type StreamRecorderCallbacks,
} from './streamTranscriber'

export type SystemAudioCallbacks = StreamRecorderCallbacks & {
  onEnd: () => void
}

type DisplayAudioOptions = DisplayMediaStreamOptions & {
  systemAudio?: 'include' | 'exclude'
  windowAudio?: 'system' | 'window' | 'exclude'
  preferCurrentTab?: boolean
  selfBrowserSurface?: 'include' | 'exclude'
  monitorTypeSurfaces?: 'include' | 'exclude'
}

export class SystemAudioCapture {
  private stream: MediaStream | null = null
  private monitor: HTMLAudioElement | null = null
  private transcriber: StreamTranscriber
  private readonly callbacks: SystemAudioCallbacks
  private intentionalStop = false

  constructor(callbacks: SystemAudioCallbacks) {
    this.callbacks = callbacks
    this.transcriber = new StreamTranscriber(callbacks)
  }

  get isCapturing(): boolean {
    return this.transcriber.isActive
  }

  async start(options: {
    mode: SystemCaptureMode
    deviceId?: string
    monitor?: boolean
    outputDeviceId?: string
    languageCode: string
    whisperModel: WhisperModelSize
  }): Promise<void> {
    this.reset()

    configureTranscription({
      modelSize: options.whisperModel,
      languageCode: options.languageCode,
    })

    try {
      this.stream =
        options.mode === 'loopback'
          ? await this.openLoopback(options.deviceId)
          : await this.openDisplayAudio(Boolean(options.monitor))
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'System audio capture was cancelled or blocked.'
      this.callbacks.onError(message)
      this.callbacks.onEnd()
      return
    }

    const audioTracks = this.stream.getAudioTracks()
    if (audioTracks.length === 0) {
      this.stream.getTracks().forEach((track) => track.stop())
      this.stream = null
      this.callbacks.onError(
        options.mode === 'loopback'
          ? 'No audio received from the selected input. Pick a loopback device (e.g. BlackHole).'
          : 'Share succeeded for video, but no audio track was included. Click Start again and enable “Share audio”.',
      )
      this.callbacks.onEnd()
      return
    }

    this.intentionalStop = false
    for (const track of audioTracks) {
      track.addEventListener('ended', () => {
        if (this.intentionalStop) return
        this.stop()
      })
    }

    const label = audioTracks[0]?.label || 'shared audio'
    this.callbacks.onStatus?.(
      `Connected to “${label}”. Preparing Whisper ${options.whisperModel}…`,
    )
    this.callbacks.onPhase?.('loading-model')

    try {
      await ensureModelLoaded((message) => this.callbacks.onStatus?.(message))
    } catch (error) {
      this.intentionalStop = true
      this.stream.getTracks().forEach((track) => track.stop())
      this.stream = null
      const message = error instanceof Error ? error.message : 'Model load failed'
      this.callbacks.onError(`Could not load speech model: ${message}`)
      this.callbacks.onEnd()
      return
    }

    // Monitoring loopback through speakers often re-enters the same virtual device and
    // causes feedback / unstable capture. Keep monitor off unless explicitly useful.
    if (options.monitor && options.mode !== 'loopback') {
      await this.startMonitor(this.stream, options.outputDeviceId)
    } else if (options.monitor && options.mode === 'loopback') {
      this.callbacks.onStatus?.(
        `Listening on “${label}” (monitor disabled for loopback to avoid feedback).`,
      )
    }

    this.callbacks.onStatus?.(
      `Listening to “${label}” with Whisper ${options.whisperModel}. Text should appear every few seconds.`,
    )
    this.transcriber.start(this.stream)
  }

  stop(): void {
    const wasActive = this.transcriber.isActive || Boolean(this.stream)
    this.reset()
    if (wasActive) this.callbacks.onEnd()
  }

  async setMonitorOutput(deviceId: string | undefined, enabled: boolean): Promise<void> {
    if (!this.stream || !enabled) {
      this.stopMonitor()
      return
    }
    await this.startMonitor(this.stream, deviceId)
  }

  private reset(): void {
    this.intentionalStop = true
    // Capture owns track lifecycle; transcriber only tears down its audio graph.
    this.transcriber.stop(false)
    this.stopMonitor()
    this.stream?.getTracks().forEach((track) => {
      try {
        track.stop()
      } catch {
        // already stopped
      }
    })
    this.stream = null
  }

  private async openLoopback(deviceId?: string): Promise<MediaStream> {
    this.callbacks.onStatus?.(
      'Opening loopback input… route other apps into this device (e.g. BlackHole).',
    )

    const audio: boolean | MediaTrackConstraints = deviceId
      ? {
          deviceId: { exact: deviceId },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 2,
        }
      : {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 2,
        }

    try {
      return await navigator.mediaDevices.getUserMedia({ audio, video: false })
    } catch (error) {
      // Fallback if exact deviceId fails (device unplugged / id stale).
      if (deviceId) {
        this.callbacks.onStatus?.('Selected loopback device unavailable, trying default input…')
        return navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
          },
          video: false,
        })
      }
      throw error
    }
  }

  private async openDisplayAudio(monitor: boolean): Promise<MediaStream> {
    this.callbacks.onStatus?.(
      'Chrome share dialog open: pick a window or Entire Screen, turn ON Share audio, then Allow.',
    )

    const attempts: DisplayAudioOptions[] = [
      {
        video: {
          displaySurface: 'monitor',
        } as MediaTrackConstraints,
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          suppressLocalAudioPlayback: !monitor,
        } as MediaTrackConstraints,
        systemAudio: 'include',
        windowAudio: 'system',
        preferCurrentTab: false,
        selfBrowserSurface: 'exclude',
        monitorTypeSurfaces: 'include',
      },
      {
        video: true,
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          suppressLocalAudioPlayback: !monitor,
        } as MediaTrackConstraints,
        systemAudio: 'include',
        windowAudio: 'window',
        preferCurrentTab: false,
      },
      {
        video: true,
        audio: true,
        systemAudio: 'include',
      },
    ]

    let lastError: unknown
    for (const constraints of attempts) {
      try {
        return await navigator.mediaDevices.getDisplayMedia(constraints)
      } catch (error) {
        lastError = error
        if (isUserCancellation(error)) throw error
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error('Unable to open display/system audio capture.')
  }

  private async startMonitor(stream: MediaStream, outputDeviceId?: string): Promise<void> {
    this.stopMonitor()
    const audioTracks = stream.getAudioTracks()
    if (audioTracks.length === 0) return

    const audio = new Audio()
    audio.srcObject = new MediaStream(audioTracks)
    audio.autoplay = true

    if (outputDeviceId && 'setSinkId' in audio) {
      try {
        await (audio as HTMLAudioElement & { setSinkId: (id: string) => Promise<void> }).setSinkId(
          outputDeviceId,
        )
      } catch {
        // Default output is fine.
      }
    }

    try {
      await audio.play()
      this.monitor = audio
    } catch {
      this.callbacks.onStatus?.('Could not route monitor audio to speakers.')
    }
  }

  private stopMonitor(): void {
    if (!this.monitor) return
    this.monitor.pause()
    this.monitor.srcObject = null
    this.monitor = null
  }
}

function isUserCancellation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error.name === 'NotAllowedError' || error.name === 'AbortError')
  )
}
