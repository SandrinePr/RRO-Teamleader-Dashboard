// Vite-buildconfig: React-plugin, devserver vast op poort 5173 (o.a. OAuth-redirect URI).
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Vast op 5173 — Microsoft Entra redirect: http://localhost:5173
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
  },
})
