import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// HTTPS is required for WebXR APIs in mobile browsers.
// The basicSsl plugin generates a self-signed certificate for local dev.
export default defineConfig({
  plugins: [basicSsl()],
  server: {
    https: true,
    host: true, // expose on LAN so mobile devices can connect
    port: 5173,
  },
});
