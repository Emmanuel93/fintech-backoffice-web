import { test, expect, type Page } from '@playwright/test';
import { login } from './fixtures';

/**
 * El selector de tema.
 *
 * Lo que se verifica no es que el botón cambie un atributo —eso sería probar el propio código—
 * sino que el color que de verdad se pinta cambie con él y **persista** al recargar. Un tema que
 * se olvida en cada navegación es peor que no tenerlo: obliga a volver a pulsar el botón en cada
 * pantalla.
 */
async function bodyBackground(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.body).backgroundColor);
}

/** Luminancia aproximada de un `rgb(...)`, para distinguir claro de oscuro sin fijar un hex. */
function luminance(rgb: string): number {
  const m = rgb.match(/\d+/g);
  if (!m || m.length < 3) return -1;
  const [r, g, b] = m.map(Number);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

test.describe('Tema claro / oscuro', () => {
  test('el botón alterna el tema y la elección sobrevive a la recarga', async ({ page }) => {
    await login(page, 'ops@kredius.mx', process.env.BO_STAFF_PASSWORD ?? 'Backoffice#2026');

    const toggle = page.locator('.bo-theme-btn');
    await expect(toggle).toBeVisible();

    const before = await bodyBackground(page);
    const lumBefore = luminance(before);
    expect(lumBefore, `no se pudo leer el fondo (${before})`).toBeGreaterThanOrEqual(0);

    await test.step('un clic cambia el tema que se ve', async () => {
      await toggle.click();
      await page.waitForTimeout(400);
      const after = await bodyBackground(page);
      const lumAfter = luminance(after);

      expect(after, 'el fondo no cambió al pulsar el botón').not.toBe(before);
      // Claro y oscuro tienen que quedar a lados opuestos, no ser dos grises parecidos.
      expect(
        Math.abs(lumAfter - lumBefore),
        `el contraste entre temas es de solo ${Math.abs(lumAfter - lumBefore).toFixed(0)}`,
      ).toBeGreaterThan(60);
    });

    const chosen = await page.evaluate(() => document.documentElement.dataset.theme);
    expect(['light', 'dark']).toContain(chosen);

    await test.step('la elección persiste al recargar', async () => {
      const beforeReload = await bodyBackground(page);
      await page.reload();
      await expect(page.locator('.bo-frame')).toBeVisible({ timeout: 20_000 });
      await page.waitForTimeout(400);

      expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(chosen);
      expect(await bodyBackground(page), 'el tema se perdió al recargar').toBe(beforeReload);
    });

    await test.step('el tema se mantiene al cambiar de módulo federado', async () => {
      // Cada remoto inyecta sus estilos por su cuenta; si alguno reiniciara el tema, se vería aquí.
      for (const route of ['/cartera', '/clientes', '/']) {
        await page.goto(route);
        await page.waitForTimeout(700);
        expect(
          await page.evaluate(() => document.documentElement.dataset.theme),
          `el módulo ${route} perdió el tema`,
        ).toBe(chosen);
      }
    });

    await test.step('el texto sigue siendo legible en ambos temas', async () => {
      // La regresión clásica del tema: un color definido solo dentro del bloque oscuro deja texto
      // del mismo tono que el fondo. Se compara la luminancia del texto contra la del fondo.
      const title = page.locator('.bo-page-title');
      for (const _ of [0, 1]) {
        // El módulo puede seguir cargando tras la navegación; sin esperar al título se leería
        // el color de un elemento que aún no existe y el fallo hablaría de otra cosa.
        await expect(title).toBeVisible({ timeout: 20_000 });
        const bg = luminance(await bodyBackground(page));
        const fg = luminance(await title.evaluate((el) => getComputedStyle(el).color));
        expect(
          Math.abs(fg - bg),
          `título y fondo casi del mismo tono (texto ${fg.toFixed(0)}, fondo ${bg.toFixed(0)})`,
        ).toBeGreaterThan(70);
        await toggle.click();
        await page.waitForTimeout(400);
      }
    });
  });

  test('el tema también se puede elegir antes de entrar', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.bo-login')).toBeVisible();

    const toggle = page.locator('.bo-theme-btn');
    await expect(toggle).toBeVisible();

    const before = await bodyBackground(page);
    await toggle.click();
    await page.waitForTimeout(400);
    expect(await bodyBackground(page), 'el tema no cambia en la pantalla de login').not.toBe(before);
  });
});
