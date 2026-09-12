import path from 'node:path'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

const deployments = path.resolve(import.meta.dirname, '../contractsV2/deployments')

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@deployments': deployments },
  },
  server: {
    fs: { allow: [import.meta.dirname, deployments] },
  },
})
