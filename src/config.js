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
  return getConfig().anthropicKey || ''
}

export function getElevenLabsKey() {
  return getConfig().elevenLabsKey || ''
}

export function getElevenLabsVoice() {
  return getConfig().elevenLabsVoice || 'JBFqnCBsd6RMkjVDRZzb'
}
