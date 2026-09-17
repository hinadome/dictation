import './style.css'
import {
  canSelectOutputDevice,
  ensureAudioPermission,
  listInputDevices,
  listOutputDevices,
  preferLoopbackDevice,
} from './devices'
import {
  defaultLanguageCode,
  LANGUAGE_OPTIONS,
  webSpeechLang,
  WHISPER_MODEL_OPTIONS,
} from './languages'
import { DictationEngine, isSpeechSupported } from './speech'
import { isSpeakerSupported, listVoices, SpeakerPlayback, whenVoicesReady } from './speaker'
import {
  createSession,
  deleteSession,
  exportSessionAsText,
  listSessions,
  saveSession,
} from './storage'
import { SystemAudioCapture } from './systemAudio'
import type { CapturePhase } from './streamTranscriber'
import type {
  AudioDeviceOption,
  AudioSource,
  ListeningState,
  SystemCaptureMode,
  TranscriptSession,
  WhisperModelSize,
} from './types'

const PREFS_KEY = 'dictation-prefs'

interface Prefs {
  languageCode: string
  whisperModel: WhisperModelSize
}

const app = document.querySelector<HTMLDivElement>('#app')!

let sessions: TranscriptSession[] = []
let activeSession: TranscriptSession = createSession()
let interimText = ''
let listeningState: ListeningState = isSpeechSupported() ? 'idle' : 'unsupported'
let statusMessage = ''
let saveTimer: number | undefined
let audioSource: AudioSource = 'microphone'
let systemMode: SystemCaptureMode = 'share'
let inputDevices: AudioDeviceOption[] = []
let outputDevices: AudioDeviceOption[] = []
let selectedInputId = ''
let selectedLoopbackId = ''
let selectedOutputId = ''
let selectedVoiceId = ''
let selectedLanguageCode = defaultLanguageCode()
let selectedWhisperModel: WhisperModelSize = 'tiny'
let monitorSpeakers = false
let speaking = false
let audioLevel = 0
let capturePhase: CapturePhase = 'idle'

loadPrefs()

const appendFinalText = (text: string): void => {
  const piece = text.trim()
  if (!piece) return
  const needsSpace =
    activeSession.text.length > 0 && !/\s$/.test(activeSession.text) && !/^[.,!?;:]/.test(piece)
  activeSession.text += (needsSpace ? ' ' : '') + piece
  activeSession.updatedAt = Date.now()
  if (!activeSession.title || activeSession.title === 'Untitled session') {
    activeSession.title = activeSession.text.trim().slice(0, 48) || 'Untitled session'
  }
  interimText = ''
  renderLiveText()
  scheduleSave()
}

const sharedCallbacks = {
  onInterim: (text: string) => {
    interimText = text
    renderLiveText()
  },
  onFinal: appendFinalText,
  onError: (message: string) => {
    statusMessage = message
    const fatal =
      message.toLowerCase().includes('denied') ||
      message.toLowerCase().includes('blocked') ||
      message.toLowerCase().includes('cancelled') ||
      message.toLowerCase().includes('could not load') ||
      message.toLowerCase().includes('no audio') ||
      message.toLowerCase().includes('no live audio') ||
      message.toLowerCase().includes('could not capture')

    if (message.toLowerCase().includes('denied') || message.toLowerCase().includes('blocked')) {
      listeningState = 'denied'
      render()
      return
    }

    if (fatal && listeningState === 'listening') {
      listeningState = 'idle'
      render()
      return
    }

    // Soft errors: keep session alive, update status only.
    const status = document.querySelector<HTMLParagraphElement>('.status')
    if (status) status.textContent = message
  },
  onEnd: () => {
    if (listeningState === 'listening') listeningState = 'idle'
    interimText = ''
    audioLevel = 0
    capturePhase = 'idle'
    render()
  },
  onStatus: (message: string) => {
    statusMessage = message
    const status = document.querySelector<HTMLParagraphElement>('.status')
    if (status) status.textContent = message
    const phase = document.querySelector<HTMLParagraphElement>('#capture-phase')
    if (phase) phase.textContent = phaseLabel()
  },
  onLevel: (level: number) => {
    audioLevel = level
    updateMeter()
  },
  onPhase: (phase: CapturePhase) => {
    capturePhase = phase
    const el = document.querySelector<HTMLParagraphElement>('#capture-phase')
    if (el) el.textContent = phaseLabel()
  },
}

const engine = new DictationEngine(sharedCallbacks)
const systemCapture = new SystemAudioCapture(sharedCallbacks)
const speaker = new SpeakerPlayback()

function loadPrefs(): void {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (!raw) return
    const prefs = JSON.parse(raw) as Prefs
    if (LANGUAGE_OPTIONS.some((item) => item.code === prefs.languageCode)) {
      selectedLanguageCode = prefs.languageCode
    }
    if (prefs.whisperModel === 'tiny' || prefs.whisperModel === 'base' || prefs.whisperModel === 'small') {
      selectedWhisperModel = prefs.whisperModel
    }
  } catch {
    // ignore bad prefs
  }
}

function savePrefs(): void {
  const prefs: Prefs = {
    languageCode: selectedLanguageCode,
    whisperModel: selectedWhisperModel,
  }
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
}

function scheduleSave(): void {
  window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    void persistActive()
  }, 400)
}

async function persistActive(): Promise<void> {
  if (!activeSession.text.trim()) return
  activeSession.updatedAt = Date.now()
  await saveSession(activeSession)
  sessions = await listSessions()
  renderHistory()
}

async function refreshDevices(): Promise<void> {
  try {
    await ensureAudioPermission()
  } catch {
    // Labels may stay generic until permission is granted.
  }

  inputDevices = await listInputDevices()
  outputDevices = await listOutputDevices()

  if (!selectedInputId && inputDevices[0]) selectedInputId = inputDevices[0].deviceId
  if (!selectedLoopbackId) selectedLoopbackId = preferLoopbackDevice(inputDevices)
  if (!selectedOutputId && outputDevices[0]) selectedOutputId = outputDevices[0].deviceId

  const voices = await whenVoicesReady()
  if (!selectedVoiceId && voices[0]) selectedVoiceId = voices[0].id
}

async function bootstrap(): Promise<void> {
  sessions = await listSessions()
  await refreshDevices()
  render()

  navigator.mediaDevices?.addEventListener('devicechange', () => {
    void refreshDevices().then(() => {
      if (listeningState !== 'listening') render()
    })
  })
}

function formatTime(ts: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(ts))
}

function renderLiveText(): void {
  const live = document.querySelector<HTMLParagraphElement>('#live-text')
  const interim = document.querySelector<HTMLSpanElement>('#interim-text')
  if (live) live.textContent = activeSession.text || 'Speak to begin…'
  if (interim) interim.textContent = interimText
}

function updateMeter(): void {
  const bars = document.querySelectorAll<HTMLSpanElement>('.meter span')
  bars.forEach((bar, index) => {
    const threshold = (index + 1) / bars.length
    const active = audioLevel >= threshold * 0.15
    bar.style.height = active ? `${0.4 + audioLevel * 1.4}rem` : '0.4rem'
  })
}

function renderHistory(): void {
  const list = document.querySelector<HTMLUListElement>('#history-list')
  if (!list) return

  if (sessions.length === 0) {
    list.innerHTML = `<li class="empty">No saved sessions yet.</li>`
    return
  }

  list.innerHTML = sessions
    .map(
      (session) => `
      <li class="history-item ${session.id === activeSession.id ? 'active' : ''}" data-id="${session.id}">
        <button type="button" class="history-open" data-action="open" data-id="${session.id}">
          <span class="history-title">${escapeHtml(session.title)}</span>
          <span class="history-meta">${formatTime(session.updatedAt)}</span>
        </button>
        <div class="history-actions">
          <button type="button" data-action="export" data-id="${session.id}" title="Export .txt">Export</button>
          <button type="button" data-action="delete" data-id="${session.id}" title="Delete">Delete</button>
        </div>
      </li>`,
    )
    .join('')
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function stopCapture(): void {
  engine.stop()
  systemCapture.stop()
}

function micLabel(): string {
  if (listeningState === 'unsupported' && audioSource === 'microphone') return 'Unavailable'
  if (listeningState === 'denied') return 'Access blocked'
  if (listeningState === 'listening') return 'Stop'
  return 'Start'
}

function phaseLabel(): string {
  switch (capturePhase) {
    case 'loading-model':
      return `Step: loading Whisper ${selectedWhisperModel}`
    case 'recording':
      return 'Step: recording shared audio'
    case 'transcribing':
      return 'Step: converting audio → text'
    case 'waiting-audio':
      return 'Step: waiting for audible audio'
    default:
      return audioSource === 'system'
        ? 'Step: click Start, then Allow share with audio'
        : 'Step: click Start to dictate'
  }
}

function statusLabel(): string {
  if (statusMessage) return statusMessage
  if (audioSource === 'system') {
    if (listeningState === 'listening') {
      return systemMode === 'loopback'
        ? `Capturing loopback with Whisper ${selectedWhisperModel}…`
        : `Share connected. Whisper ${selectedWhisperModel} — text appears every few seconds.`
    }
    return systemMode === 'loopback'
      ? 'Ready. Select a loopback device, route apps into it, then press Start.'
      : 'Ready. Start → choose window/Entire Screen → enable Share audio → Allow.'
  }
  if (listeningState === 'unsupported') {
    return 'Speech recognition needs Chrome or Edge on this machine.'
  }
  if (listeningState === 'denied') return 'Allow microphone access to dictate.'
  if (listeningState === 'listening') {
    return `Listening (${webSpeechLang(selectedLanguageCode)})… text saves automatically.`
  }
  return 'Ready. Choose language, then Start. Whisper size applies to Other apps / speakers.'
}

function optionMarkup(devices: AudioDeviceOption[], selectedId: string): string {
  if (devices.length === 0) {
    return `<option value="">No devices found</option>`
  }
  return devices
    .map(
      (device) =>
        `<option value="${escapeHtml(device.deviceId)}" ${
          device.deviceId === selectedId ? 'selected' : ''
        }>${escapeHtml(device.loopbackLikely ? `${device.label} (loopback)` : device.label)}</option>`,
    )
    .join('')
}

function languageMarkup(): string {
  return LANGUAGE_OPTIONS.map(
    (language) =>
      `<option value="${escapeHtml(language.code)}" ${
        language.code === selectedLanguageCode ? 'selected' : ''
      }>${escapeHtml(language.label)}</option>`,
  ).join('')
}

function whisperMarkup(): string {
  return WHISPER_MODEL_OPTIONS.map(
    (model) =>
      `<option value="${model.size}" ${
        model.size === selectedWhisperModel ? 'selected' : ''
      }>${escapeHtml(`${model.label} — ${model.hint}`)}</option>`,
  ).join('')
}

function voiceMarkup(): string {
  const voices = listVoices()
  if (voices.length === 0) {
    return `<option value="">Default voice</option>`
  }
  return voices
    .map(
      (voice) =>
        `<option value="${escapeHtml(voice.id)}" ${
          voice.id === selectedVoiceId ? 'selected' : ''
        }>${escapeHtml(`${voice.name} (${voice.lang})`)}</option>`,
    )
    .join('')
}

function render(): void {
  const listening = listeningState === 'listening'
  const startDisabled =
    (audioSource === 'microphone' && listeningState === 'unsupported') || false
  const showLoopbackSelect = audioSource === 'system' && systemMode === 'loopback'
  const hasLoopback = inputDevices.some((device) => device.loopbackLikely)
  const settingsLocked = listening

  app.innerHTML = `
    <div class="shell ${listening ? 'is-listening' : ''}">
      <header class="brand">
        <p class="brand-mark">Dictation</p>
        <p class="brand-sub">Mic or other-app audio, saved on this device</p>
      </header>

      <main class="stage">
        <section class="composer" aria-label="Live dictation">
          <div class="source-bar" role="group" aria-label="Audio source">
            <button type="button" class="source-btn ${audioSource === 'microphone' ? 'active' : ''}" data-source="microphone" ${settingsLocked ? 'disabled' : ''}>Microphone</button>
            <button type="button" class="source-btn ${audioSource === 'system' ? 'active' : ''}" data-source="system" ${settingsLocked ? 'disabled' : ''}>Other apps / speakers</button>
          </div>

          ${
            audioSource === 'system'
              ? `<div class="source-bar mode-bar" role="group" aria-label="Capture method">
                  <button type="button" class="source-btn ${systemMode === 'share' ? 'active' : ''}" data-mode="share" ${settingsLocked ? 'disabled' : ''}>Share app / screen</button>
                  <button type="button" class="source-btn ${systemMode === 'loopback' ? 'active' : ''}" data-mode="loopback" ${settingsLocked ? 'disabled' : ''}>Loopback device</button>
                </div>
                <p class="hint">${
                  systemMode === 'share'
                    ? 'After you click Allow: the Start button stays red, the meter should bounce if audio is flowing, then transcript lines appear every ~4 seconds. First run also downloads a speech model (can take up to a minute).'
                    : hasLoopback
                      ? 'Loopback device detected. Set that device as the Mac output (or Multi-Output), then Start.'
                      : 'Install BlackHole (macOS) or VB-Cable (Windows), create a Multi-Output device with Speakers + loopback, then select the loopback input here.'
                }</p>`
              : ''
          }

          <p id="capture-phase" class="phase">${escapeHtml(phaseLabel())}</p>

          <div class="device-grid">
            <label class="field">
              <span>Language</span>
              <select id="language-select" ${settingsLocked ? 'disabled' : ''}>
                ${languageMarkup()}
              </select>
            </label>
            <label class="field">
              <span>Whisper model</span>
              <select id="whisper-model" ${settingsLocked || audioSource !== 'system' ? 'disabled' : ''}>
                ${whisperMarkup()}
              </select>
            </label>
            <label class="field">
              <span>${showLoopbackSelect ? 'Loopback input' : 'Input'}</span>
              <select id="input-device" ${audioSource === 'system' && systemMode === 'share' || settingsLocked ? 'disabled' : ''}>
                ${
                  audioSource === 'system' && systemMode === 'share'
                    ? '<option value="">Shared window / system audio</option>'
                    : optionMarkup(
                        inputDevices,
                        showLoopbackSelect ? selectedLoopbackId : selectedInputId,
                      )
                }
              </select>
            </label>
            <label class="field">
              <span>Speaker output</span>
              <select id="output-device" ${canSelectOutputDevice() && !settingsLocked ? '' : 'disabled'}>
                ${
                  canSelectOutputDevice()
                    ? optionMarkup(outputDevices, selectedOutputId)
                    : '<option value="">System default speaker</option>'
                }
              </select>
            </label>
            <label class="field">
              <span>Read-aloud voice</span>
              <select id="voice-select" ${isSpeakerSupported() && !settingsLocked ? '' : 'disabled'}>
                ${voiceMarkup()}
              </select>
            </label>
            <label class="check-field ${audioSource === 'system' && systemMode !== 'loopback' ? '' : 'is-disabled'}">
              <input id="monitor-speakers" type="checkbox" ${monitorSpeakers ? 'checked' : ''} ${
                audioSource === 'system' && systemMode !== 'loopback' && !settingsLocked
                  ? ''
                  : 'disabled'
              } />
              <span>Monitor captured audio through speakers${
                systemMode === 'loopback' ? ' (disabled for loopback)' : ''
              }</span>
            </label>
          </div>
          <p class="hint">
            Language applies to mic (Web Speech) and Whisper.
            Whisper model is used only for Other apps / speakers; larger models need a bigger one-time download.
          </p>

          <div class="meter" aria-hidden="true">
            <span></span><span></span><span></span><span></span><span></span>
          </div>

          <div class="transcript-panel">
            <p id="live-text" class="final-text">${escapeHtml(activeSession.text) || 'Speak to begin…'}</p>
            <span id="interim-text" class="interim-text">${escapeHtml(interimText)}</span>
          </div>

          <div class="controls">
            <button
              type="button"
              id="toggle-mic"
              class="mic-btn ${listening ? 'recording' : ''}"
              ${startDisabled ? 'disabled' : ''}
            >
              <span class="mic-orb"></span>
              <span class="mic-label">${micLabel()}</span>
            </button>
            <div class="control-row">
              <button type="button" id="speak-text" class="ghost" ${
                activeSession.text.trim() && isSpeakerSupported() ? '' : 'disabled'
              }>${speaking ? 'Stop voice' : 'Speak'}</button>
              <button type="button" id="new-session" class="ghost">New</button>
              <button type="button" id="copy-text" class="ghost" ${activeSession.text.trim() ? '' : 'disabled'}>Copy</button>
              <button type="button" id="export-active" class="ghost" ${activeSession.text.trim() ? '' : 'disabled'}>Export</button>
            </div>
          </div>

          <p class="status" role="status">${escapeHtml(statusLabel())}</p>
        </section>

        <aside class="history" aria-label="Saved sessions">
          <div class="history-head">
            <h2>Saved locally</h2>
            <p>IndexedDB on this browser</p>
          </div>
          <ul id="history-list" class="history-list"></ul>
        </aside>
      </main>
    </div>
  `

  renderHistory()
  updateMeter()
  bindEvents()
}

function bindEvents(): void {
  document.querySelectorAll<HTMLButtonElement>('[data-source]').forEach((button) => {
    button.addEventListener('click', () => {
      if (listeningState === 'listening') return
      const source = button.dataset.source as AudioSource
      audioSource = source
      statusMessage = ''
      if (source === 'microphone') {
        listeningState = isSpeechSupported() ? 'idle' : 'unsupported'
      } else {
        listeningState = 'idle'
      }
      render()
    })
  })

  document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      if (listeningState === 'listening') return
      systemMode = button.dataset.mode as SystemCaptureMode
      statusMessage = ''
      render()
    })
  })

  document.querySelector('#language-select')?.addEventListener('change', (event) => {
    selectedLanguageCode = (event.target as HTMLSelectElement).value
    savePrefs()
  })

  document.querySelector('#whisper-model')?.addEventListener('change', (event) => {
    selectedWhisperModel = (event.target as HTMLSelectElement).value as WhisperModelSize
    savePrefs()
  })

  document.querySelector('#input-device')?.addEventListener('change', (event) => {
    const value = (event.target as HTMLSelectElement).value
    if (audioSource === 'system' && systemMode === 'loopback') {
      selectedLoopbackId = value
    } else {
      selectedInputId = value
    }
  })

  document.querySelector('#output-device')?.addEventListener('change', (event) => {
    selectedOutputId = (event.target as HTMLSelectElement).value
    if (listeningState === 'listening' && audioSource === 'system' && monitorSpeakers) {
      void systemCapture.setMonitorOutput(selectedOutputId, true)
    }
  })

  document.querySelector('#voice-select')?.addEventListener('change', (event) => {
    selectedVoiceId = (event.target as HTMLSelectElement).value
  })

  document.querySelector('#monitor-speakers')?.addEventListener('change', (event) => {
    monitorSpeakers = (event.target as HTMLInputElement).checked
    if (listeningState === 'listening' && audioSource === 'system') {
      void systemCapture.setMonitorOutput(selectedOutputId, monitorSpeakers)
    }
  })

  document.querySelector('#toggle-mic')?.addEventListener('click', () => {
    statusMessage = ''
    if (listeningState === 'listening') {
      stopCapture()
      listeningState = 'idle'
      interimText = ''
      audioLevel = 0
      void persistActive()
      render()
      return
    }

    listeningState = 'listening'
    render()

    if (audioSource === 'system') {
      void systemCapture.start({
        mode: systemMode,
        deviceId: selectedLoopbackId || undefined,
        monitor: monitorSpeakers,
        outputDeviceId: selectedOutputId || undefined,
        languageCode: selectedLanguageCode,
        whisperModel: selectedWhisperModel,
      })
      return
    }

    engine.start(webSpeechLang(selectedLanguageCode))
  })

  document.querySelector('#speak-text')?.addEventListener('click', () => {
    if (speaking) {
      speaker.stop()
      speaking = false
      statusMessage = 'Speaker playback stopped.'
      render()
      return
    }

    if (!activeSession.text.trim()) return
    speaking = true
    statusMessage = 'Playing transcript through speakers…'
    render()
    speaker.speak(activeSession.text, selectedVoiceId || undefined)

    const waitUntilDone = () => {
      if (!speaker.isSpeaking) {
        speaking = false
        if (statusMessage.startsWith('Playing transcript')) {
          statusMessage = 'Finished speaking.'
        }
        render()
        return
      }
      window.setTimeout(waitUntilDone, 200)
    }
    waitUntilDone()
  })

  document.querySelector('#new-session')?.addEventListener('click', async () => {
    stopCapture()
    speaker.stop()
    speaking = false
    await persistActive()
    activeSession = createSession()
    interimText = ''
    listeningState =
      audioSource === 'microphone' && !isSpeechSupported() ? 'unsupported' : 'idle'
    statusMessage = ''
    render()
  })

  document.querySelector('#copy-text')?.addEventListener('click', async () => {
    if (!activeSession.text.trim()) return
    await navigator.clipboard.writeText(activeSession.text)
    statusMessage = 'Copied to clipboard.'
    render()
  })

  document.querySelector('#export-active')?.addEventListener('click', async () => {
    if (!activeSession.text.trim()) return
    await persistActive()
    exportSessionAsText(activeSession)
  })

  document.querySelector('#history-list')?.addEventListener('click', async (event) => {
    const target = event.target as HTMLElement
    const button = target.closest('button[data-action]') as HTMLButtonElement | null
    if (!button) return

    const id = button.dataset.id
    const action = button.dataset.action
    if (!id || !action) return

    const session = sessions.find((item) => item.id === id)
    if (!session && action !== 'delete') return

    if (action === 'open' && session) {
      stopCapture()
      speaker.stop()
      speaking = false
      await persistActive()
      activeSession = { ...session }
      interimText = ''
      listeningState =
        audioSource === 'microphone' && !isSpeechSupported() ? 'unsupported' : 'idle'
      statusMessage = ''
      render()
      return
    }

    if (action === 'export' && session) {
      exportSessionAsText(session)
      return
    }

    if (action === 'delete') {
      await deleteSession(id)
      sessions = await listSessions()
      if (activeSession.id === id) {
        stopCapture()
        speaker.stop()
        speaking = false
        activeSession = createSession()
        interimText = ''
        listeningState =
          audioSource === 'microphone' && !isSpeechSupported() ? 'unsupported' : 'idle'
      }
      statusMessage = 'Session deleted.'
      render()
    }
  })
}

void bootstrap()
