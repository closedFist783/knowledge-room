const ANTHROPIC_KEY = import.meta.env.VITE_ANTHROPIC_KEY

const SYSTEM_PROMPT = `You are a knowledge guide inside a 3D white room. You explain topics by speaking naturally, and you control a visual knowledge graph that updates sentence by sentence as you speak.

SPEAKING RULES:
- Your very first word must be about the subject itself. Not about what you will do.
- BANNED phrases (never say these): "I'll walk you through", "Let me explain", "Let's explore", "I will now", "Today we", "I'm going to", "Let's begin", "In this explanation", "I'll guide you", "allow me to", "we're going to".
- Wrong: "I'll walk you through how magnetic fields work."
- Right: "Magnetic fields arise from moving electric charges."
- Be clear, precise, unhurried. 6–10+ paragraphs total.
- When a user message starts with "[The user interrupted", answer their question directly, then resume.
- NEVER use markdown: no **bold**, no *italic*, no bullet points, no headers. Plain prose only.
- Write ALL math in spoken form: "f of x" not "f(x)", "x to the power of n" not "x^n", "sine of x" not "sin(x)", "the derivative of f" not "f'", "n times x to the power of n minus 1" not "nx^(n-1)". Write as if being read aloud by a professor.

GRAPH RULES — CRITICAL:
- Call update_scene ONLY once per sentence or two — as you introduce each specific concept.
- Add ONE node per call. Maximum. Never add a node before you have spoken about it.
- Set activeNodeId to the node you are currently speaking about.
- Set visibleNodeIds to only the currently relevant nodes (2–5 max). At the very end, include ALL ids.
- Pass the COMPLETE cumulative nodes + edges every call.
- Node label: 2–5 words, noun phrase only.
- Node types: "root" | "section" | "detail".

PACING: One update_scene per 1–3 sentences of narration. Not more frequent.`

const tools = [
  {
    name: 'update_scene',
    description: 'Update the graph with ONE new node you are currently speaking about.',
    input_schema: {
      type: 'object',
      properties: {
        nodes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id:       { type: 'string' },
              label:    { type: 'string', description: '2–5 words, noun phrase' },
              type:     { type: 'string', enum: ['root', 'section', 'detail'] },
              children: { type: 'array', items: { type: 'string' } }
            },
            required: ['id', 'label', 'type']
          }
        },
        edges: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              from: { type: 'string' },
              to:   { type: 'string' }
            },
            required: ['from', 'to']
          }
        },
        activeNodeId:   { type: 'string' },
        visibleNodeIds: { type: 'array', items: { type: 'string' } }
      },
      required: ['nodes', 'edges', 'activeNodeId', 'visibleNodeIds']
    }
  }
]

async function streamOneTurn({ messages, onText, onScene }) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      tools,
      messages,
      stream: true,
    })
  })

  if (!response.ok) throw new Error(`API error: ${await response.text()}`)

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let fullText = ''
  let toolUseBlocks = []
  let currentToolId = null
  let toolInputBuffer = ''
  let stopReason = null
  let contentBlocks = []

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const lines = decoder.decode(value).split('\n').filter(l => l.startsWith('data: '))

    for (const line of lines) {
      const data = line.slice(6)
      if (data === '[DONE]') continue
      let event
      try { event = JSON.parse(data) } catch { continue }

      if (event.type === 'content_block_start') {
        const b = event.content_block
        if (b.type === 'text') contentBlocks.push({ type: 'text', text: '' })
        else if (b.type === 'tool_use') {
          currentToolId = b.id; toolInputBuffer = ''
          contentBlocks.push({ type: 'tool_use', id: b.id, name: b.name, input: {} })
        }
      }
      if (event.type === 'content_block_delta') {
        const d = event.delta
        if (d.type === 'text_delta') {
          fullText += d.text
          const last = contentBlocks[contentBlocks.length - 1]
          if (last?.type === 'text') last.text += d.text
          onText(d.text)
        }
        if (d.type === 'input_json_delta') toolInputBuffer += d.partial_json
      }
      if (event.type === 'content_block_stop' && currentToolId) {
        try {
          const input = JSON.parse(toolInputBuffer)
          const tb = contentBlocks.find(b => b.id === currentToolId)
          if (tb) tb.input = input
          onScene(input)
          toolUseBlocks.push({ id: currentToolId, name: 'update_scene', input })
        } catch (e) { console.warn('tool parse fail', e) }
        currentToolId = null; toolInputBuffer = ''
      }
      if (event.type === 'message_delta') stopReason = event.delta?.stop_reason
    }
  }

  return { fullText, toolUseBlocks, contentBlocks, stopReason }
}

export async function streamExplanation({ messages, onText, onScene, onDone, signal }) {
  let workingMessages = [...messages]
  while (true) {
    if (signal?.aborted) break
    const { fullText, toolUseBlocks, contentBlocks, stopReason } = await streamOneTurn({
      messages: workingMessages, onText, onScene
    })
    workingMessages.push({ role: 'assistant', content: contentBlocks })
    if (stopReason === 'tool_use' && toolUseBlocks.length > 0) {
      workingMessages.push({
        role: 'user',
        content: toolUseBlocks.map(tb => ({
          type: 'tool_result', tool_use_id: tb.id,
          content: 'Scene updated. Continue your explanation.'
        }))
      })
      continue
    }
    onDone({ text: fullText })
    break
  }
}
