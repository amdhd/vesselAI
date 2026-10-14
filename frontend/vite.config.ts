import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        // Cache static assets (cache-first, long TTL)
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // Private API responses must never enter an origin-wide service-worker
        // cache. Offline query persistence is scoped to the authenticated session.
        runtimeCaching: [],
      },
      manifest: {
        name: 'VesselMind AI',
        short_name: 'VesselMind',
        description: 'Maritime AI Platform for Fleet Operations',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/vite.svg', sizes: '192x192', type: 'image/svg+xml' },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const groups = {
            'vendor-react': ['react', 'react-dom', 'react-router-dom'],
            'vendor-map': ['leaflet', 'react-leaflet'],
            'vendor-charts': ['recharts'],
            'vendor-query': ['@tanstack/react-query', '@tanstack/react-query-persist-client', 'axios'],
          }
          for (const [chunk, packages] of Object.entries(groups)) {
            if (packages.some(pkg => id.includes(`/node_modules/${pkg}/`))) return chunk
          }
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
