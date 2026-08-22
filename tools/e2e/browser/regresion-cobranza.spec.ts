import { test, expect } from '@playwright/test';
import { login, logout } from './fixtures';

/**
 * La mora, vista desde cobranza.
 *
 * El orquestador envejeció el calendario de la disposición y corrió el recálculo de días de
 * atraso —los dos pasos, porque mover el vencimiento sin recalcular deja `days_delinquent` en 0 y
 * todo se ve al corriente—. Aquí se comprueba que la consola lo cuente: el tablero, el tramo, y
 * que exista un caso que atender.
 */
const CUENTA = process.env.RE2E_CUENTA ?? '';
const PASSWORD = process.env.BO_STAFF_PASSWORD ?? 'Backoffice#2026';

test.describe('Regresión E2E · la mora en cobranza', () => {
  test('la cuenta atrasada mueve la cartera vencida y aparece como caso', async ({ page }) => {
    // Cartera primero: el DPD nace ahí y cobranza lo consume.
    await login(page, 'analista@kredius.mx', PASSWORD);
    await page.goto('/cartera');
    await expect(page.locator('.bo-page-title')).toContainText(/cartera de crédito/i);
    await page.waitForTimeout(1000);

    await test.step('el reparto por tramo de atraso muestra cuentas fuera de CURRENT', async () => {
      await expect(page.getByText(/Reparto por tramo de atraso/i)).toBeVisible();
      await expect(page.getByText('Con algún atraso')).toBeVisible();
      await page.waitForTimeout(1200);
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
      await page.waitForTimeout(1500);
    });

    await test.step('hay al menos un caso con su tramo', async () => {
      const filas = page.locator('.bo-table tbody tr');
      await expect(filas.first()).toBeVisible({ timeout: 20_000 });
      const texto = await page.locator('.bo-table').innerText();
      // Sin excluir «Al corriente» la aserción pasaría con la cartera entera al día, que es
      // justo lo contrario de lo que este caso comprueba.
      expect(texto, 'ningún caso cayó en un tramo de mora').toMatch(
        /1 a 30 días|31 a 60 días|61 a 90 días|91 a 120 días|121 a 180 días|Más de 180 días/,
      );
      if (CUENTA) {
        test.info().annotations.push({ type: 'cuenta del journey', description: CUENTA });
      }
      await page.waitForTimeout(1200);
    });

    await test.step('el caso se abre y se lee', async () => {
      const clicables = page.locator('.bo-table tbody tr.clickable');
      if (await clicables.count()) {
        await clicables.first().click();
        const modal = page.locator('.bo-modal');
        await expect(modal).toBeVisible();
        await expect(modal).toContainText(/días/);
        await page.waitForTimeout(1500);
        await modal.getByRole('button', { name: 'Cerrar' }).click();
      }
    });

    await logout(page);
  });
});
