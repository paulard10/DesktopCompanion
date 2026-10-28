import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.join(rootDir, 'src/renderer'),
  base: './',
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: path.join(rootDir, 'dist/renderer'),
    emptyOutDir: true,
    assetsDir: 'assets',
    sourcemap: true,
    rolldownOptions: {
      input: {
        main: path.join(rootDir, 'src/renderer/index.html'),
        chat: path.join(rootDir, 'src/renderer/chat.html'),
        trail: path.join(rootDir, 'src/renderer/trail.html'),
        home: path.join(rootDir, 'src/renderer/home.html'),
      },
    },
  },
});
