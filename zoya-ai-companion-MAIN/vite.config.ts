import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
  // HMR is disabled in AI Studio via DISABLE_HMR env var.
  hmr: process.env.DISABLE_HMR !== 'true',

  // Don't let Vite watch the Tauri/Rust build folder.
  watch: process.env.DISABLE_HMR === 'true'
    ? null
    : {
        ignored: ['**/src-tauri/**'],
      },
},
  };
});
