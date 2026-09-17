import type { LanguageOption, WhisperModelSize } from './types'

export const LANGUAGE_OPTIONS: LanguageOption[] = [
  { code: 'en-US', label: 'English (US)', whisper: 'english' },
  { code: 'en-GB', label: 'English (UK)', whisper: 'english' },
  { code: 'ja-JP', label: 'Japanese', whisper: 'japanese' },
  { code: 'zh-CN', label: 'Chinese (Simplified)', whisper: 'chinese' },
  { code: 'zh-TW', label: 'Chinese (Traditional)', whisper: 'chinese' },
  { code: 'ko-KR', label: 'Korean', whisper: 'korean' },
  { code: 'es-ES', label: 'Spanish (Spain)', whisper: 'spanish' },
  { code: 'es-MX', label: 'Spanish (Mexico)', whisper: 'spanish' },
  { code: 'fr-FR', label: 'French', whisper: 'french' },
  { code: 'de-DE', label: 'German', whisper: 'german' },
  { code: 'pt-BR', label: 'Portuguese (Brazil)', whisper: 'portuguese' },
  { code: 'pt-PT', label: 'Portuguese (Portugal)', whisper: 'portuguese' },
  { code: 'it-IT', label: 'Italian', whisper: 'italian' },
  { code: 'ru-RU', label: 'Russian', whisper: 'russian' },
  { code: 'hi-IN', label: 'Hindi', whisper: 'hindi' },
  { code: 'ar-SA', label: 'Arabic', whisper: 'arabic' },
  { code: 'nl-NL', label: 'Dutch', whisper: 'dutch' },
  { code: 'pl-PL', label: 'Polish', whisper: 'polish' },
  { code: 'tr-TR', label: 'Turkish', whisper: 'turkish' },
  { code: 'vi-VN', label: 'Vietnamese', whisper: 'vietnamese' },
  { code: 'th-TH', label: 'Thai', whisper: 'thai' },
  { code: 'id-ID', label: 'Indonesian', whisper: 'indonesian' },
  { code: 'sv-SE', label: 'Swedish', whisper: 'swedish' },
  { code: 'auto', label: 'Auto-detect (Whisper)', whisper: null },
]

export const WHISPER_MODEL_OPTIONS: Array<{
  size: WhisperModelSize
  label: string
  hint: string
}> = [
  { size: 'tiny', label: 'Tiny', hint: 'Fastest, lower accuracy' },
  { size: 'base', label: 'Base', hint: 'Balanced' },
  { size: 'small', label: 'Small', hint: 'Best quality, slower' },
]

export function findLanguage(code: string): LanguageOption {
  return LANGUAGE_OPTIONS.find((item) => item.code === code) ?? LANGUAGE_OPTIONS[0]!
}

export function defaultLanguageCode(): string {
  const nav = navigator.language || 'en-US'
  const exact = LANGUAGE_OPTIONS.find((item) => item.code === nav)
  if (exact) return exact.code
  const prefix = nav.split('-')[0]
  const loose = LANGUAGE_OPTIONS.find((item) => item.code.startsWith(`${prefix}-`))
  return loose?.code ?? 'en-US'
}

export function webSpeechLang(code: string): string {
  if (code === 'auto') return navigator.language || 'en-US'
  return code
}
