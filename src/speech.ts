export interface SpeechCallbacks {
  onInterim: (text: string) => void
  onFinal: (text: string) => void
  onError: (message: string) => void
  onEnd: () => void
}

interface SpeechRecognitionAlternativeLike {
  transcript: string
}

interface SpeechRecognitionResultLike {
  isFinal: boolean
  0: SpeechRecognitionAlternativeLike
}

interface SpeechRecognitionEventLike {
  resultIndex: number
  results: ArrayLike<SpeechRecognitionResultLike>
}

interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean
  interimResults: boolean
  lang: string
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike

function getSpeechRecognitionCtor(): SpeechRecognitionConstructor | null {
  const win = window as Window & {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }
  return win.SpeechRecognition ?? win.webkitSpeechRecognition ?? null
}

export function isSpeechSupported(): boolean {
  return getSpeechRecognitionCtor() !== null
}

export class DictationEngine {
  private recognition: SpeechRecognitionLike | null = null
  private intentionalStop = false
  private active = false
  private readonly callbacks: SpeechCallbacks

  constructor(callbacks: SpeechCallbacks) {
    this.callbacks = callbacks
  }

  get isListening(): boolean {
    return this.active
  }

  start(lang = 'en-US'): void {
    const Ctor = getSpeechRecognitionCtor()
    if (!Ctor) {
      this.callbacks.onError('Speech recognition is not supported in this browser. Try Chrome or Edge.')
      return
    }

    this.stop()
    this.intentionalStop = false
    this.recognition = new Ctor()
    this.recognition.continuous = true
    this.recognition.interimResults = true
    this.recognition.lang = lang

    this.recognition.onresult = (event) => {
      let interim = ''
      let finalChunk = ''

      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i]
        const transcript = result[0]?.transcript ?? ''
        if (result.isFinal) {
          finalChunk += transcript
        } else {
          interim += transcript
        }
      }

      if (finalChunk) this.callbacks.onFinal(finalChunk)
      this.callbacks.onInterim(interim)
    }

    this.recognition.onerror = (event) => {
      if (event.error === 'aborted' || event.error === 'no-speech') return
      if (event.error === 'not-allowed') {
        this.callbacks.onError('Microphone access was denied. Allow mic permission and try again.')
        return
      }
      this.callbacks.onError(`Speech recognition error: ${event.error}`)
    }

    this.recognition.onend = () => {
      // Chrome ends recognition periodically; restart while user still wants to listen.
      if (this.active && !this.intentionalStop && this.recognition) {
        try {
          this.recognition.start()
          return
        } catch {
          // fall through to idle
        }
      }
      this.active = false
      this.callbacks.onEnd()
    }

    try {
      this.recognition.start()
      this.active = true
    } catch {
      this.active = false
      this.callbacks.onError('Could not start the microphone. Check permissions and try again.')
    }
  }

  stop(): void {
    this.intentionalStop = true
    this.active = false
    if (!this.recognition) return
    try {
      this.recognition.stop()
    } catch {
      // already stopped
    }
    this.recognition = null
  }
}
