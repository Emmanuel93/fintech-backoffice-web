import { test, expect, type Page, type Locator } from '@playwright/test';
import { login, logout, iniciaHistoria, historia, enfoca, senala } from './fixtures';

/**
 * La distribuidora entra a su región: se le asigna ejecutivo y su cartera empieza a sumar en la
 * sucursal.
 *
 * Es el único acto de la demo completa que **escribe**: «Asignar» en la ficha del cliente. Todo lo
 * demás se lee. Por eso se exige `RE2E_DISTRIBUIDORA` explícita —sin ella no corre— en vez de
 * tomar un nombre por defecto: reasignar la cartera de alguien no debe pasar por una variable
 * olvidada. Asignar al mismo ejecutivo dos veces no cambia nada, así que repetir la corrida es
 * inocuo.
 *
 * El árbol suma por la cartera *de cada ejecutivo*, y el agregado puede tardar en reflejar la
 * reasignación; los clientes que cuelgan del ejecutivo, en cambio, se piden en vivo. Por eso el
 * cierre se busca en el renglón del cliente, y se recarga un par de veces antes de rendirse.
 *
 * Momentos de la historia (`historia()`), en orden: arbol → acomoda → sucursal.
 */
const DISTRIBUIDORA = process.env.RE2E_DISTRIBUIDORA ?? '';
const EJECUTIVO = process.env.RE2E_EJECUTIVO ?? 'Diego Lozano Fuentes';
const PASSWORD = process.env.BO_STAFF_PASSWORD ?? 'Backoffice#2026';

/** La ruta del árbol hasta la sucursal de la distribuidora, con lo que se dice de cada escalón. */
const RUTA: Array<[string, string]> = [
  ['Región Norte', 'Región: suma la cartera de sus zonas'],
  ['Zona Noroeste', 'Zona: agrupa sus sucursales'],
  ['Sucursal Culiacán', `Sucursal: donde opera ${titulo(DISTRIBUIDORA)}`],
];

// El video es entregable: 1280×800 es el hueco del navegador en el video compuesto, y a esa medida
// entra 1:1. Se fija aquí y no en `playwright.config.ts` porque las otras suites tienen las suyas.
test.use({ viewport: { width: 1280, height: 800 }, video: { mode: 'on', size: { width: 1280, height: 800 } } });

test.describe('Demo completa · la distribuidora entra a su región', () => {
  test.skip(!DISTRIBUIDORA, 'sin RE2E_DISTRIBUIDORA no se reasigna a nadie: este acto escribe');

  test('se le asigna ejecutivo en Culiacán y su cartera suma a la sucursal', async ({ page }) => {
    test.setTimeout(240_000);
    iniciaHistoria();
    await login(page, 'ops@kredius.mx', PASSWORD);

    await abrirEstructura(page);

    await test.step('arbol: Región Norte › Zona Noroeste › Sucursal Culiacán', async () => {
      historia('arbol');
      await abrirRaiz(page);
      for (const [nombre, texto] of RUTA) {
        await abrirRama(page, nombre, texto, 2400);
      }
      await page.waitForTimeout(800);
    });

    await test.step('acomoda: se le asigna su ejecutivo en Culiacán', async () => {
      historia('acomoda');
      await page.goto('/clientes');
      await expect(page.locator('.bo-page-title')).toContainText('Clientes');

      // Se busca por el nombre de pila: el directorio busca por un solo término, y «Laura Méndez»
      // completo no encuentra a nadie aunque exista.
      const buscador = page.getByLabel('Buscar en el directorio');
      const pila = DISTRIBUIDORA.split(/\s+/)[0];
      await enfoca(page, buscador, 700, () => buscador.pressSequentially(pila, { delay: 60 }));
      await page.waitForTimeout(1500);

      const fila = await filaDeLaDistribuidora(page);
      if (!fila) {
        aviso(`no encontré a ${DISTRIBUIDORA} en el directorio de clientes`);
        await page.waitForTimeout(3000);
        return;
      }
      const sinEjecutivo = (await fila.innerText()).includes('Sin asignar');
      await senala(page, fila, sinEjecutivo
        ? `${titulo(DISTRIBUIDORA)}: sin ejecutivo asignado`
        : `${titulo(DISTRIBUIDORA)}, en Culiacán`, 3000);
      await fila.click();

      const modal = page.locator('.bo-modal');
      await expect(modal).toBeVisible();
      const caja = modal.locator('section.bo-card').filter({ hasText: 'Reasignar cartera a ejecutivo' });
      try {
        await expect(caja).toBeVisible({ timeout: 20_000 });
      } catch {
        aviso('la ficha del cliente no ofrece «Reasignar cartera a ejecutivo» a este rol');
        await page.waitForTimeout(2000);
        return;
      }
      const selector = caja.locator('select');
      // El catálogo de ejecutivos llega aparte de la ficha: hasta que llega, sólo está «Selecciona…».
      const opcion = selector.locator('option').filter({ hasText: EJECUTIVO }).first();
      await expect(opcion, `${EJECUTIVO} no está en el catálogo de ejecutivos`).toBeAttached({ timeout: 20_000 });
      // Puede haber dos con el mismo nombre (dos usuarios del mismo ejecutivo): se toma el primero,
      // que es el titular de la unidad de Culiacán en el árbol.
      const valor = await opcion.getAttribute('value');

      await senala(page, selector, `Se asigna a ${EJECUTIVO}, de Culiacán`, 2600);
      await selector.selectOption(valor ?? { label: EJECUTIVO });
      await page.waitForTimeout(900);

      const asignar = caja.getByRole('button', { name: 'Asignar', exact: true });
      await senala(page, asignar, 'Al asignar, su cartera pasa a la sucursal', 2600);
      await asignar.click();

      // La confirmación es la propia ficha: se recarga y el ejecutivo deja de decir «Sin asignar».
      const ejecutivo = defRow(page, modal, 'Ejecutivo');
      try {
        await expect(ejecutivo).toContainText(EJECUTIVO, { timeout: 20_000 });
        await senala(page, ejecutivo, `Listo: ${EJECUTIVO} atiende la cuenta`, 3000);
      } catch {
        const error = (await caja.locator('span').last().innerText().catch(() => '')).trim();
        aviso(`la asignación no se confirmó en la ficha${error ? `: ${error}` : ''}`);
        await page.waitForTimeout(2000);
      }
      await modal.getByRole('button', { name: 'Cerrar' }).click();
      await expect(modal).toHaveCount(0);
    });

    await test.step('sucursal: su cartera ya suma a la sucursal', async () => {
      historia('sucursal');
      // El cliente del ejecutivo se pide en vivo al abrirlo, pero el árbol que lo contiene puede
      // venir de un agregado que tarda: se recarga un par de veces antes de dar el cierre por perdido.
      for (let intento = 0; intento < 3; intento++) {
        if (intento > 0) await page.waitForTimeout(2500);
        await abrirEstructura(page);
        await abrirRaiz(page);
        for (const [nombre] of RUTA) {
          await abrirRama(page, nombre, null, 0);
        }

        // Según cuántos escalones tenga la red, el ejecutivo se pinta como unidad (con su gente
        // debajo) o directamente como persona. Si es unidad, se abre primero.
        const unidad = filaDeUnidad(page, EJECUTIVO);
        if (await unidad.count()) {
          if (intento === 0) await senala(page, unidad, `${EJECUTIVO}: su cartera en Culiacán`, 2800);
          if (!(await esAbierta(unidad))) await unidad.click();
          await page.waitForTimeout(600);
        }

        const cliente = page.locator('.bo-arbol-cartera tbody tr:not(.bo-fila-arbol)')
          .filter({ hasText: new RegExp(escapa(DISTRIBUIDORA), 'i') }).first();
        const personas = filasDelEjecutivo(page);
        const total = await personas.count();
        for (let i = 0; i < total; i++) {
          const persona = personas.nth(i);
          if (!(await esAbierta(persona))) await persona.click();
          try {
            await expect(cliente).toBeVisible({ timeout: 8_000 });
          } catch {
            continue;
          }
          await senala(page, cliente, `${titulo(DISTRIBUIDORA)} ya suma a la Sucursal Culiacán`, 3400);
          await page.waitForTimeout(800);
          return;
        }
      }
      aviso(`${DISTRIBUIDORA} no apareció bajo ${EJECUTIVO} en el árbol tras recargar`);
      await page.waitForTimeout(2000);
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

function escapa(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function abrirEstructura(page: Page) {
  await page.goto('/estructura');
  await expect(page.locator('.bo-page-title')).toContainText('Estructura comercial');
  await expect(page.locator('.bo-arbol-cartera'), 'el árbol de la red no cargó').toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(600);
}

async function esAbierta(fila: Locator): Promise<boolean> {
  return ((await fila.getAttribute('class')) ?? '').includes('bo-fila-abierta');
}

/** La raíz llega cerrada; sin abrirla no hay regiones que mostrar. */
async function abrirRaiz(page: Page) {
  const raiz = page.locator('.bo-arbol-cartera tr.bo-fila-arbol').first();
  if (!(await esAbierta(raiz))) {
    await raiz.click();
    await page.waitForTimeout(500);
  }
}

/** Una unidad del árbol por su nombre exacto («Región Norte» no es «Región Noreste»). */
function filaDeUnidad(page: Page, nombre: string): Locator {
  return page.locator('.bo-arbol-cartera tr.bo-fila-arbol.abrible')
    .filter({ has: page.locator('.bo-arbol-nombre > b', { hasText: new RegExp(`^${escapa(nombre)}$`) }) })
    .first();
}

async function abrirRama(page: Page, nombre: string, texto: string | null, ms: number) {
  const fila = filaDeUnidad(page, nombre);
  await expect(fila, `no encontré «${nombre}» en el árbol`).toBeVisible({ timeout: 15_000 });
  if (texto) await senala(page, fila, texto, ms);
  if (!(await esAbierta(fila))) await fila.click();
  await page.waitForTimeout(texto ? 600 : 300);
}

/**
 * Los renglones de la persona: sin negritas, porque la negrita es de las unidades. Se ancla al
 * principio del nombre para no confundirla con una unidad cuyo responsable se llame igual. Puede
 * haber más de uno —dos usuarios del mismo ejecutivo— y la cartera cuelga de cualquiera.
 */
function filasDelEjecutivo(page: Page): Locator {
  return page.locator('.bo-arbol-cartera tr.bo-fila-arbol.abrible')
    .filter({ has: page.locator('.bo-arbol-nombre', { hasText: new RegExp(`^${escapa(EJECUTIVO)}`) }) })
    .filter({ hasNot: page.locator('.bo-arbol-nombre > b') });
}

/**
 * La fila de la distribuidora en el directorio. Si hay más de una con el mismo nombre (corridas
 * viejas), la que todavía no tiene ejecutivo es la de esta corrida.
 */
async function filaDeLaDistribuidora(page: Page): Promise<Locator | null> {
  const filas = page.locator('.bo-table tbody tr.clickable').filter({ hasText: new RegExp(escapa(DISTRIBUIDORA), 'i') });
  try {
    await expect(filas.first()).toBeVisible({ timeout: 20_000 });
  } catch {
    return null;
  }
  const sinAsignar = filas.filter({ hasText: 'Sin asignar' });
  return (await sinAsignar.count()) ? sinAsignar.first() : filas.first();
}

function defRow(page: Page, dentro: Locator, rotulo: string): Locator {
  return dentro.locator('.bo-defs > div')
    .filter({ has: page.locator('.bo-def-k', { hasText: new RegExp(`^${escapa(rotulo)}$`) }) })
    .first();
}
