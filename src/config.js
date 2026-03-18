// Keys are stored in localStorage so nothing is baked into the build
const STORAGE_KEY = 'kr_config'

export function getConfig() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}')
  } catch { return {} }
}

export function saveConfig(cfg) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg))
}

export function getAnthropicKey() {
  return getConfig().anthropicKey || import.meta.env.VITE_ANTHROPIC_KEY || ''
}

export function getElevenLabsKey() {
  return getConfig().elevenLabsKey || import.meta.env.VITE_ELEVENLABS_KEY || ''
}

export function getElevenLabsVoice() {
  return getConfig().elevenLabsVoice || import.meta.env.VITE_ELEVENLABS_VOICE || 'JBFqnCBsd6RMkjVDRZzb'
}
