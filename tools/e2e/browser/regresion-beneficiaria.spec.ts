import { test, expect, type Page, type Locator } from '@playwright/test';
import { login, logout, iniciaHistoria, historia, enfoca, encuadraDocumento } from './fixtures';

/**
 * La mesa de KYC comprueba la identidad de una beneficiaria.
 *
 * Va después de `regresion-kyc-web.spec.ts`: ella ya subió su INE y su selfie desde la liga, y la
 * colocación quedó esperando a que alguien de la financiera las compare. Ese dictamen es lo único
 * que habilita el depósito. El orquestador pasa el id de la colocación y el nombre con que aparece.
 *
 * Momentos de la historia (`historia()`), en orden: expediente → documentos → comprobada.
 */
const PLACEMENT_ID = process.env.RE2E_PLACEMENT_ID ?? '';
const BENEFICIARIA = process.env.RE2E_BENEFICIARIA ?? '';
const PASSWORD = process.env.BO_STAFF_PASSWORD ?? 'Backoffice#2026';

/** Columna «Identidad» de la bandeja (Beneficiarios.tsx): la sexta. */
const COL_IDENTIDAD = 5;

// El video es entregable. Sin tamaño explícito Playwright lo encoge a que quepa en 800×800 y la
// ficha salía a 800×450, ilegible. 1280×800 es el hueco del navegador en el video compuesto
// (`NAVEGADOR` en `tools/regresion-e2e/video.py`): a esa medida entra 1:1. Se fija aquí y no en
// `playwright.config.ts` porque las otras suites tienen sus propias medidas.
test.use({ viewport: { width: 1280, height: 800 }, video: { mode: 'on', size: { width: 1280, height: 800 } } });

test.describe('Regresión E2E · identidad de la beneficiaria', () => {
  test.skip(!PLACEMENT_ID || !BENEFICIARIA, 'sin RE2E_PLACEMENT_ID y RE2E_BENEFICIARIA no hay colocación que dictaminar');

  test('la mesa abre su expediente, mira INE y selfie, y firma que es ella', async ({ page }) => {
    iniciaHistoria();
    await login(page, 'ops@kredius.mx', PASSWORD);
    await abrirBandeja(page);

    const filaAntes = filaDe(page);
    await expect(filaAntes.first(), `no encontré a ${BENEFICIARIA} en la bandeja`).toBeVisible({ timeout: 25_000 });
    const identidadAntes = (await filaAntes.first().locator('td').nth(COL_IDENTIDAD).innerText()).trim();
    expect(identidadAntes, 'antes del dictamen no debe estar comprobada').not.toContain('Comprobada');
    await page.waitForTimeout(600);

    // El momento empieza en la fila, no en el modal: el anillo sobre su nombre es lo que dice
    // de quién es el expediente que se abre.
    historia('expediente');
    const ficha = await abrirColocacion(page);

    await test.step('el expediente trae INE y selfie, y se abren en la ficha', async () => {
      await expect(ficha).toContainText('Su expediente de identidad');
      await enfoca(page, seccion(ficha, 'La colocación'), 2000);
      await page.waitForTimeout(500);

      historia('documentos');
      await abrirDocumento(page, ficha, /INE — frente/);
      await abrirDocumento(page, ficha, /Selfie/);
      // Lo que capturó y lo que firmó es contra lo que se lee la INE: se señala, aunque sea breve.
      await enfoca(page, apartado(ficha, 'Lo que capturó'), 1800);
      await enfoca(page, apartado(ficha, 'Lo que firmó'), 1400);
    });

    await test.step('«No es ella» sin motivo está cerrado', async () => {
      await expect(ficha.getByRole('button', { name: 'No es ella', exact: true })).toBeDisabled();
    });

    await test.step('firma que su identidad está comprobada', async () => {
      historia('comprobada');
      const comprobada = ficha.getByRole('button', { name: 'Identidad comprobada', exact: true });
      await enfoca(page, comprobada, 1600);
      await comprobada.click();
    });

    await expect(page.locator('.bo-modal'), 'el dictamen cierra la ficha').toHaveCount(0, { timeout: 20_000 });
    await page.waitForTimeout(1000);

    await test.step('la fila cambia de identidad', async () => {
      await page.reload();
      await abrirBandeja(page);
      const celda = filaDe(page).first().locator('td').nth(COL_IDENTIDAD);
      await expect(celda).toContainText('Comprobada', { timeout: 20_000 });
      await expect(celda).not.toHaveText(identidadAntes);
      // El cierre de la historia es este chip: es lo que habilita el depósito.
      await enfoca(page, celda, 2200);
      await page.waitForTimeout(800);
    });

    await logout(page);
  });
});

async function abrirBandeja(page: Page) {
  await page.goto('/beneficiarios');
  await expect(page.locator('.bo-page-title')).toContainText('Beneficiarios');
  await expect(page.locator('.bo-table')).toBeVisible({ timeout: 25_000 });
}

function filaDe(page: Page): Locator {
  return page.locator('.bo-table tbody tr.clickable').filter({ hasText: BENEFICIARIA });
}

/**
 * Abre la fila de la beneficiaria y comprueba que es **la** colocación: la misma persona puede
 * tener más de una, y la tabla no publica el id. Se reconoce por la ficha que pide la consola.
 */
async function abrirColocacion(page: Page): Promise<Locator> {
  const modal = page.locator('.bo-modal');
  const filas = filaDe(page);
  const total = Math.min(await filas.count(), 10);
  for (let i = 0; i < total; i++) {
    await enfoca(page, filas.nth(i), i === 0 ? 1400 : 700);
    const ficha = page.waitForResponse((r) => /\/beneficiaries\/placements\/[^/?]+$/.test(new URL(r.url()).pathname));
    await filas.nth(i).click();
    const respuesta = await ficha;
    await expect(modal).toBeVisible();
    if (respuesta.url().includes(PLACEMENT_ID)) {
      await expect(modal.getByText('Por dónde pasó')).toBeVisible({ timeout: 20_000 });
      return modal;
    }
    await modal.getByRole('button', { name: 'Cerrar' }).click();
    await expect(modal).toHaveCount(0);
  }
  throw new Error(`no encontré la colocación ${PLACEMENT_ID} de ${BENEFICIARIA}`);
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

/** La sección del modal que encabeza `titulo` (su `.bo-grupo-cap`). */
function seccion(ficha: Locator, titulo: string): Locator {
  return ficha.locator('.bo-grupo-cap', { hasText: titulo }).locator('xpath=..');
}

/** Un apartado del expediente («Lo que capturó», «Lo que firmó»): el bloque bajo su `<h5>`. */
function apartado(ficha: Locator, titulo: string): Locator {
  return ficha.getByRole('heading', { name: titulo, exact: true }).locator('xpath=..');
}
