import type { AudioDeviceOption } from './types'

const LOOPBACK_HINTS = [
  'blackhole',
  'loopback',
  'soundflower',
  'stereo mix',
  'what u hear',
  'wave out',
  'cable',
  'vb-audio',
  'vb cable',
  'virtual',
  'monitor of',
  'aggregate',
]

export async function ensureAudioPermission(): Promise<void> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  stream.getTracks().forEach((track) => track.stop())
}

function toDeviceOption(device: MediaDeviceInfo, index: number): AudioDeviceOption {
  const label = device.label || `Microphone ${index + 1}`
  return {
    deviceId: device.deviceId,
    label,
    loopbackLikely: LOOPBACK_HINTS.some((hint) => label.toLowerCase().includes(hint)),
  }
}

export async function listInputDevices(): Promise<AudioDeviceOption[]> {
  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices
    .filter((device) => device.kind === 'audioinput')
    .map((device, index) => toDeviceOption(device, index))
}

export async function listOutputDevices(): Promise<AudioDeviceOption[]> {
  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices
    .filter((device) => device.kind === 'audiooutput')
    .map((device, index) => ({
      deviceId: device.deviceId,
      label: device.label || `Speaker ${index + 1}`,
    }))
}

export function preferLoopbackDevice(devices: AudioDeviceOption[]): string {
  const loopback = devices.find((device) => device.loopbackLikely)
  return loopback?.deviceId || devices[0]?.deviceId || ''
}

export function canSelectOutputDevice(): boolean {
  return typeof HTMLAudioElement !== 'undefined' && 'setSinkId' in HTMLAudioElement.prototype
}
