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

export class SpeakerPlayback {
  private speaking = false

  get isSpeaking(): boolean {
    return this.speaking
  }

  speak(text: string, voiceId?: string): void {
    const synthesis = getSynthesis()
    if (!synthesis) return

    const trimmed = text.trim()
    if (!trimmed) return

    this.stop()
    const utterance = new SpeechSynthesisUtterance(trimmed)
    utterance.rate = 1
    utterance.pitch = 1

    if (voiceId) {
      const match = synthesis.getVoices().find((voice) => `${voice.name}::${voice.lang}` === voiceId)
      if (match) utterance.voice = match
    }

    utterance.onstart = () => {
      this.speaking = true
    }
    utterance.onend = () => {
      this.speaking = false
    }
    utterance.onerror = () => {
      this.speaking = false
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
