import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * La liga pública de la beneficiaria. Va **fuera** de la federación a propósito: no tiene shell,
 * ni sesión de empleado, ni capacidades. Si compartiera `@bo/auth` o `@bo/api-client`, una página
 * que abre cualquiera con un enlace cargaría el código que sabe hablar con el BFF de la consola, y
 * un descuido de configuración bastaría para que mandara un token de staff.
 */
const PORT = 4300;

export default defineConfig({
  server: {
    port: PORT,
    strictPort: true,
    host: '127.0.0.1',
  },
  preview: { port: PORT, strictPort: true },
  build: { target: 'es2020' },
  plugins: [react()],
});
