// Renders text with inline math styled distinctly
// Detects patterns like x^n, f(x), sin(x), etc. and renders them in italic serif

export default function MathDisplay({ text }) {
  if (!text) return null

  // Simple tokenizer: split on math-like patterns and render them styled
  const parts = []
  const mathPattern = /([a-zA-Z]+\([^)]{1,30}\)|[a-zA-Z]\^[{-]?[\w]+}?|\d+\/\d+|\\[a-zA-Z]+|[∫∑∏√∞≤≥≠≈∂])/g

  let last = 0
  let match
  while ((match = mathPattern.exec(text)) !== null) {
    if (match.index > last) {
      parts.push({ type: 'text', value: text.slice(last, match.index) })
    }
    parts.push({ type: 'math', value: match[0] })
    last = match.index + match[0].length
  }
  if (last < text.length) parts.push({ type: 'text', value: text.slice(last) })

  return (
    <span>
      {parts.map((p, i) =>
        p.type === 'math'
          ? <span key={i} style={{
              fontStyle: 'italic',
              fontFamily: 'IM Fell English, Georgia, serif',
              fontSize: '1.05em',
              color: '#111',
              letterSpacing: '-0.01em',
            }}>{p.value}</span>
          : <span key={i}>{p.value}</span>
      )}
    </span>
  )
}
