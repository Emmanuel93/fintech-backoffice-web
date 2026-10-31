import { test, expect, type Page, type Locator } from '@playwright/test';
import { login, logout, iniciaHistoria, historia, enfoca, senala } from './fixtures';

/**
 * Cada peso de la colocación, asentado solo: el desembolso, el devengo diario y el pago, póliza
 * por póliza, hasta la balanza.
 *
 * Es la demo completa, no una regresión de flujo: lo que se enseña ya lo asentó accounting-service
 * con los hechos de los actos anteriores. Es de **sólo lectura** —nunca «Cerrar período» ni
 * «Timbrar pendientes»— y tolera lo opcional: si una póliza todavía no llega, se deja un
 * `##AVISO##` y el video sigue con la siguiente. Lo único que exige es que la contabilidad abra.
 *
 * Las pólizas se buscan por lo que dicen en pantalla —tipo y hecho económico—, no por folio: el
 * folio depende de cuántas pólizas asentó antes la misma sucursal.
 *
 * Momentos de la historia (`historia()`), en orden: resumen → polizas → egreso → devengo → pago →
 * balanza.
 */
const CONTRATO = process.env.RE2E_CONTRATO ?? '';
const DISTRIBUIDORA = process.env.RE2E_DISTRIBUIDORA ?? 'LAURA MÉNDEZ SOTO';
const PASSWORD = process.env.BO_STAFF_PASSWORD ?? 'Backoffice#2026';

// El video es entregable: 1280×800 es el hueco del navegador en el video compuesto, y a esa medida
// entra 1:1. Se fija aquí y no en `playwright.config.ts` porque las otras suites tienen las suyas.
test.use({ viewport: { width: 1280, height: 800 }, video: { mode: 'on', size: { width: 1280, height: 800 } } });

test.describe('Demo completa · cada peso, asentado solo', () => {
  test.skip(!CONTRATO, 'sin RE2E_CONTRATO no hay crédito cuyas pólizas enseñar');

  test('desembolso, devengo y pago tienen su póliza, y la balanza cuadra', async ({ page }) => {
    test.setTimeout(300_000);
    iniciaHistoria();
    await login(page, 'finanzas@kredius.mx', PASSWORD);

    await page.goto('/contabilidad');
    await expect(page.locator('.bo-page-title')).toContainText('Contabilidad');
    const cuadre = page.locator('.bo-kpi').filter({ hasText: 'Cuadre del período' });
    await expect(cuadre, 'el resumen contable no cargó').toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(800);

    await test.step('resumen: el periodo cuadra, y se reparte por sucursal', async () => {
      historia('resumen');
      const cuadra = (await cuadre.locator('.bo-kpi-value').innerText()).trim() === 'Cuadra';
      await senala(page, cuadre, cuadra
        ? 'El periodo cuadra: cargos = abonos'
        : 'No cuadra: hay una diferencia por revisar', 3400);
      const porSucursal = tarjeta(page, 'Movimiento por sucursal');
      if (await porSucursal.count()) {
        await senala(page, porSucursal.locator('.bo-card-head'), 'Por sucursal: pólizas, devengo y estimación', 3000);
      } else {
        aviso('el resumen no trae «Movimiento por sucursal»');
      }
    });

    const polizas = await test.step('polizas: el crédito de la distribuidora y sus pólizas', async () => {
      historia('polizas');
      await page.goto('/contabilidad/polizas');
      await expect(page.locator('.bo-page-title')).toContainText('Contabilidad');
      const campo = page.getByLabel('Cliente o contrato');
      await enfoca(page, campo, 700, () => campo.pressSequentially(CONTRATO, { delay: 35 }));
      await page.waitForTimeout(900);

      const clientes = page.locator('.bo-table tbody tr.clickable');
      const cliente = clientes.filter({ hasText: CONTRATO }).first();
      const fila = (await esperaVisible(cliente, 30_000)) ? cliente : clientes.first();
      if (!(await esperaVisible(fila, 5_000))) {
        aviso(`ningún cliente con movimiento coincide con ${CONTRATO}`);
        await page.waitForTimeout(3000);
        return null;
      }
      await senala(page, fila, `${titulo(DISTRIBUIDORA)}: todo lo que movió su línea`, 3000);
      await fila.click();
      await page.waitForTimeout(800);

      // Con un solo crédito el segundo nivel se abre solo; con varios hay que abrir el del contrato.
      const credito = page.locator('.bo-row-detalle .bo-table tbody tr.clickable').filter({ hasText: CONTRATO }).first();
      if ((await credito.count()) && !(((await credito.getAttribute('class')) ?? '').includes('bo-row-abierta'))) {
        await enfoca(page, credito, 800);
        await credito.click();
        await page.waitForTimeout(800);
      }

      const plegable = page.locator('.bo-collapsible-head').filter({ hasText: 'Pólizas del período' }).first();
      if (!(await esperaVisible(plegable, 20_000))) {
        aviso('el crédito no muestra «Pólizas del período»');
        await page.waitForTimeout(2000);
        return null;
      }
      const totales = page.locator('.bo-totales').first();
      if (await totales.count()) {
        await senala(page, totales, 'Totales por tipo de movimiento', 3000);
      }
      await senala(page, plegable, 'Pólizas: alta, desembolso, devengo diario y pago', 2800);
      if ((await plegable.getAttribute('aria-expanded')) !== 'true') await plegable.click();
      const filas = page.locator('.bo-collapsible-body .bo-table tbody tr.clickable');
      if (!(await esperaVisible(filas.first(), 20_000))) {
        aviso('el crédito no tiene pólizas en el período');
        return null;
      }
      await page.waitForTimeout(900);
      return filas;
    });

    await test.step('egreso: desembolso, cargo a cartera y abono a bancos', async () => {
      historia('egreso');
      if (!polizas) { await page.waitForTimeout(3000); return; }
      const egresos = polizas.filter({ hasText: 'Egreso' }).filter({ hasText: /Disposición|SPEI|tercero/i });
      const suya = egresos.filter({ hasText: /45,000/ }).first();
      const fila = (await suya.count()) ? suya : egresos.first();
      if (!(await fila.count())) {
        aviso('no hay póliza de egreso de la disposición en el período');
        await page.waitForTimeout(3000);
        return;
      }
      await senala(page, fila, 'Egreso: el crédito sale por SPEI', 2800);
      const modal = await abrirPoliza(page, fila);
      await senalaLinea(page, modal, '1201', 'Cargo · Cartera de crédito vigente');
      await senalaLinea(page, modal, '1101', 'Abono · Bancos / SPEI');
      await senalaCuadre(page, modal);
      await cerrar(page);
    });

    await test.step('devengo: intereses e IVA, cada día', async () => {
      historia('devengo');
      if (!polizas) { await page.waitForTimeout(3000); return; }
      const interes = polizas.filter({ hasText: 'Devengo de interés' }).first();
      if (await interes.count()) {
        await senala(page, interes, 'Diario: el interés se devenga sin captura manual', 3000);
        const modal = await abrirPoliza(page, interes);
        await senalaLinea(page, modal, '1203', 'Cargo · Intereses por cobrar');
        await senalaLinea(page, modal, '4101', 'Abono · Ingreso por intereses');
        const conIva = await linea(page, modal, '2110').count();
        if (conIva) await senalaLinea(page, modal, '2110', 'Abono · IVA trasladado (no es ingreso)');
        await cerrar(page);
        if (conIva) return;
      } else {
        aviso('no hay póliza de devengo de interés en el período');
      }
      // El IVA del interés va en su propia póliza: se enseña para que se vea que tampoco se captura.
      const iva = polizas.filter({ hasText: 'IVA trasladado' }).first();
      if (await iva.count()) {
        const modal = await abrirPoliza(page, iva);
        await senalaLinea(page, modal, '2110', 'Abono · IVA trasladado (no es ingreso)');
        await cerrar(page);
      } else {
        aviso('no hay póliza de IVA trasladado en el período');
      }
    });

    await test.step('pago: entra a bancos y salda la cartera', async () => {
      historia('pago');
      if (!polizas) { await page.waitForTimeout(3000); return; }
      const pago = polizas.filter({ hasText: 'Pago recibido' }).first();
      if (!(await pago.count())) {
        aviso('no hay póliza de pago recibido en el período (¿todavía no paga?)');
        await page.waitForTimeout(3000);
        return;
      }
      await senala(page, pago, 'Ingreso: el pago se aplica automáticamente', 2800);
      const modal = await abrirPoliza(page, pago);
      await senalaLinea(page, modal, '1101', 'Cargo · Bancos: entra el pago');
      await senalaLinea(page, modal, '1201', 'Abono · Cartera: baja el capital');
      await senalaLinea(page, modal, '1203', 'Abono · Intereses: se cobran');
      await senalaCuadre(page, modal);
      await cerrar(page);
    });

    await test.step('balanza: cuadra, y ahí están cartera y bancos', async () => {
      historia('balanza');
      await page.goto('/contabilidad/balanza');
      await expect(page.locator('.bo-page-title')).toContainText('Contabilidad');
      const insignia = page.locator('.bo-card .bo-badge').filter({ hasText: /^(Cuadra|No cuadra)$/ }).first();
      if (await esperaVisible(insignia, 30_000)) {
        const cuadra = (await insignia.innerText()).trim() === 'Cuadra';
        await senala(page, insignia.locator('xpath=..'), cuadra
          ? 'La balanza cuadra: cargos = abonos'
          : 'No cuadra: hay una diferencia por revisar', 3400);
      } else {
        aviso('la balanza no terminó de cargar');
      }
      const cuentas = tarjeta(page, 'Cuentas de balance y resultados').locator('.bo-table tbody tr');
      const cartera = cuentas.filter({ has: page.locator('b.bo-mono-sm', { hasText: /^1201$/ }) }).first();
      if (await esperaVisible(cartera, 15_000)) {
        await senala(page, cartera, '1201 · Cartera: saldo por cobrar', 3000);
      } else {
        aviso('la balanza no trae la cuenta 1201');
      }
      const bancos = cuentas.filter({ has: page.locator('b.bo-mono-sm', { hasText: /^1101$/ }) }).first();
      if (await bancos.count()) {
        await senala(page, bancos, '1101 · Bancos: entradas y salidas por SPEI', 3000);
      } else {
        aviso('la balanza no trae la cuenta 1101');
      }
      await page.waitForTimeout(800);
    });

    await logout(page);
  });
});

function aviso(texto: string): void {
  console.log(`##AVISO## ${texto}`);
}

function titulo(nombre: string): string {
  return nombre.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_, sep: string, l: string) => sep + l.toUpperCase());
}

async function esperaVisible(loc: Locator, timeout: number): Promise<boolean> {
  try {
    await expect(loc).toBeVisible({ timeout });
    return true;
  } catch {
    return false;
  }
}

/** Una tarjeta por su encabezado: es lo único estable que la nombra. */
function tarjeta(page: Page, titulo_: string): Locator {
  return page.locator('.bo-card').filter({ has: page.locator('.bo-card-head', { hasText: titulo_ }) }).first();
}

async function abrirPoliza(page: Page, fila: Locator): Promise<Locator> {
  await fila.click();
  const modal = page.locator('.bo-modal');
  await expect(modal).toBeVisible();
  // Los renglones llegan con la ficha: hasta que se pintan, el modal sólo trae el spinner.
  await expect(modal.locator('.bo-table tbody tr').first(), 'la póliza no terminó de cargar').toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(700);
  return modal;
}

/** El renglón de una cuenta dentro de la póliza, por su código exacto. */
function linea(page: Page, modal: Locator, cuenta: string): Locator {
  return modal.locator('.bo-table tbody tr')
    .filter({ has: page.locator('b.bo-mono-sm', { hasText: new RegExp(`^${cuenta}$`) }) })
    .first();
}

async function senalaLinea(page: Page, modal: Locator, cuenta: string, texto: string) {
  const l = linea(page, modal, cuenta);
  if (await l.count()) await senala(page, l, texto, 2800);
  else aviso(`la póliza no trae la cuenta ${cuenta}`);
}

/** Total de cargos, total de abonos y su cuadre: la fila que revisa primero quien audita. */
async function senalaCuadre(page: Page, modal: Locator) {
  const rotulo = modal.locator('.bo-sub', { hasText: /^Cuadre$/ });
  if (!(await rotulo.count())) return;
  const cuadra = (await rotulo.locator('xpath=following-sibling::*[1]').innerText()).trim() === 'Cuadra';
  await senala(page, rotulo.locator('xpath=../..'), cuadra
    ? 'Cuadra: cargos = abonos'
    : 'No cuadra: falta una contrapartida', 2800);
}

async function cerrar(page: Page) {
  const modal = page.locator('.bo-modal');
  await page.waitForTimeout(400);
  await modal.getByRole('button', { name: 'Cerrar' }).click();
  await expect(modal).toHaveCount(0);
  await page.waitForTimeout(500);
}
