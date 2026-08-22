import { expect, type Page } from '@playwright/test';

/**
 * La misma matriz de permisos que declaran `apps/shell/src/nav.ts` (qué se ve) y el
 * `SecurityConfig` del BFF (qué se puede llamar), escrita una tercera vez a propósito.
 *
 * Si se importara de `nav.ts`, la prueba y el código bajo prueba compartirían el error: cambiar
 * la lista haría que la prueba cambiara con ella y siguiera en verde. Declararla aquí obliga a
 * que un cambio de permisos se haga en dos sitios conscientemente.
 */
export interface RoleFixture {
  key: string;
  email: string;
  password: string;
  displayName: string;
  /** Módulos del menú "Operación" que este rol debe ver. */
  visibleModules: string[];
  /** Módulos que NO debe ver — la mitad que de verdad se rompe. */
  hiddenModules: string[];
  /** Rutas que responden con datos. */
  allowedRoutes: string[];
  /** Rutas que el servidor debe negar aunque se pidan a mano. */
  deniedRoutes: string[];
}

const PASSWORD = process.env.BO_STAFF_PASSWORD ?? 'Backoffice#2026';

// Dashboard es visible para cualquier empleado autenticado; no se repite en cada fila.
export const ROLES: RoleFixture[] = [
  {
    key: 'admin',
    email: 'admin@kredius.mx',
    password: process.env.BO_ADMIN_PASSWORD ?? PASSWORD,
    displayName: 'Administrador',
    visibleModules: ['Dashboard', 'Cartera', 'Clientes y distribuidores', 'Productos'],
    hiddenModules: [],
    allowedRoutes: ['/', '/cartera', '/clientes', '/productos'],
    deniedRoutes: [],
  },
  {
    key: 'ops',
    email: 'ops@kredius.mx',
    password: PASSWORD,
    displayName: 'Supervisor de operación',
    visibleModules: ['Dashboard', 'Cartera', 'Clientes y distribuidores'],
    hiddenModules: ['Productos'],
    allowedRoutes: ['/', '/cartera', '/clientes'],
    deniedRoutes: [],
  },
  {
    key: 'analista',
    email: 'analista@kredius.mx',
    password: PASSWORD,
    displayName: 'Analista de crédito',
    visibleModules: ['Dashboard', 'Cartera', 'Clientes y distribuidores'],
    hiddenModules: ['Productos'],
    allowedRoutes: ['/', '/cartera', '/clientes'],
    deniedRoutes: [],
  },
  {
    key: 'ejecutivo',
    email: 'ejecutivo@kredius.mx',
    password: PASSWORD,
    displayName: 'Ejecutivo de cartera',
    visibleModules: ['Dashboard', 'Cartera', 'Clientes y distribuidores'],
    hiddenModules: ['Productos'],
    allowedRoutes: ['/', '/cartera', '/clientes'],
    deniedRoutes: [],
  },
  {
    key: 'producto',
    email: 'producto@kredius.mx',
    password: PASSWORD,
    displayName: 'Product manager',
    visibleModules: ['Dashboard', 'Productos'],
    hiddenModules: ['Cartera', 'Clientes y distribuidores'],
    allowedRoutes: ['/', '/productos'],
    deniedRoutes: ['/cartera', '/clientes'],
  },
  {
    key: 'soporte',
    email: 'soporte@kredius.mx',
    password: PASSWORD,
    displayName: 'Soporte',
    visibleModules: ['Dashboard', 'Clientes y distribuidores'],
    hiddenModules: ['Cartera', 'Productos'],
    allowedRoutes: ['/', '/clientes'],
    deniedRoutes: ['/cartera'],
  },
  {
    key: 'cobranza',
    email: 'cobranza@kredius.mx',
    password: PASSWORD,
    displayName: 'Gestor de cobranza',
    visibleModules: ['Dashboard'],
    hiddenModules: ['Cartera', 'Clientes y distribuidores', 'Productos'],
    allowedRoutes: ['/'],
    deniedRoutes: ['/cartera', '/clientes'],
  },
  {
    key: 'auditor',
    email: 'auditor@kredius.mx',
    password: PASSWORD,
    displayName: 'Auditor',
    visibleModules: ['Dashboard'],
    hiddenModules: ['Cartera', 'Clientes y distribuidores', 'Productos'],
    allowedRoutes: ['/'],
    deniedRoutes: ['/cartera'],
  },
];

/** Entra por la pantalla de login, como una persona. Nada de inyectar el token en localStorage. */
export async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /backoffice de crédito/i })).toBeVisible();

  await page.getByPlaceholder('usuario@kredius.mx').fill(email);
  await page.getByPlaceholder('••••••••').fill(password);
  await page.getByRole('button', { name: /iniciar sesión/i }).click();

  // El marco de la aplicación es la señal de que la sesión quedó establecida.
  await expect(page.locator('.bo-frame')).toBeVisible({ timeout: 20_000 });
}

export async function logout(page: Page): Promise<void> {
  const salir = page.getByRole('button', { name: 'Salir' });
  if (await salir.isVisible().catch(() => false)) {
    await salir.click();
    await expect(page.locator('.bo-login')).toBeVisible();
  }
  await page.evaluate(() => localStorage.clear());
}

/** Los módulos del menú lateral que este usuario tiene delante. */
export async function visibleNavModules(page: Page): Promise<string[]> {
  const items = page.locator('.bo-sidebar a.bo-nav-item');
  return (await items.allTextContents()).map((t) => t.replace(/^[^\wÁÉÍÓÚÑa-z]+/u, '').trim());
}
