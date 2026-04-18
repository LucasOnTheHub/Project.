import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// M3: three.js deps are installed in a separate dir because the project node_modules
// lives on a CIFS mount that prevents npm from replacing files from prior sessions.
// We resolve them explicitly here so vite can bundle them.
const THREE_MODULES = '/sessions/affectionate-dazzling-archimedes/three_tmp/node_modules';

/**
 * Vite config for the Electron renderer (M3 UI 3D).
 *
 * Dev:   vite --config vite.config.ui.ts
 * Build: vite build --config vite.config.ui.ts  →  dist-ui/
 */
export default defineConfig({
  plugins: [react()],

  root: resolve(__dirname, 'src/ui'),

  base: './',

  build: {
    outDir: resolve(__dirname, 'dist-ui'),
    emptyOutDir: false,
  },

  server: {
    port: 5173,
    strictPort: true,
  },

  resolve: {
    alias: {
      'three':              `${THREE_MODULES}/three`,
      '@react-three/fiber': `${THREE_MODULES}/@react-three/fiber`,
      '@react-three/drei':  `${THREE_MODULES}/@react-three/drei`,
    },
  },

  // Electron renderer: no polyfills needed, target Chromium
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env['NODE_ENV'] ?? 'development'),
  },
});
