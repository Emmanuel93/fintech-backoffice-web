import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { federation } from '@module-federation/vite';

// Puerto propio: los remotes se sirven en paralelo (5101–5109).
const PORT = 5109;

export default defineConfig({
  server: {
    port: PORT,
    strictPort: true,
    origin: `http://localhost:${PORT}`,
    host: '127.0.0.1',
    // Allow cross-origin fetches of mf-manifest.json + chunks from a consumer
    // running on a different port. Vite 8 narrows the default CORS allowlist
    // to specific localhost patterns; setting `cors: true` emits a wildcard
    // `Access-Control-Allow-Origin: *` for dev which is what federation needs.
    cors: true,
  },
  preview: { port: PORT, strictPort: true, cors: true },
  build: { target: 'chrome89' },
  plugins: [
    federation({
      name: 'mfe_collections',
      filename: 'remoteEntry.js',
      exposes: {
        './App': './src/App.tsx',
      },
      // `@bo/auth` tiene que ser singleton igual que React: lleva el contexto de
      // capacidades, y un contexto duplicado no es "otra instancia", es otro
      // objeto de contexto. El remote leía entonces el valor por defecto
      // —`can() => false`— y escondía los botones de decidir a quien sí podía.
      // El resto se comparte por la misma razón práctica: un solo cliente HTTP,
      // un solo tema, un solo juego de estilos inyectados.
      shared: {
        react: { singleton: true },
        'react-dom': { singleton: true },
        '@bo/auth': { singleton: true, requiredVersion: false },
        '@bo/api-client': { singleton: true, requiredVersion: false },
        '@bo/design-system': { singleton: true, requiredVersion: false },
        '@bo/shared-types': { singleton: true, requiredVersion: false },
      },
    }),
    react(),
  ],
});
