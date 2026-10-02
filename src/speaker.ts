export interface SpeakerVoice {
  id: string
  name: string
  lang: string
}

function getSynthesis(): SpeechSynthesis | null {
  return 'speechSynthesis' in window ? window.speechSynthesis : null
}

export function isSpeakerSupported(): boolean {
  return getSynthesis() !== null
}

export function listVoices(): SpeakerVoice[] {
  const synthesis = getSynthesis()
  if (!synthesis) return []

  return synthesis.getVoices().map((voice) => ({
    id: `${voice.name}::${voice.lang}`,
    name: voice.name,
    lang: voice.lang,
  }))
}

export function whenVoicesReady(): Promise<SpeakerVoice[]> {
  const voices = listVoices()
  if (voices.length > 0) return Promise.resolve(voices)

  const synthesis = getSynthesis()
  if (!synthesis) return Promise.resolve([])

  return new Promise((resolve) => {
    const done = () => resolve(listVoices())
    synthesis.addEventListener('voiceschanged', done, { once: true })
    window.setTimeout(done, 500)
  })
}

export interface SpeakOptions {
  voiceId?: string
  rate?: number
  pitch?: number
  onDone?: () => void
  onError?: (message: string) => void
}

export class SpeakerPlayback {
  private speaking = false

  get isSpeaking(): boolean {
    return this.speaking
  }

  speak(text: string, options: string | SpeakOptions = {}): void {
    const synthesis = getSynthesis()
    if (!synthesis) return

    const trimmed = text.trim()
    if (!trimmed) return

    const opts: SpeakOptions = typeof options === 'string' ? { voiceId: options } : options

    this.stop()
    const utterance = new SpeechSynthesisUtterance(trimmed)
    utterance.rate = clamp(opts.rate ?? 1, 0.5, 2)
    utterance.pitch = clamp(opts.pitch ?? 1, 0, 2)

    if (opts.voiceId) {
      const match = synthesis
        .getVoices()
        .find((voice) => `${voice.name}::${voice.lang}` === opts.voiceId)
      if (match) utterance.voice = match
    }

    utterance.onstart = () => {
      this.speaking = true
    }
    utterance.onend = () => {
      this.speaking = false
      opts.onDone?.()
    }
    utterance.onerror = (event) => {
      this.speaking = false
      // 'canceled'/'interrupted' happen on normal stop(); don't surface them.
      if (event.error && event.error !== 'canceled' && event.error !== 'interrupted') {
        opts.onError?.(event.error)
      }
      opts.onDone?.()
    }

    synthesis.speak(utterance)
  }

  stop(): void {
    const synthesis = getSynthesis()
    if (!synthesis) return
    synthesis.cancel()
    this.speaking = false
  }
}

function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min
  return Math.min(max, Math.max(min, value))
}
