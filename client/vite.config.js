import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss()
  ],

  // server: {
  //   host: true,
  //   port: 5173,
  //   strictPort: false,

  //   allowedHosts: [
  //     'rtats5173.elb.cisinlive.com'
  //   ],
  //   hmr: {
  //     host: 'rtats5173.elb.cisinlive.com',
  //     protocol: 'wss',
  //     clientPort: 443
  //   }
  // }
})