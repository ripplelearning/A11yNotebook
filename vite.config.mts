import { defineConfig, type Plugin } from 'vitest/config';
import react from '@vitejs/plugin-react';
import pkg from './package.json';

// A strict Content Security Policy for the packaged renderer. It is only injected
// into production builds because the Vite dev server relies on inline scripts
// for hot module replacement.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: vault-file:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-src 'self'",
].join('; ');

function contentSecurityPolicy(): Plugin {
  return {
    name: 'a11y-notebook-csp',
    apply: 'build',
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: CONTENT_SECURITY_POLICY },
          injectTo: 'head',
        },
      ];
    },
  };
}

export default defineConfig({
  // Relative asset URLs so the packaged renderer resolves assets under file://.
  base: './',
  plugins: [react(), contentSecurityPolicy()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
