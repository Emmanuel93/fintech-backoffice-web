import { test, expect, type Page, type Locator } from '@playwright/test';
import { login, logout, iniciaHistoria, historia, enfoca, senala } from './fixtures';

/**
 * La colocación de la distribuidora, vista por operación: depositada, con su dictamen y dentro de
 * la línea de quien la colocó.
 *
 * Es la demo completa, no una regresión de flujo: la colocación ya ocurrió en los actos anteriores
 * (la liga, el dictamen, la aprobación de la distribuidora, el SPEI) y aquí sólo se lee. Por eso es
 * de **sólo lectura** y tolera lo opcional —una fila que todavía no llega, un dictamen sin firmante—
 * con un `##AVISO##` en vez de tirar el video entero. Lo único que exige es que las pantallas abran.
 *
 * Momentos de la historia (`historia()`), en orden: lista → ficha → cartera.
 */
const BENEFICIARIA = process.env.RE2E_BENEFICIARIA ?? '';
const DISTRIBUIDORA = process.env.RE2E_DISTRIBUIDORA ?? 'LAURA MÉNDEZ SOTO';
const CONTRATO = process.env.RE2E_CONTRATO ?? '';
const CUENTA = process.env.RE2E_CUENTA ?? '';
const PASSWORD = process.env.BO_STAFF_PASSWORD ?? 'Backoffice#2026';

/** Columnas de la bandeja de colocaciones (Beneficiarios.tsx). */
const COL = { distribuidora: 1, paso: 4, identidad: 5 } as const;

// El video es entregable: 1280×800 es el hueco del navegador en el video compuesto, y a esa medida
// entra 1:1. Se fija aquí y no en `playwright.config.ts` porque las otras suites tienen las suyas.
test.use({ viewport: { width: 1280, height: 800 }, video: { mode: 'on', size: { width: 1280, height: 800 } } });

test.describe('Demo completa · la colocación vista por operación', () => {
  test.skip(!BENEFICIARIA || (!CONTRATO && !CUENTA),
    'sin RE2E_BENEFICIARIA y RE2E_CONTRATO/RE2E_CUENTA no hay colocación que enseñar');

  test('la colocación está depositada, con su dictamen, y suma en la línea de la distribuidora', async ({ page }) => {
    test.setTimeout(240_000);
    iniciaHistoria();
    await login(page, 'ops@kredius.mx', PASSWORD);

    await page.goto('/beneficiarios');
    await expect(page.locator('.bo-page-title')).toContainText('Beneficiarios');
    await expect(page.locator('.bo-table')).toBeVisible({ timeout: 25_000 });
    await page.waitForTimeout(800);

    const fila = await filaDeLaColocacion(page);

    await test.step('lista: la colocación de su cliente, depositada y con identidad comprobada', async () => {
      historia('lista');
      if (!fila) {
        aviso(`no encontré a ${BENEFICIARIA} en la bandeja de colocaciones`);
        await page.waitForTimeout(3000);
        return;
      }
      await senala(page, fila, `La colocación de ${BENEFICIARIA}`, 3000);
      await senala(page, fila.locator('td').nth(COL.distribuidora),
        `Colocada por ${titulo(DISTRIBUIDORA)}: riesgo y deuda a su cargo`, 3000);
      const paso = (await fila.locator('td').nth(COL.paso).locator('.bo-badge').innerText()).trim();
      await senala(page, fila.locator('td').nth(COL.paso).locator('.bo-badge'), queDicePaso(paso), 2800);
      const identidad = (await fila.locator('td').nth(COL.identidad).locator('.bo-badge').innerText()).trim();
      await senala(page, fila.locator('td').nth(COL.identidad).locator('.bo-badge'),
        identidad === 'Comprobada' ? 'Identidad comprobada en revisión manual' : `Identidad: ${identidad}`, 2800);
    });

    await test.step('ficha: quién comprobó su identidad, cuándo, y por dónde pasó', async () => {
      historia('ficha');
      if (!fila) {
        await page.waitForTimeout(3000);
        return;
      }
      await enfoca(page, fila, 900);
      await fila.click();
      const modal = page.locator('.bo-modal');
      await expect(modal).toBeVisible();
      // El recorrido sale de la ficha, no de la fila: hasta que se pinta, el modal está a medias.
      await expect(modal.locator('.bo-timeline').or(modal.getByText('Sin movimientos registrados.'))).toBeVisible({ timeout: 20_000 });
      await page.waitForTimeout(600);

      const dictamen = seccion(modal, 'Dictamen');
      if (await dictamen.count()) {
        await senala(page, dictamen, 'Dictamen: quién comprobó su identidad y cuándo', 3400);
      } else {
        aviso('la ficha no trae dictamen de identidad (identityDecidedBy vacío)');
      }

      const recorrido = modal.locator('.bo-timeline');
      if (await recorrido.count()) {
        await senala(page, recorrido,
          'Liga → identidad → aprobación → depósito, con hora', 3600);
      } else {
        aviso('la colocación no tiene recorrido registrado');
      }
      await page.waitForTimeout(500);
      await modal.getByRole('button', { name: 'Cerrar' }).click();
      await expect(modal).toHaveCount(0);
    });

    await test.step('cartera: el préstamo vive dentro de la línea de la distribuidora', async () => {
      historia('cartera');
      await page.goto('/cartera');
      await expect(page.locator('.bo-page-title')).toContainText(/cartera de crédito/i);

      const cuenta = await buscarCuenta(page, CONTRATO || CUENTA);
      if (!cuenta) {
        aviso(`no encontré la cuenta ${CONTRATO || CUENTA} en cartera`);
        await page.waitForTimeout(3000);
        return;
      }
      await senala(page, cuenta, `Línea de ${titulo(DISTRIBUIDORA)}: un contrato para toda su red`, 3000);
      await cuenta.click();
      const modal = page.locator('.bo-modal');
      await expect(modal.getByText('Saldos'), 'el detalle de la cuenta no terminó de cargar').toBeVisible({ timeout: 20_000 });
      await page.waitForTimeout(600);

      const pestanaDisp = modal.getByRole('tab', { name: /disposiciones/i });
      if (await pestanaDisp.count()) {
        await enfoca(page, pestanaDisp, 800);
        await pestanaDisp.click();
        await page.waitForTimeout(800);
        const filas = modal.locator('.bo-table tbody tr:not(:has(.bo-table-empty))');
        const tercero = filas.filter({ hasText: 'Crédito a tercero' });
        const suya = tercero.filter({ hasText: /45,000/ }).first();
        const disp = (await suya.count()) ? suya : tercero.first();
        if (await disp.count()) {
          await senala(page, disp, `Crédito a ${BENEFICIARIA}, dentro de la línea`, 3400);
          const estatus = disp.locator('td').nth(3).locator('.bo-badge');
          const texto = (await estatus.innerText()).trim();
          await senala(page, estatus,
            texto === 'COMPLETED' ? 'Completada: SPEI enviado' : `Estatus: ${texto}`, 2800);
        } else {
          aviso('la línea no muestra ninguna disposición «Crédito a tercero»');
          await page.waitForTimeout(2000);
        }
      } else {
        aviso('la cuenta no tiene pestaña de disposiciones (no es una línea)');
      }

      const resumen = modal.getByRole('tab', { name: /resumen/i });
      await enfoca(page, resumen, 800);
      await resumen.click();
      await page.waitForTimeout(700);
      const capital = defRow(page, modal, 'Capital');
      if (await capital.count()) {
        await senala(page, capital, 'Capital: saldo vigente de la línea', 3000);
      }
      const disponible = defRow(page, modal, 'Disponible');
      if (await disponible.count()) {
        await senala(page, disponible, 'Disponible: se libera con cada pago', 3000);
      } else {
        aviso('la cuenta no publica «Disponible» (no es revolvente)');
      }
      await page.waitForTimeout(800);
      await modal.getByRole('button', { name: 'Cerrar' }).click();
    });

    await logout(page);
  });
});

function aviso(texto: string): void {
  console.log(`##AVISO## ${texto}`);
}

/** «LAURA MÉNDEZ SOTO» → «Laura Méndez Soto»: el nombre en la etiqueta, no en mayúsculas de padrón. */
function titulo(nombre: string): string {
  return nombre.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_, sep: string, l: string) => sep + l.toUpperCase());
}

function queDicePaso(paso: string): string {
  switch (paso) {
    case 'Depositada': return 'Depositada: el SPEI ya llegó a su cuenta';
    case 'Liquidada': return 'Liquidada: pagada por completo';
    case 'Depositando': return 'Depositando: el SPEI va en camino';
    default: return `Estado: ${paso}`;
  }
}

/**
 * La fila de **esta** colocación: la beneficiaria con la distribuidora del caso. El nombre de la
 * clienta cambia por corrida, pero la bandeja puede traer homónimas de corridas viejas; con la
 * distribuidora se descartan las de otras líneas.
 */
async function filaDeLaColocacion(page: Page): Promise<Locator | null> {
  const filas = page.locator('.bo-table tbody tr.clickable').filter({ hasText: BENEFICIARIA });
  const suya = filas.filter({ hasText: new RegExp(escapa(DISTRIBUIDORA), 'i') }).first();
  try {
    await expect(suya).toBeVisible({ timeout: 20_000 });
    return suya;
  } catch {
    return (await filas.count()) ? filas.first() : null;
  }
}

async function buscarCuenta(page: Page, ancla: string): Promise<Locator | null> {
  const filas = page.locator('.bo-table tbody tr.clickable');
  await expect(filas.first(), 'la cartera llegó vacía').toBeVisible({ timeout: 25_000 });
  const buscador = page.getByPlaceholder('Buscar cliente o contrato…');
  await enfoca(page, buscador, 700, async () => {
    await buscador.clear();
    await buscador.pressSequentially(ancla, { delay: 40 });
  });
  await page.waitForTimeout(1200);
  const fila = filas.filter({ hasText: ancla }).first();
  try {
    await expect(fila).toBeVisible({ timeout: 20_000 });
    return fila;
  } catch {
    return null;
  }
}

/** La sección de la ficha que encabeza `titulo`: el rótulo es lo único estable que la nombra. */
function seccion(ficha: Locator, titulo_: string): Locator {
  return ficha.locator('.bo-grupo-cap', { hasText: new RegExp(`^${escapa(titulo_)}$`) }).locator('xpath=..');
}

/** Un dato de `Defs` por su rótulo exacto: «Capital» no es «Capital pagado». */
function defRow(page: Page, dentro: Locator, rotulo: string): Locator {
  return dentro.locator('.bo-defs > div')
    .filter({ has: page.locator('.bo-def-k', { hasText: new RegExp(`^${escapa(rotulo)}$`) }) })
    .first();
}

function escapa(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
