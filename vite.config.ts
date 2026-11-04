import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages serves this project at https://<owner>.github.io/UsElec26/
const base = process.env.ENA_BASE ?? '/UsElec26/';

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icons/*.png', 'icons/*.svg'],
      manifest: {
        name: 'Election Night: America',
        short_name: 'Election Night',
        description: 'A persistent simulation of American electoral history.',
        theme_color: '#0A1022',
        background_color: '#0A1022',
        display: 'standalone',
        start_url: base,
        scope: base,
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,wasm,svg,png,woff2}', 'data/*.json', 'geo-packs/*/topo/*.json'],
        globIgnores: ['**/sqlite3-worker1-*.js', '**/sqlite3-opfs-async-proxy-*.js'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        runtimeCaching: [
          {
            // Geography packs are versioned by directory and never change: cache-first.
            urlPattern: ({ url }) => url.pathname.includes('/geo-packs/'),
            handler: 'CacheFirst',
            options: { cacheName: 'ena-geo-packs', expiration: { maxEntries: 200 } },
          },
        ],
      },
    }),
  ],
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 1500 },
});
