import { test, expect } from '@playwright/test';
import { ROLES, login, logout, visibleNavModules } from './fixtures';

/**
 * Recorrido grabado de la consola con cada rol.
 *
 * Se comprueban dos cosas distintas y ninguna sustituye a la otra:
 *
 *   · **Lo que se ve.** Que el menú muestre exactamente los módulos del rol. Esto hace la consola
 *     usable — a un gestor de cobranza no le sirve ver "Productos" —, pero no la hace segura.
 *
 *   · **Lo que responde.** Que al escribir la ruta a mano el servidor la niegue. Ocultar un módulo
 *     del menú no protege nada: quien tiene sesión puede teclear /cartera. El corte real está en
 *     el BFF, y esta parte es la que lo verifica.
 *
 * Un módulo oculto cuya ruta sí responde es el fallo silencioso que esta prueba existe para
 * encontrar.
 */
test.describe('RBAC por rol', () => {
  for (const role of ROLES) {
    test(`${role.key} — ${role.displayName}`, async ({ page }) => {
      await test.step(`entra como ${role.email}`, async () => {
        await login(page, role.email, role.password);
      });

      await test.step('el menú muestra sus módulos y solo los suyos', async () => {
        const visible = await visibleNavModules(page);

        for (const mod of role.visibleModules) {
          expect(visible, `${role.key} debería ver "${mod}" en el menú`).toContain(mod);
        }
        for (const mod of role.hiddenModules) {
          expect(visible, `${role.key} NO debería ver "${mod}" en el menú`).not.toContain(mod);
        }
      });

      await test.step('recorre los módulos a los que sí tiene acceso', async () => {
        for (const route of role.allowedRoutes) {
          await page.goto(route);
          // El módulo cargó cuando aparece su encabezado; un remoto que falla deja la zona vacía.
          await expect(page.locator('.bo-content')).toBeVisible();
          await expect(page.locator('.bo-page-title, .bo-spinner').first()).toBeVisible({ timeout: 20_000 });
          await page.waitForTimeout(600); // deja que la tabla pinte antes del siguiente cuadro del vídeo
          await expect(page.locator('.bo-page-title')).toBeVisible({ timeout: 20_000 });
        }
      });

      await test.step('las rutas que no le tocan no le entregan datos', async () => {
        for (const route of role.deniedRoutes) {
          await page.goto(route);
          await page.waitForTimeout(1200);

          // El servidor manda: o el módulo no pinta contenido, o pinta el error de autorización.
          // Lo que no puede pasar es que se llene de filas.
          const rows = await page.locator('.bo-table tbody tr.clickable').count();
          const bodyText = (await page.locator('.bo-content').innerText().catch(() => '')) || '';
          const denied = /no autorizado|403|sin permiso|sesión expirada/i.test(bodyText);

          expect(
            rows === 0 || denied,
            `${role.key} pidió ${route} a mano y recibió ${rows} filas de datos`,
          ).toBeTruthy();
        }
      });

      await test.step('cierra sesión', async () => {
        await logout(page);
      });
    });
  }
});

test('sin sesión, cualquier ruta lleva al login', async ({ page }) => {
  for (const route of ['/', '/cartera', '/clientes', '/productos']) {
    await page.goto(route);
    await expect(page.locator('.bo-login')).toBeVisible({ timeout: 15_000 });
  }
});
