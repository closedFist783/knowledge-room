// Converts math notation and strips markdown so TTS reads naturally

export function sanitizeForSpeech(text) {
  let s = text

  // ── Strip markdown formatting ──
  s = s.replace(/\*\*(.+?)\*\*/g, '$1')   // **bold** → plain
  s = s.replace(/\*(.+?)\*/g, '$1')        // *italic* → plain
  s = s.replace(/__(.+?)__/g, '$1')        // __bold__
  s = s.replace(/_([^_]+)_/g, '$1')        // _italic_
  s = s.replace(/`(.+?)`/g, '$1')          // `code` → plain
  s = s.replace(/#{1,6}\s/g, '')           // ## headings
  s = s.replace(/^\s*[-*]\s/gm, '')        // bullet points

  // ── Derivatives / primes ──
  s = s.replace(/f''\(([^)]+)\)/g, 'f double prime of $1')
  s = s.replace(/f'\(([^)]+)\)/g, 'f prime of $1')
  s = s.replace(/([a-zA-Z])'\(([^)]+)\)/g, '$1 prime of $2')
  s = s.replace(/d([a-zA-Z])\/d([a-zA-Z])/g, 'd $1 d $2')
  s = s.replace(/d\/d([a-zA-Z])\[([^\]]+)\]/g, 'the derivative with respect to $1 of $2')

  // ── Function notation f(x), g(t), etc. ──
  s = s.replace(/\b([A-Za-z])\(([^)]{1,20})\)/g, (_, fn, arg) => {
    // Don't convert known trig/math functions below — handled separately
    const mathFns = ['sin','cos','tan','cot','sec','csc','log','ln','exp','sqrt','lim','abs','det','tr']
    if (mathFns.includes(fn.toLowerCase())) return _
    return `${fn} of ${arg}`
  })

  // ── Trig and common functions ──
  s = s.replace(/\bsin\(([^)]+)\)/g, 'sine of $1')
  s = s.replace(/\bcos\(([^)]+)\)/g, 'cosine of $1')
  s = s.replace(/\btan\(([^)]+)\)/g, 'tangent of $1')
  s = s.replace(/\bcot\(([^)]+)\)/g, 'cotangent of $1')
  s = s.replace(/\bsec\(([^)]+)\)/g, 'secant of $1')
  s = s.replace(/\bcsc\(([^)]+)\)/g, 'cosecant of $1')
  s = s.replace(/\barcsin\(([^)]+)\)/g, 'arcsine of $1')
  s = s.replace(/\barccos\(([^)]+)\)/g, 'arccosine of $1')
  s = s.replace(/\barctan\(([^)]+)\)/g, 'arctangent of $1')
  s = s.replace(/\bln\(([^)]+)\)/g, 'the natural log of $1')
  s = s.replace(/\blog_?\{?(\d+)\}?\(([^)]+)\)/g, 'log base $1 of $2')
  s = s.replace(/\blog\(([^)]+)\)/g, 'log of $1')
  s = s.replace(/\bexp\(([^)]+)\)/g, 'e to the $1')
  s = s.replace(/\bsqrt\(([^)]+)\)/g, 'the square root of $1')
  s = s.replace(/√\(([^)]+)\)/g, 'the square root of $1')
  s = s.replace(/√([a-zA-Z0-9]+)/g, 'the square root of $1')

  // ── Exponents / powers ──
  s = s.replace(/e\^\{([^}]+)\}/g, 'e to the power of $1')
  s = s.replace(/e\^([a-zA-Z0-9]+)/g, 'e to the $1')
  s = s.replace(/([a-zA-Z0-9]+)\^\{([^}]+)\}/g, '$1 to the power of $2')
  s = s.replace(/([a-zA-Z0-9]+)\^(-?\d+)/g, (_, base, exp) => {
    if (exp === '2') return `${base} squared`
    if (exp === '3') return `${base} cubed`
    if (exp === '-1') return `one over ${base}`
    return `${base} to the power of ${exp}`
  })
  s = s.replace(/([a-zA-Z0-9]+)\^([a-zA-Z]+)/g, '$1 to the power of $2')

  // ── Fractions ──
  s = s.replace(/\\frac\{([^}]+)\}\{([^}]+)\}/g, '$1 over $2')
  s = s.replace(/(\d+)\/(\d+)/g, (_, a, b) => {
    const fracs = { '1/2': 'one half', '1/3': 'one third', '2/3': 'two thirds',
      '1/4': 'one quarter', '3/4': 'three quarters', '1/8': 'one eighth' }
    return fracs[`${a}/${b}`] || `${a} over ${b}`
  })

  // ── Greek letters ──
  const greek = { alpha:'alpha', beta:'beta', gamma:'gamma', delta:'delta',
    epsilon:'epsilon', theta:'theta', lambda:'lambda', mu:'mu', pi:'pi',
    sigma:'sigma', tau:'tau', phi:'phi', psi:'psi', omega:'omega',
    Delta:'Delta', Sigma:'Sigma', Pi:'Pi', Omega:'Omega' }
  for (const [sym, name] of Object.entries(greek)) {
    s = s.replace(new RegExp(`\\\\${sym}\\b`, 'g'), name)
  }

  // ── Limits ──
  s = s.replace(/lim_?\{?([^}→]+)→([^}]+)\}?/g, 'the limit as $1 approaches $2')
  s = s.replace(/lim\(([^)]+)\)/g, 'the limit of $1')

  // ── Integrals ──
  s = s.replace(/∫/g, 'the integral of')
  s = s.replace(/\\int/g, 'the integral of')

  // ── Summation ──
  s = s.replace(/∑/g, 'the sum of')
  s = s.replace(/\\sum/g, 'the sum of')

  // ── Products ──
  s = s.replace(/∏/g, 'the product of')

  // ── Infinity ──
  s = s.replace(/∞|\\infty/g, 'infinity')

  // ── Absolute value ──
  s = s.replace(/\|([^|]+)\|/g, 'the absolute value of $1')

  // ── Inequalities (LaTeX) ──
  s = s.replace(/\\leq/g, 'less than or equal to')
  s = s.replace(/\\geq/g, 'greater than or equal to')
  s = s.replace(/\\neq/g, 'not equal to')
  s = s.replace(/\\approx/g, 'approximately equal to')

  // ── Multiplication dot ──
  s = s.replace(/·/g, ' times ')
  s = s.replace(/×/g, ' times ')

  // ── Clean up leftover LaTeX braces ──
  s = s.replace(/\{([^}]+)\}/g, '$1')
  s = s.replace(/\\/g, '')

  // ── Tidy whitespace ──
  s = s.replace(/\s{2,}/g, ' ').trim()

  return s
}
