export type WhisperModelSize = 'tiny' | 'base' | 'small'

export type AudioSource = 'microphone' | 'system'
export type SystemCaptureMode = 'share' | 'loopback'

export interface TranscriptSession {
  id: string
  title: string
  text: string
  createdAt: number
  updatedAt: number
}

export type ListeningState = 'idle' | 'listening' | 'unsupported' | 'denied'

export interface AudioDeviceOption {
  deviceId: string
  label: string
  loopbackLikely?: boolean
}

export interface LanguageOption {
  /** BCP-47 tag for Web Speech API */
  code: string
  label: string
  /** Whisper language name; null means let the model auto-detect */
  whisper: string | null
}
