import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const buildHash = Date.now().toString()

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'inject-sw-hash',
      // Runs after Vite writes all output files (including copied public/ assets)
      closeBundle() {
        const swPath = path.join(__dirname, 'dist', 'sw.js')
        if (!fs.existsSync(swPath)) return
        const sw = fs.readFileSync(swPath, 'utf-8')
        fs.writeFileSync(swPath, sw.replaceAll('__VITE_BUILD_HASH__', buildHash))
      },
    },
  ],
  define: {
    'import.meta.env.VITE_BUILD_HASH': JSON.stringify(buildHash),
  },
  server: {
    proxy: {
      '/api': {
        target: 'https://yebrams.up.railway.app',
        changeOrigin: true,
      },
    },
  },
})
