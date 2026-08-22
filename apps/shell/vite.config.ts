import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { federation } from '@module-federation/vite';

const PORT = 4200;

export default defineConfig({
  server: {
    port: PORT,
    strictPort: true,
    host: '127.0.0.1',
  },
  preview: { port: PORT, strictPort: true },
  build: { target: 'chrome89' },
  plugins: [
    federation({
      name: 'shell',
      // No build-time `remotes:` block - the consumer registers them at
      // runtime in src/mf.ts at module load time.
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
