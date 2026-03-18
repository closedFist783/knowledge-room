import { useState, useRef, useCallback, useEffect } from 'react'
import Scene from './Scene'
import { useStore } from './store'
import { streamExplanation } from './ai'
import { speak, stop as stopSpeech, loadVoices } from './tts'
import { sanitizeForSpeech } from './sanitize.js'
import MathDisplay from './MathDisplay.jsx'
import { getConfig, saveConfig, getAnthropicKey } from './config.js'

// ── SETTINGS PANEL ──
function SettingsPanel({ onClose }) {
  const cfg = getConfig()
  const [ak, setAk] = useState(cfg.anthropicKey || '')
  const [xk, setXk] = useState(cfg.elevenLabsKey || '')
  const [vid, setVid] = useState(cfg.elevenLabsVoice || 'JBFqnCBsd6RMkjVDRZzb')
  const save = () => { saveConfig({ anthropicKey: ak, elevenLabsKey: xk, elevenLabsVoice: vid }); onClose() }
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(255,255,255,0.97)', zIndex:300, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:20, fontFamily:'IM Fell English, serif' }}>
      <div style={{ fontSize:11, letterSpacing:'0.4em', color:'#aaa', textTransform:'uppercase', fontFamily:'Cormorant SC, serif' }}>API Keys</div>
      <div style={{ display:'flex', flexDirection:'column', gap:14, width:420, padding:'0 24px' }}>
        {[
          ['Anthropic Key', ak, setAk, 'sk-ant-...'],
          ['ElevenLabs Key', xk, setXk, 'sk_...'],
          ['ElevenLabs Voice ID', vid, setVid, 'JBFqnCBsd6RMkjVDRZzb'],
        ].map(([label, val, set, ph]) => (
          <div key={label} style={{ display:'flex', flexDirection:'column', gap:6 }}>
            <span style={{ fontSize:12, color:'#888', letterSpacing:'0.05em' }}>{label}</span>
            <input value={val} onChange={e => set(e.target.value)} placeholder={ph}
              style={{ fontFamily:'IM Fell English, serif', fontSize:15, border:'none', borderBottom:'1px solid #ccc', padding:'6px 0', outline:'none', background:'transparent' }} />
          </div>
        ))}
      </div>
      <div style={{ display:'flex', gap:20 }}>
        <button onClick={save} style={{ fontFamily:'Cormorant SC, serif', fontSize:11, letterSpacing:'0.3em', textTransform:'uppercase', background:'#111', color:'#fff', border:'none', padding:'10px 24px', cursor:'pointer' }}>Save</button>
        <button onClick={onClose} style={{ fontFamily:'Cormorant SC, serif', fontSize:11, letterSpacing:'0.3em', textTransform:'uppercase', background:'none', color:'#999', border:'none', cursor:'pointer' }}>Cancel</button>
      </div>
    </div>
  )
}

// ── INTRO ──
function IntroScreen({ onBegin }) {
  const [input, setInput] = useState('')
  const [fading, setFading] = useState(false)
  const handleSubmit = () => {
    if (!input.trim()) return
    setFading(true)
    setTimeout(() => onBegin(input.trim()), 850)
  }
  return (
    <div className={`intro-screen${fading ? ' fading' : ''}`}>
      <div className="intro-title">Knowledge Room</div>
      <div className="intro-input-wrap">
        <div className="intro-label">What would you like to understand?</div>
        <input
          className="intro-input" autoFocus
          value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSubmit()}
          placeholder="a topic, a question, a paper…"
        />
        <button className="intro-btn" onClick={handleSubmit} disabled={!input.trim()}>Begin</button>
      </div>
    </div>
  )
}

// ── MAIN APP ──
export default function App() {
  const [phase, setPhase] = useState('intro')
  const [followupInput, setFollowupInput] = useState('')
  const [listening, setListening] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const { status, setStatus, rawNarration, setNarration, setRawNarration, updateScene, reset } = useStore()

  const messagesRef        = useRef([])
  const recognitionRef     = useRef(null)
  const abortControllerRef = useRef(null)
  const lastNarrationRef   = useRef('')
  const sceneRef           = useRef(null)

  const sentenceQueueRef   = useRef([])
  const sceneQueueRef      = useRef([])
  const sceneCounterRef    = useRef(0)
  const isPlayingRef       = useRef(false)
  const abortPlayRef       = useRef(false)

  useEffect(() => { loadVoices() }, [])

  // ── Play loop ──
  const startPlayLoop = useCallback(async () => {
    if (isPlayingRef.current) return
    isPlayingRef.current = true
    abortPlayRef.current = false

    while (!abortPlayRef.current) {
      const item = sentenceQueueRef.current.shift()
      if (!item) {
        await new Promise(r => setTimeout(r, 50))
        if (sentenceQueueRef.current.length === 0 && !isPlayingRef.current) break
        continue
      }
      const { text, sceneIndex } = item
      if (sceneIndex !== undefined && sceneQueueRef.current[sceneIndex]) {
        updateScene(sceneQueueRef.current[sceneIndex])
      }
      setStatus('speaking')
      const clean = sanitizeForSpeech(text)
      lastNarrationRef.current = clean
      setNarration(clean)
      setRawNarration(text)
      await speak(text)
      if (abortPlayRef.current) break
    }
    isPlayingRef.current = false
  }, [updateScene, setStatus, setNarration, setRawNarration])

  const stopAll = useCallback(() => {
    abortPlayRef.current = true
    isPlayingRef.current = false
    sentenceQueueRef.current = []
    sceneQueueRef.current = []
    sceneCounterRef.current = 0
    stopSpeech()
  }, [])

  // ── Run a session turn ──
  const runSession = useCallback(async (userMessage) => {
    abortControllerRef.current?.abort()
    const controller = new AbortController()
    abortControllerRef.current = controller

    stopAll()
    await new Promise(r => setTimeout(r, 80))
    abortPlayRef.current = false

    messagesRef.current.push({ role: 'user', content: userMessage })
    setStatus('thinking')

    let textBuffer = ''
    let pendingSceneIndex = undefined

    try {
      await streamExplanation({
        messages: messagesRef.current,
        signal: controller.signal,
        onText: (delta) => {
          textBuffer += delta
          const match = textBuffer.search(/[.!?]\s/)
          if (match !== -1 && textBuffer.length >= 60) {
            const sentence = textBuffer.slice(0, match + 1).trim()
            textBuffer = textBuffer.slice(match + 2)
            if (sentence) {
              sentenceQueueRef.current.push({ text: sentence, sceneIndex: pendingSceneIndex })
              pendingSceneIndex = undefined
            }
          }
        },
        onScene: (sceneData) => {
          const idx = sceneCounterRef.current++
          sceneQueueRef.current[idx] = sceneData
          pendingSceneIndex = idx
        },
        onDone: () => {
          if (textBuffer.trim()) {
            sentenceQueueRef.current.push({ text: textBuffer.trim(), sceneIndex: pendingSceneIndex })
            textBuffer = ''
          }
          setStatus('idle')
        }
      })
    } catch (err) {
      if (err.name !== 'AbortError') { console.error(err); setNarration('Error: ' + err.message) }
      setStatus('idle')
    }
    startPlayLoop()
  }, [stopAll, setStatus, setNarration, startPlayLoop])

  const handleBegin = useCallback((topic) => {
    reset()
    messagesRef.current = []
    setPhase('room')
    setTimeout(() => runSession(`Explain this topic thoroughly: "${topic}"`), 200)
  }, [reset, runSession])

  // ── Interrupt with screenshot context ──
  const handleInterrupt = useCallback(async (transcript) => {
    if (!transcript.trim()) return

    // Capture what's visible in the scene
    let contextSuffix = ''
    if (sceneRef.current) {
      const frontNode = sceneRef.current.getFrontNodeLabel?.()
      const visibleLabels = sceneRef.current.getVisibleLabels?.() || []
      if (frontNode) contextSuffix += ` The user appears to be looking at the node: "${frontNode}".`
      if (visibleLabels.length) contextSuffix += ` Currently visible nodes: ${visibleLabels.join(', ')}.`
    }

    const context = lastNarrationRef.current
      ? `[The user interrupted while you were saying: "${lastNarrationRef.current}".${contextSuffix}] User said: "${transcript}"`
      : `[${contextSuffix}] User said: "${transcript}"`

    setNarration(`"${transcript}"`)
    runSession(context)
  }, [runSession, setNarration])

  const handleFollowup = useCallback(() => {
    if (!followupInput.trim()) return
    const q = followupInput
    setFollowupInput('')
    handleInterrupt(q)
  }, [followupInput, handleInterrupt])

  // ── Mic toggle ──
  const toggleMic = useCallback(() => {
    if (listening) {
      recognitionRef.current?.stop()
      setListening(false)
      stopAll()
      setStatus('idle')
      return
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) { alert('Speech recognition requires Chrome.'); return }
    stopAll()
    const r = new SR()
    recognitionRef.current = r
    r.continuous = false; r.interimResults = false; r.lang = 'en-US'
    r.onresult = e => { setListening(false); handleInterrupt(e.results[0][0].transcript) }
    r.onerror = r.onend = () => setListening(false)
    r.start()
    setListening(true)
  }, [listening, handleInterrupt, stopAll, setStatus])

  const handleRefocus = useCallback(() => {
    sceneRef.current?.refocus?.()
  }, [])

  const statusLabels = {
    idle:     messagesRef.current.length ? 'click canvas to look around · wasd to move · space/shift up-down' : '',
    thinking: 'thinking…',
    speaking: 'speaking',
  }

  if (phase === 'intro') return <IntroScreen onBegin={handleBegin} />

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative' }}>
      <Scene sceneRef={sceneRef} />
      <div className="ui-overlay">
        <div className="narration-box"><MathDisplay text={rawNarration} /></div>
        <div className="status-bar">{statusLabels[status] || ''}</div>
        <div className="input-row">
          <input
            className="topic-input"
            value={followupInput}
            onChange={e => setFollowupInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleFollowup()}
            placeholder="ask a question or interrupt…"
          />
          <button
            className={`btn mic-btn${listening ? ' listening' : ''}`}
            onClick={toggleMic}
            title={listening ? 'Stop' : 'Speak to interrupt'}
          >
            {listening ? '⏹' : '🎤'}
          </button>
          <button className="btn" onClick={handleFollowup} disabled={!followupInput.trim()}>
            Ask
          </button>
          <button className="btn" onClick={handleRefocus} title="Re-center on active node">
            ⦾
          </button>
          <button className="btn" onClick={() => setShowSettings(true)} title="Settings">
            ⚙
          </button>
        </div>
      </div>
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
    </div>
  )
}
