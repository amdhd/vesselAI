import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          50: '#e8edf5',
          100: '#c5d0e6',
          200: '#9fb1d4',
          300: '#7892c2',
          400: '#5a7ab4',
          500: '#3d62a6',
          600: '#2d4f8a',
          700: '#1f2227',
          800: '#0d0f12',
          900: '#0a0c0f',
          950: '#0b0d10',
        },
        teal: {
          900: 'rgba(58,140,133,0.12)',
          600: '#3a8c85',
          700: '#33796f',
          400: '#57a89f',
        },
        amber: {
          600: '#c99a54',
        },
        status: {
          green: '#4a9d6f',
          amber: '#c99a54',
          red: '#a8443b',
        },
      },
      fontFamily: {
        sans: ['IBM Plex Sans', 'sans-serif'],
        mono: ['IBM Plex Mono', 'monospace'],
      },
    },
  },
  plugins: [],
}

export default config
