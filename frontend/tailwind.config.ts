import type { Config } from 'tailwindcss'

// Every colour resolves to a Dusk token in src/styles/tokens.css. Channels are
// stored bare so opacity modifiers (`bg-accent/20`) keep working.
const c = (name: string) => `oklch(var(--c-${name}) / <alpha-value>)`

const config: Config = {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        shade: c('shade'),
        paper: { DEFAULT: c('paper'), 2: c('paper-2'), 3: c('paper-3') },
        rule: { DEFAULT: c('rule'), 2: c('rule-2') },
        ink: { DEFAULT: c('ink'), 2: c('ink-2') },
        muted: c('muted'),
        faint: { DEFAULT: c('faint'), 2: c('faint-2') },
        light: c('light'),
        accent: {
          DEFAULT: c('accent'),
          hi: c('accent-hi'),
          deep: c('accent-deep'),
          soft: c('accent-soft'),
          ink: c('accent-ink'),
        },
        apricot: { DEFAULT: c('apricot'), deep: c('apricot-deep') },
        critical: { DEFAULT: c('critical'), deep: c('critical-deep') },
        day: { ink: c('day-ink'), muted: c('day-muted') },
        fog: c('fog'),
        // Status names stay (tests and utils read them); values are Dusk's signals.
        status: {
          green: c('accent'),
          amber: c('apricot'),
          red: c('critical'),
        },
      },
      fontFamily: {
        sans: ['Wix Madefor Text', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['Wix Madefor Display', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        code: ['ui-monospace', 'SF Mono', 'Menlo', 'monospace'],
      },
      borderRadius: {
        card: 'var(--radius-card)',
        inner: 'var(--radius-inner)',
        pill: 'var(--radius-pill)',
      },
      boxShadow: {
        card: 'var(--shadow-card)',
        pop: 'var(--shadow-pop)',
        glass: 'var(--glass-hi), var(--shadow-card)',
      },
      transitionTimingFunction: { out: 'var(--ease-out)' },
      transitionDuration: { micro: '120ms', short: '220ms' },
    },
  },
  plugins: [],
}

export default config
