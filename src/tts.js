// ElevenLabs streaming TTS with browser TTS fallback
import { sanitizeForSpeech } from './sanitize.js'

const XI_KEY   = import.meta.env.VITE_ELEVENLABS_KEY
const VOICE_ID = import.meta.env.VITE_ELEVENLABS_VOICE || 'JBFqnCBsd6RMkjVDRZzb' // George

let currentAudio = null

// ── ElevenLabs streaming ──
async function speakElevenLabs(text) {
  const response = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}/stream`,
    {
      method: 'POST',
      headers: {
        'xi-api-key': XI_KEY,
        'content-type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_turbo_v2_5',
        voice_settings: {
          stability: 0.52,
          similarity_boost: 0.78,
          style: 0.28,
          use_speaker_boost: true,
        },
      }),
    }
  )

  if (!response.ok) throw new Error(`ElevenLabs ${response.status}`)

  const blob = await response.blob()
  const url  = URL.createObjectURL(blob)

  return new Promise((resolve) => {
    const audio = new Audio(url)
    currentAudio = audio
    audio.playbackRate = 0.95
    audio.onended = () => { URL.revokeObjectURL(url); currentAudio = null; resolve() }
    audio.onerror = () => { URL.revokeObjectURL(url); currentAudio = null; resolve() }
    audio.play().catch(() => resolve())
  })
}

// ── Browser TTS fallback ──
let bestVoice = null

function pickVoice() {
  const voices = speechSynthesis.getVoices()
  const PREFERRED = ['Ava', 'Samantha', 'Karen', 'Moira', 'Serena',
    'Google UK English Female', 'Google US English']
  for (const name of PREFERRED) {
    const v = voices.find(v => v.name.includes(name))
    if (v) return v
  }
  return voices.find(v => v.lang.startsWith('en')) || voices[0]
}

export function loadVoices() {
  return new Promise((resolve) => {
    const voices = speechSynthesis.getVoices()
    if (voices.length) { bestVoice = pickVoice(); resolve(); return }
    speechSynthesis.onvoiceschanged = () => { bestVoice = pickVoice(); resolve() }
  })
}

function speakBrowser(text) {
  return new Promise((resolve) => {
    speechSynthesis.cancel()
    const u = new SpeechSynthesisUtterance(text)
    if (!bestVoice) bestVoice = pickVoice()
    if (bestVoice) u.voice = bestVoice
    u.rate = 0.88; u.pitch = 1.05; u.volume = 1.0
    u.onend = resolve; u.onerror = resolve
    speechSynthesis.speak(u)
  })
}

// ── Public API ──
export async function speak(rawText) {
  const text = sanitizeForSpeech(rawText)
  if (!text.trim()) return
  if (XI_KEY) {
    try { return await speakElevenLabs(text) } catch (e) {
      console.warn('ElevenLabs failed, falling back to browser TTS:', e)
    }
  }
  return speakBrowser(text)
}

export function stop() {
  if (currentAudio) {
    currentAudio.pause()
    currentAudio = null
  }
  speechSynthesis.cancel()
}
