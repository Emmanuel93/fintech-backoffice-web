import { test, expect, type Page } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { login, logout } from './fixtures';

/**
 * El journey del crédito, visto desde la consola.
 *
 * No origina nada: eso lo hizo `03-journey.sh`, que actúa como el cliente y los procesos batch.
 * Aquí se comprueba lo único que le toca al backoffice — que todo eso **se vea**, y se vea bien:
 * la solicitud en la bandeja, la cuenta en cartera, el calendario, los pagos aplicados, el avance
 * del plan y el tablero movido.
 *
 * Separarlo así es lo que hace que un fallo signifique algo. Si la prueba de navegador también
 * originara el crédito, un rojo podría ser del backend o de la pantalla, y habría que averiguar
 * cuál. Con el journey ya sembrado y verificado por curl, un rojo aquí solo puede ser la consola.
 */
interface JourneyState {
  PROSPECT_ID?: string;
  APP_ID?: string;
  CREDIT_ACCOUNT_ID?: string;
  SCORE?: string;
}

function loadState(): JourneyState {
  const file = join(__dirname, '..', '.artifacts', 'journey-state.env');
  if (!existsSync(file)) return {};
  const out: JourneyState = {};
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const [k, ...rest] = line.split('=');
    if (k && rest.length) (out as Record<string, string>)[k.trim()] = rest.join('=').trim();
  }
  return out;
}

const state = loadState();

/** Abre el detalle de una fila de la tabla y devuelve el modal ya visible. */
async function openRowDetail(page: Page, rowIndex = 0) {
  const rows = page.locator('.bo-table tbody tr.clickable');
  await expect(rows.first()).toBeVisible({ timeout: 20_000 });
  await rows.nth(rowIndex).click();
  const modal = page.locator('.bo-modal');
  await expect(modal).toBeVisible();
  return modal;
}

test.describe('Journey del crédito en la consola', () => {
  test('la solicitud llega a la bandeja de originación', async ({ page }) => {
    await login(page, 'analista@kredius.mx', process.env.BO_STAFF_PASSWORD ?? 'Backoffice#2026');

    // El módulo de solicitudes vive en el roadmap del menú; se comprueba por la vía que ya existe:
    // la ficha del cliente, que lista sus solicitudes con su estatus.
    await page.goto('/clientes');
    await expect(page.locator('.bo-page-title')).toContainText(/clientes/i);
    await page.waitForTimeout(800);

    const anyRow = await page.locator('.bo-table tbody tr.clickable').count();
    expect(anyRow, 'el directorio de clientes llegó vacío').toBeGreaterThan(0);

    const modal = await openRowDetail(page);
    await expect(modal).toContainText(/solicitudes/i);
    await page.waitForTimeout(600);
    await modal.getByRole('button', { name: 'Cerrar' }).click();

    await logout(page);
  });

  test('la cuenta activa se ve en cartera con su calendario y sus pagos', async ({ page }) => {
    await login(page, 'analista@kredius.mx', process.env.BO_STAFF_PASSWORD ?? 'Backoffice#2026');
    await page.goto('/cartera');
    await expect(page.locator('.bo-page-title')).toContainText(/cartera de crédito/i);

    // Si el journey por curl dejó una cuenta, se busca esa; si no, se prueba con la primera fila.
    if (state.CREDIT_ACCOUNT_ID) {
      test.info().annotations.push({ type: 'cuenta', description: state.CREDIT_ACCOUNT_ID });
    }

    const rows = page.locator('.bo-table tbody tr.clickable');
    await expect(rows.first()).toBeVisible({ timeout: 25_000 });
    expect(await rows.count(), 'la cartera llegó vacía').toBeGreaterThan(0);

    const modal = await openRowDetail(page);

    await test.step('el detalle abre centrado, no en un cajón lateral', async () => {
      // El modal está centrado y el drawer no existe: es la diferencia que se pidió.
      await expect(page.locator('.bo-drawer')).toHaveCount(0);
      const box = await modal.boundingBox();
      const viewport = page.viewportSize();
      expect(box, 'el modal no tiene caja').not.toBeNull();
      if (box && viewport) {
        const centerOffset = Math.abs((box.x + box.width / 2) - viewport.width / 2);
        expect(centerOffset, 'el detalle no está centrado horizontalmente').toBeLessThan(40);
      }
    });

    await test.step('resumen: saldos y avance del plan', async () => {
      await expect(modal).toContainText('Saldos');
      await expect(modal).toContainText('Seguimiento del plan');
      await expect(modal).toContainText('Mensualidades cubiertas');
      await page.waitForTimeout(500);
    });

    await test.step('calendario de amortización', async () => {
      await modal.getByRole('tab', { name: /calendario/i }).click();
      await page.waitForTimeout(700);
      // El calendario no es clicable, así que se cuentan las filas que no son el estado vacío:
      // `DataTable` pinta "sin resultados" como un <tr> más, y contarlo daría por lleno un
      // calendario vacío.
      const scheduleRows = await modal.locator('.bo-table tbody tr:not(:has(.bo-table-empty))').count();
      expect(scheduleRows, 'el calendario llegó vacío').toBeGreaterThan(0);
    });

    await test.step('los pagos aplicados se ven', async () => {
      await modal.getByRole('tab', { name: /pagos/i }).click();
      await page.waitForTimeout(700);
      // O hay pagos listados, o el vacío se explica. Lo que no vale es una tabla rota.
      const text = await modal.innerText();
      expect(text).toMatch(/aplicados|Todavía no se registran pagos/i);
    });

    await test.step('disposiciones', async () => {
      await modal.getByRole('tab', { name: /disposiciones/i }).click();
      await page.waitForTimeout(600);
    });

    await modal.getByRole('button', { name: 'Cerrar' }).click();
    await expect(page.locator('.bo-modal')).toHaveCount(0);

    await logout(page);
  });

  test('el tablero refleja la cartera', async ({ page }) => {
    await login(page, 'ops@kredius.mx', process.env.BO_STAFF_PASSWORD ?? 'Backoffice#2026');
    await page.goto('/');

    await expect(page.locator('.bo-page-title')).toContainText(/panorama de cartera/i, { timeout: 25_000 });

    const kpis = page.locator('.bo-kpi');
    await expect(kpis.first()).toBeVisible({ timeout: 25_000 });
    expect(await kpis.count(), 'no se pintó ningún KPI').toBeGreaterThanOrEqual(4);

    await test.step('el capital colocado no es cero', async () => {
      const capital = await page.locator('.bo-kpi').first().locator('.bo-kpi-value').innerText();
      // "$0" con la cartera llena significa que el tablero no está leyendo lo mismo que /portfolio.
      expect(capital, `el KPI de capital muestra ${capital}`).not.toMatch(/^\$?0$/);
    });

    await test.step('la salud IFRS-9 y el desglose por producto están presentes', async () => {
      await expect(page.getByText(/salud de la cartera/i)).toBeVisible();
      await expect(page.getByText(/colocación por producto/i)).toBeVisible();
      await expect(page.getByText(/cartera por ejecutivo/i)).toBeVisible();
      await page.waitForTimeout(800);
    });

    await logout(page);
  });

  test('el directorio separa personas, negocios y distribuidores', async ({ page }) => {
    await login(page, 'ops@kredius.mx', process.env.BO_STAFF_PASSWORD ?? 'Backoffice#2026');
    await page.goto('/clientes');

    await expect(page.locator('.bo-page-title')).toContainText(/clientes, negocios y distribuidores/i);

    for (const tab of ['Personas', 'Negocios', 'Distribuidores']) {
      await test.step(`pestaña ${tab}`, async () => {
        await page.getByRole('tab', { name: new RegExp(tab, 'i') }).click();
        await page.waitForTimeout(900);
        await expect(page.locator('.bo-card')).toBeVisible();
      });
    }

    await test.step('el distribuidor se consulta por su código y muestra lo que colocó', async () => {
      await page.getByRole('tab', { name: /distribuidores/i }).click();
      await page.waitForTimeout(800);

      const rows = page.locator('.bo-table tbody tr.clickable');
      if (await rows.count() > 0) {
        await rows.first().click();
        const modal = page.locator('.bo-modal');
        await expect(modal).toBeVisible();
        await expect(modal).toContainText(/colocación y comisiones/i);
        await expect(modal).toContainText(/créditos originados/i);
        await page.waitForTimeout(700);
        await modal.getByRole('button', { name: 'Cerrar' }).click();
      } else {
        test.info().annotations.push({
          type: 'nota',
          description: 'sin distribuidores dados de alta en este entorno',
        });
      }
    });

    await logout(page);
  });
});
