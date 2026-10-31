import { test, expect, type Page, type Locator } from '@playwright/test';
import { login, logout, iniciaHistoria, historia, enfoca, encuadraDocumento } from './fixtures';

/**
 * La mesa de cumplimiento dictamina la identidad de una persona, a mano.
 *
 * Sin proveedor biométrico, la identidad de quien pidió crédito se queda en `IN_REVIEW` hasta que
 * alguien compara su INE contra su selfie. El orquestador ya creó a esa persona desde la app y
 * pasa aquí su nombre o su CURP (`RE2E_PERSONA`); este spec hace lo que le toca a la consola: que
 * aparezca en la cola de por dictaminar, que la ficha deje ver los documentos, que la firma exija
 * notas, y que al firmar salga de la cola.
 *
 * Momentos de la historia (`historia()`), en orden: cola → expediente → documentos → listas → firma.
 */
const PERSONA = process.env.RE2E_PERSONA ?? '';
const ACCION = (process.env.RE2E_ACCION ?? 'aprobar') as 'aprobar' | 'rechazar';
const NOTAS = process.env.RE2E_NOTAS
  ?? 'Comparé la foto de la INE contra la selfie: es la misma persona. Nombre, CURP y fecha de nacimiento coinciden con lo capturado.';
const NOTAS_LISTAS = process.env.RE2E_NOTAS_LISTAS
  ?? 'Homónimo: la fecha de nacimiento y la CURP no coinciden con el registro listado.';
const PASSWORD = process.env.BO_STAFF_PASSWORD ?? 'Backoffice#2026';

// El video es entregable. Sin tamaño explícito Playwright lo encoge a que quepa en 800×800 y la
// ficha salía a 800×450, ilegible. 1280×800 es el hueco del navegador en el video compuesto
// (`NAVEGADOR` en `tools/regresion-e2e/video.py`): a esa medida entra 1:1. Se fija aquí y no en
// `playwright.config.ts` porque las otras suites tienen sus propias medidas.
test.use({ viewport: { width: 1280, height: 800 }, video: { mode: 'on', size: { width: 1280, height: 800 } } });

test.describe('Regresión E2E · dictamen de identidad en cumplimiento', () => {
  test.skip(!PERSONA, 'sin RE2E_PERSONA no hay a quién dictaminar');

  test('la persona llega a la cola de por dictaminar y la mesa firma su identidad', async ({ page }) => {
    iniciaHistoria();
    await login(page, 'ops@kredius.mx', PASSWORD);
    await abrirMesa(page);

    const fila = await test.step('la mesa abre filtrada a lo que espera dictamen', async () => {
      const filtro = page.getByLabel('Estado de la identidad');
      await expect(filtro).toHaveValue('IN_REVIEW');
      const suya = await filaDe(page, PERSONA);
      historia('cola');
      await enfoca(page, filtro);
      await enfoca(page, suya, 1600);
      return suya;
    });

    historia('expediente');
    const ficha = await abrirFicha(page, fila);

    await test.step('la ficha dice quién comprueba la identidad y deja ver la INE', async () => {
      await expect(ficha).toContainText('Sin proveedor biométrico conectado');
      await enfoca(page, ficha.locator('.bo-huerfanos', { hasText: 'Sin proveedor biométrico' }));
      // Lo capturado va primero porque es contra lo que se lee la INE.
      await enfoca(page, seccion(ficha, 'La persona'), 2200);

      historia('documentos');
      await abrirDocumento(page, ficha, /INE — frente/);
      // La selfie es la otra mitad de la comparación; si la subió, se abre también.
      const selfie = ficha.locator('.bo-doc-head').filter({ hasText: /Selfie|Prueba de vida/ });
      if (await selfie.count()) await abrirDocumento(page, ficha, /Selfie|Prueba de vida/);
    });

    await test.step('lo que dijeron las listas', async () => {
      historia('listas');
      await enfoca(page, seccion(ficha, 'Cotejos contra listas'), 2400);
      await page.waitForTimeout(600);
    });

    const aprobar = ficha.getByRole('button', { name: 'Aprobar identidad', exact: true });
    const rechazar = ficha.getByRole('button', { name: 'Rechazar identidad', exact: true });

    await test.step('firmar sin notas está cerrado', async () => {
      // Sin proveedor, «aprobada» sólo vale lo que diga quién miró qué: sin notas no hay dictamen.
      await expect(aprobar).toBeDisabled();
      await expect(rechazar).toBeDisabled();
    });

    await test.step('dictamina la identidad', async () => {
      historia('firma');
      const notas = ficha.getByPlaceholder('Qué revisaste y por qué');
      // Tecleadas y no pegadas: en el video, unas notas que aparecen de golpe no se leen como
      // algo que alguien escribió después de mirar.
      await enfoca(page, notas, 900, () => notas.pressSequentially(NOTAS, { delay: 25 }));
      await page.waitForTimeout(500);
      const firma = ACCION === 'rechazar' ? rechazar : aprobar;
      await enfoca(page, firma);
      await firma.click();
    });

    await test.step('si quedan las listas por resolver, despeja la homonimia', async () => {
      // La ficha sólo sigue abierta si queda la otra firma —listas— y este rol puede darla. La
      // caja de listas puede estar desde antes del dictamen, así que no basta con verla: hay que
      // esperar a que la ficha se recargue, que es cuando desaparece la caja de identidad.
      const despejar = page.getByRole('button', { name: 'Despejar homonimia', exact: true });
      const identidadFirmada = page.getByRole('button', { name: 'Aprobar identidad', exact: true });
      await expect.poll(
        async () => (await page.locator('.bo-modal').count()) === 0
          || ((await identidadFirmada.count()) === 0 && (await despejar.isVisible())),
        { timeout: 20_000, message: 'tras el dictamen, la ficha se cierra o pide resolver las listas' },
      ).toBe(true);

      if (await despejar.isVisible()) {
        // La caja entera primero: que se vea que es otra firma, no la misma repetida.
        await enfoca(page, despejar.locator('xpath=ancestor::section[1]'), 1600);
        const notas = page.getByPlaceholder('Por qué se despeja o se confirma');
        await enfoca(page, notas, 800, () => notas.pressSequentially(NOTAS_LISTAS, { delay: 25 }));
        await page.waitForTimeout(500);
        await enfoca(page, despejar);
        await despejar.click();
      }
    });

    await expect(page.locator('.bo-modal'), 'el dictamen cierra la ficha').toHaveCount(0, { timeout: 20_000 });
    await page.waitForTimeout(1500);

    await test.step('la persona sale de la cola de por dictaminar', async () => {
      await page.reload();
      await abrirMesa(page);
      await expect(page.getByLabel('Estado de la identidad')).toHaveValue('IN_REVIEW');
      await expect(page.locator('.bo-table tbody tr.clickable').filter({ hasText: PERSONA })).toHaveCount(0);
      await page.waitForTimeout(1200);
    });

    await logout(page);
  });
});

async function abrirMesa(page: Page) {
  await page.goto('/cumplimiento');
  await expect(page.locator('.bo-page-title')).toContainText('Cumplimiento');
  // La tabla se pinta siempre que la consulta contesta —con filas o con «Nada por dictaminar»—:
  // esperarla es esperar a que la cola cargue, no a que traiga algo.
  await expect(page.locator('.bo-table')).toBeVisible({ timeout: 25_000 });
}

/**
 * La fila de la persona. Si no está entre las primeras cincuenta, se busca: la mesa puede tener
 * cola sembrada, y abrir «la primera» sería dictaminar a alguien más.
 */
async function filaDe(page: Page, persona: string): Promise<Locator> {
  const filas = page.locator('.bo-table tbody tr.clickable').filter({ hasText: persona });
  if ((await filas.count()) === 0) {
    const buscar = page.getByLabel('Buscar persona');
    await enfoca(page, buscar, 700, () => buscar.pressSequentially(persona, { delay: 40 }));
    await page.waitForTimeout(1200);
  }
  await expect(filas.first(), `no encontré a ${persona} en la cola de por dictaminar`).toBeVisible({ timeout: 20_000 });
  return filas.first();
}

async function abrirFicha(page: Page, fila: Locator): Promise<Locator> {
  await fila.click();
  const modal = page.locator('.bo-modal');
  await expect(modal).toBeVisible();
  await expect(modal.locator('.bo-grupo-cap').first()).toBeVisible({ timeout: 20_000 });
  return modal;
}

/** La sección de la ficha que encabeza `titulo`: el rótulo es lo único estable que la nombra. */
function seccion(ficha: Locator, titulo: string): Locator {
  return ficha.locator('.bo-grupo-cap', { hasText: titulo }).locator('xpath=..');
}

async function abrirDocumento(page: Page, ficha: Locator, tipo: RegExp) {
  const cabecera = ficha.locator('.bo-doc-head').filter({ hasText: tipo }).first();
  await enfoca(page, cabecera, 900);
  await cabecera.click();
  const archivo = ficha.locator('.bo-doc.open .bo-doc-canvas img, .bo-doc.open .bo-doc-canvas iframe').first();
  await expect(archivo, 'el archivo se abre dentro de la ficha').toBeVisible({ timeout: 20_000 });
  // Completo y al centro: es el momento que el video existe para enseñar.
  await encuadraDocumento(page, archivo);
  await page.waitForTimeout(3000);
}
