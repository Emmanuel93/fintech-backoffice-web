import { test, expect } from '@playwright/test';
import { login, logout, iniciaHistoria, historia, enfoca } from './fixtures';

/**
 * La mora, vista desde cobranza.
 *
 * El orquestador envejeció el calendario de la disposición y corrió el recálculo de días de
 * atraso —los dos pasos, porque mover el vencimiento sin recalcular deja `days_delinquent` en 0 y
 * todo se ve al corriente—. Aquí se comprueba que la consola lo cuente: el tablero, el tramo, y
 * que exista un caso que atender.
 *
 * Momentos de la historia (`historia()`), en orden: caso → tramo → resumen.
 */
const CUENTA = process.env.RE2E_CUENTA ?? '';
const PASSWORD = process.env.BO_STAFF_PASSWORD ?? 'Backoffice#2026';

/** Los tramos que son mora. «Al corriente» queda fuera a propósito: ver la aserción del caso. */
const TRAMO_EN_MORA = /1 a 30 días|31 a 60 días|61 a 90 días|91 a 120 días|121 a 180 días|Más de 180 días/;

/** Columnas de la bandeja de cobranza (mfe-collections/App.tsx): Deudor, Mora, Deuda, Qué toca… */
const COL_MORA = 1;
const COL_DEUDA = 2;
const COL_QUE_TOCA = 3;

// El video es entregable. Sin tamaño explícito Playwright lo encoge a que quepa en 800×800 y la
// bandeja salía a 800×450, ilegible. 1280×800 es el hueco del navegador en el video compuesto
// (`NAVEGADOR` en `tools/regresion-e2e/video.py`): a esa medida entra 1:1. Se fija aquí y no en
// `playwright.config.ts` porque las otras suites tienen sus propias medidas.
test.use({ viewport: { width: 1280, height: 800 }, video: { mode: 'on', size: { width: 1280, height: 800 } } });

test.describe('Regresión E2E · la mora en cobranza', () => {
  test('la cuenta atrasada mueve la cartera vencida y aparece como caso', async ({ page }) => {
    iniciaHistoria();
    // Cartera primero: el DPD nace ahí y cobranza lo consume.
    await login(page, 'analista@kredius.mx', PASSWORD);
    await page.goto('/cartera');
    await expect(page.locator('.bo-page-title')).toContainText(/cartera de crédito/i);
    await page.waitForTimeout(1000);

    await test.step('el reparto por tramo de atraso muestra cuentas fuera de CURRENT', async () => {
      await expect(page.getByText(/Reparto por tramo de atraso/i)).toBeVisible();
      await expect(page.getByText('Con algún atraso')).toBeVisible();
      // Señalados y no sólo afirmados: en el video es de donde sale el caso que se ve después.
      await enfoca(page, page.locator('.bo-stat', { hasText: 'Con algún atraso' }), 1400);
      await enfoca(page, page.locator('.bo-field-label', { hasText: /Reparto por tramo de atraso/i }).locator('xpath=..'), 1600);
    });

    // El valor exacto del DPD lo verifica el orquestador contra la base antes de llegar aquí
    // (`days_delinquent > 0`). Afirmarlo otra vez leyendo el innerText de toda la tabla sería una
    // aserción que casa con cualquier importe o fecha: verde siempre, informativa nunca.
    await page.waitForTimeout(800);
    await logout(page);

    // Cobranza: es la bandeja de quien tiene que llamar.
    await login(page, 'cobranza@kredius.mx', PASSWORD);
    await page.goto('/cobranza');
    await expect(page.locator('.bo-page-title')).toContainText(/cobranza/i);
    await page.waitForTimeout(1000);

    await test.step('el tablero de mora está calculado', async () => {
      await expect(page.getByText('Saldo en mora')).toBeVisible();
      await expect(page.getByText('Cuentas con atraso')).toBeVisible();
      await expect(page.getByText('Casos en la bandeja')).toBeVisible();
      await enfoca(page, page.locator('.bo-stat', { hasText: 'Saldo en mora' }), 1400);
    });

    // El caso que se enseña es uno en mora, no «la primera fila»: con la bandeja sembrada, la
    // primera puede estar al corriente y el video señalaría justo lo que no cuenta la historia.
    const filas = page.locator('.bo-table tbody tr');
    const caso = filas.filter({ hasText: TRAMO_EN_MORA }).first();

    await test.step('hay al menos un caso con su tramo', async () => {
      await expect(filas.first()).toBeVisible({ timeout: 20_000 });
      const texto = await page.locator('.bo-table').innerText();
      // Sin excluir «Al corriente» la aserción pasaría con la cartera entera al día, que es
      // justo lo contrario de lo que este caso comprueba.
      expect(texto, 'ningún caso cayó en un tramo de mora').toMatch(TRAMO_EN_MORA);
      if (CUENTA) {
        test.info().annotations.push({ type: 'cuenta del journey', description: CUENTA });
      }
      historia('caso');
      await enfoca(page, caso, 2200);
      await page.waitForTimeout(400);

      historia('tramo');
      await enfoca(page, caso.locator('td').nth(COL_MORA), 1600);
      await enfoca(page, caso.locator('td').nth(COL_DEUDA), 1400);
    });

    await test.step('el caso se abre y se lee', async () => {
      historia('resumen');
      await enfoca(page, caso.locator('td').nth(COL_QUE_TOCA), 1400);
      // Sólo se abre si la bandeja lo permite; si la fila no es clicable, lo que toca ya se leyó.
      if (/\bclickable\b/.test((await caso.getAttribute('class')) ?? '')) {
        await caso.click();
        const modal = page.locator('.bo-modal');
        await expect(modal).toBeVisible();
        await expect(modal).toContainText(/días/);
        // «La mora» trae tramo, días y qué toca: el resumen de lo que hay que hacer con el caso.
        const mora = modal.locator('.bo-grupo-cap', { hasText: 'La mora' }).locator('xpath=..');
        if (await mora.count()) await enfoca(page, mora, 2400);
        await page.waitForTimeout(800);
        await modal.getByRole('button', { name: 'Cerrar' }).click();
      }
    });

    await logout(page);
  });
});
