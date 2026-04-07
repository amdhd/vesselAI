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
        // Cache API GET responses (network-first, fall back to cache when offline)
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'vm-api-cache',
              networkTimeoutSeconds: 8,
              expiration: {
                maxEntries: 150,
                maxAgeSeconds: 60 * 60 * 24, // 24 hours
              },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
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
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // Core React — always needed, cache aggressively
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          // Heavy map lib — only needed on fleet/ports pages
          'vendor-map': ['leaflet', 'react-leaflet'],
          // Charting lib — used across several modules
          'vendor-charts': ['recharts'],
          // Query + axios — needed everywhere but separate from React
          'vendor-query': ['@tanstack/react-query', '@tanstack/react-query-persist-client', 'axios'],
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
