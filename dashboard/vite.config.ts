import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: "Yebram's Dashboard",
        short_name: "Yebram's",
        theme_color: '#F5C518',
        background_color: '#111111',
        display: 'standalone',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
  server: {
    host: true, // escucha en 0.0.0.0 → accesible desde red local
    proxy: {
      '/api': { target: 'http://localhost:3000', changeOrigin: true },
      '/ws':  { target: 'http://localhost:3000', changeOrigin: true, ws: true },
    },
  },
});
