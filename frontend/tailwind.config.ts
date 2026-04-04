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
          700: '#1e3a6e',
          800: '#112654',
          900: '#0A1628',
          950: '#060e1a',
        },
        teal: {
          600: '#0F766E',
          700: '#0d6b64',
          400: '#2dd4bf',
        },
        amber: {
          600: '#D97706',
        },
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
    },
  },
  plugins: [],
}

export default config
