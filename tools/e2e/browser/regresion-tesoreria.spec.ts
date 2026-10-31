import { test, expect, type Page, type Locator } from '@playwright/test';
import { login, logout, iniciaHistoria, historia, enfoca, senala } from './fixtures';

/**
 * El SPEI de la colocación, rastreado de punta a punta: la cuenta ordenante ligada al mayor, la
 * dispersión a la clienta y su rastro —clave, recorrido, CEP y la cadena hasta la póliza—.
 *
 * Es la demo completa y es de **sólo lectura**: el CEP se señala, no se abre (es de Banxico y
 * sacaría al video de la consola). Tolera lo opcional con un `##AVISO##`: si stp-service no
 * contesta, la ficha dice «sin dato» y el video sigue. Lo único que exige es que la pantalla abra.
 *
 * Momentos de la historia (`historia()`), en orden: cuentas → dispersion → rastreo.
 */
const BENEFICIARIA = process.env.RE2E_BENEFICIARIA ?? '';
const CLAVE = process.env.RE2E_CLAVE_RASTREO ?? '';
const PASSWORD = process.env.BO_STAFF_PASSWORD ?? 'Backoffice#2026';

/** Columnas de «Dispersiones SPEI» (Tesoreria.tsx). */
const COL = { clave: 4, estatus: 5 } as const;

// El video es entregable: 1280×800 es el hueco del navegador en el video compuesto, y a esa medida
// entra 1:1. Se fija aquí y no en `playwright.config.ts` porque las otras suites tienen las suyas.
test.use({ viewport: { width: 1280, height: 800 }, video: { mode: 'on', size: { width: 1280, height: 800 } } });

test.describe('Demo completa · el SPEI, rastreado de punta a punta', () => {
  test.skip(!BENEFICIARIA && !CLAVE, 'sin RE2E_BENEFICIARIA ni RE2E_CLAVE_RASTREO no hay SPEI que rastrear');

  test('la cuenta ordenante, la dispersión al cliente final y su rastro completo', async ({ page }) => {
    test.setTimeout(240_000);
    iniciaHistoria();
    await login(page, 'finanzas@kredius.mx', PASSWORD);

    await page.goto('/contabilidad/tesoreria');
    await expect(page.locator('.bo-page-title')).toContainText('Bancos y tesorería');
    const cuentas = tarjeta(page, 'Cuentas bancarias');
    await expect(cuentas).toBeVisible({ timeout: 25_000 });
    await page.waitForTimeout(800);

    await test.step('cuentas: la ordenante, ligada a la contabilidad', async () => {
      historia('cuentas');
      const filas = cuentas.locator('.bo-table tbody tr:not(:has(.bo-table-empty))');
      if (!(await esperaVisible(filas.first(), 20_000))) {
        aviso('tesorería no devolvió cuentas bancarias');
        await page.waitForTimeout(3000);
        return;
      }
      const ordenante = filas.filter({ hasText: 'Cuenta ordenante' }).first();
      const fila = (await ordenante.count()) ? ordenante : filas.filter({ hasText: '1101' }).first();
      const cual = (await fila.count()) ? fila : filas.first();
      await senala(page, cual, 'Cuenta ordenante (STP), ligada a la cuenta 1101', 3400);
      await senala(page, cual.locator('td').nth(3),
        'Cada salida se abona a 1101 · Bancos', 3000);
      const rutas = tarjeta(page, 'Rutas de pago');
      const spei = rutas.locator('.bo-table tbody tr').filter({ hasText: 'SPEI' }).first();
      if (await spei.count()) await senala(page, spei, 'Ruta de pago: SPEI vía STP', 2600);
    });

    const fila = await test.step('dispersion: el SPEI al cliente final', async () => {
      historia('dispersion');
      const tabla = tarjeta(page, 'Dispersiones SPEI');
      const buscador = page.getByPlaceholder('Beneficiario o clave de rastreo');
      const filas = tabla.locator('.bo-table tbody tr.clickable');

      const busca = async (texto: string): Promise<Locator | null> => {
        await enfoca(page, buscador, 700, async () => {
          await buscador.clear();
          await buscador.pressSequentially(texto, { delay: 45 });
        });
        await page.waitForTimeout(1200);
        const suyas = filas.filter({ hasText: texto });
        const de45 = suyas.filter({ hasText: /45,000/ }).first();
        if (await esperaVisible(de45, 12_000)) return de45;
        return (await suyas.count()) ? suyas.first() : null;
      };

      const encontrada = (BENEFICIARIA ? await busca(BENEFICIARIA) : null) ?? (CLAVE ? await busca(CLAVE) : null);
      if (!encontrada) {
        aviso(`no encontré el SPEI de ${BENEFICIARIA || CLAVE} en tesorería`);
        await page.waitForTimeout(3000);
        return null;
      }
      const monto = (await encontrada.locator('td').nth(3).innerText()).trim();
      await senala(page, encontrada, `SPEI a ${BENEFICIARIA || 'cliente final'} · ${monto}`, 3400);
      const clave = encontrada.locator('td').nth(COL.clave);
      if ((await clave.innerText()).trim().startsWith('sin')) aviso('la dispersión todavía no tiene clave de rastreo');
      else await senala(page, clave, 'Clave de rastreo: localiza el pago en cualquier banco', 2800);
      const estatus = encontrada.locator('td').nth(COL.estatus).locator('.bo-badge');
      const texto = (await estatus.innerText()).trim();
      await senala(page, estatus,
        texto === 'Liquidada' ? 'Liquidada: el banco receptor ya abonó' : `${texto}: aún sin abonar`, 2800);
      return encontrada;
    });

    await test.step('rastreo: clave, recorrido, CEP y la cadena hasta la póliza', async () => {
      historia('rastreo');
      if (!fila) { await page.waitForTimeout(3000); return; }
      await enfoca(page, fila, 700);
      await fila.click();
      const modal = page.locator('.bo-modal');
      await expect(modal).toBeVisible();
      // El detalle compone tres servicios; hasta que llega, sólo está la fila.
      await expect(seccion(modal, 'Por dónde pasó')).toBeVisible({ timeout: 20_000 });
      await page.waitForTimeout(700);

      const clave = defRow(page, seccion(modal, 'La dispersión'), 'Clave de rastreo');
      await senala(page, clave, 'Clave de rastreo SPEI', 3000);

      const recorrido = modal.locator('.bo-timeline');
      if (await recorrido.count()) {
        await senala(page, recorrido, 'Solicitada → Enviada → Aceptada → Liquidada', 3400);
      } else {
        aviso('la dispersión no trae recorrido (sin dato de disbursement-service)');
      }

      const cep = modal.getByRole('link', { name: /comprobante CEP/i });
      if (await cep.count()) {
        await senala(page, cep, 'CEP de Banxico: comprobante de entrega', 3000);
      } else {
        aviso('la dispersión no trae CEP (sin liquidar o sin dato de stp-service)');
        await senala(page, seccion(modal, 'Orden en STP'), 'La orden en STP', 2400);
      }

      const rastro = seccion(modal, 'Rastro del dinero');
      const texto = (await rastro.innerText()).trim();
      await senala(page, rastro,
        texto.includes('Cadena completa') ? 'De la disposición a la póliza: cadena completa'
          : texto.includes('Sin dato') ? 'Rastro del dinero: sin respuesta de banca'
            : 'La cadena indica qué eslabón falta', 3600);
      await page.waitForTimeout(800);
      await modal.getByRole('button', { name: 'Cerrar' }).click();
      await expect(modal).toHaveCount(0);
    });

    await logout(page);
  });
});

function aviso(texto: string): void {
  console.log(`##AVISO## ${texto}`);
}

async function esperaVisible(loc: Locator, timeout: number): Promise<boolean> {
  try {
    await expect(loc).toBeVisible({ timeout });
    return true;
  } catch {
    return false;
  }
}

function escapa(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Una tarjeta por el principio de su encabezado («Dispersiones SPEI · 8»). */
function tarjeta(page: Page, titulo: string): Locator {
  return page.locator('.bo-card')
    .filter({ has: page.locator('.bo-card-head', { hasText: new RegExp(`^${escapa(titulo)}`) }) })
    .first();
}

/** La sección de la ficha que encabeza `titulo`: el rótulo es lo único estable que la nombra. */
function seccion(ficha: Locator, titulo: string): Locator {
  return ficha.locator('.bo-grupo-cap', { hasText: new RegExp(`^${escapa(titulo)}$`) }).locator('xpath=..');
}

function defRow(page: Page, dentro: Locator, rotulo: string): Locator {
  return dentro.locator('.bo-defs > div')
    .filter({ has: page.locator('.bo-def-k', { hasText: new RegExp(`^${escapa(rotulo)}$`) }) })
    .first();
}
