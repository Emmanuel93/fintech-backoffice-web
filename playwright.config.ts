import { defineConfig, devices } from '@playwright/test';

/**
 * Pruebas de navegador del backoffice.
 *
 * Graban vídeo y traza siempre, no solo al fallar: el objetivo aquí no es únicamente detectar
 * regresiones, es poder *ver* el recorrido completo por rol —qué módulos aparecen, qué se puede
 * abrir y qué responde 403— sin volver a ejecutarlo. Una prueba que pasa en verde y no deja
 * evidencia no sirve para revisar el modelo de permisos con alguien más.
 *
 * `workers: 1` es deliberado: los roles comparten el mismo backend y el gateway limita los
 * intentos de login por minuto. En paralelo, la mitad de las sesiones chocaría con un 429 y el
 * fallo diría "rate limit" en vez de decir algo sobre los permisos.
 */
const BASE_URL = process.env.BO_BASE_URL ?? 'http://localhost:4200';

export default defineConfig({
  testDir: './tools/e2e/browser',
  outputDir: './tools/e2e/.artifacts/browser',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [
    ['list'],
    ['html', { outputFolder: './tools/e2e/.artifacts/report', open: 'never' }],
  ],
  use: {
    baseURL: BASE_URL,
    video: 'on',
    trace: 'on',
    screenshot: 'on',
    actionTimeout: 15_000,
    viewport: { width: 1440, height: 900 },
    locale: 'es-MX',
    timezoneId: 'America/Mexico_City',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
