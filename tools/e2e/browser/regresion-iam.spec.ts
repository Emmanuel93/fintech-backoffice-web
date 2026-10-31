import { test, expect, type Page, type Locator } from '@playwright/test';
import { login, logout, iniciaHistoria, historia, enfoca, senala } from './fixtures';

/**
 * Quién puede qué, y quién lo hizo: las personas del caso con su rol, lo que cada rol firma, la
 * matriz completa y la huella de cada decisión en la bitácora.
 *
 * Es la demo completa y entra como ADMIN, que **puede** cambiarlo todo; por eso es estrictamente
 * de sólo lectura: nunca «Guardar», «Suspender», «Dar de baja» ni «Invitar usuario», y la ficha
 * del rol se cierra sin tocar una casilla. Tolera lo opcional con un `##AVISO##`.
 *
 * La bitácora indexa por identificador: el contrato trae los hechos de la cuenta, pero la decisión
 * de crédito cuelga de la solicitud y el dictamen de la beneficiaria, de su colocación. Esos dos
 * identificadores llegan del orquestador (`RE2E_SOLICITUD`, `RE2E_PLACEMENT_ID`) y, si no, se
 * resuelven con la misma sesión contra el BFF —la solicitud por su folio, que comparte sufijo con
 * el contrato; la colocación por el nombre de la beneficiaria—, sin que se vea en el video.
 *
 * Momentos de la historia (`historia()`), en orden: usuarios → roles → permisos → auditoria.
 */
const CONTRATO = process.env.RE2E_CONTRATO ?? '';
const BENEFICIARIA = process.env.RE2E_BENEFICIARIA ?? '';
const DISTRIBUIDORA = process.env.RE2E_DISTRIBUIDORA ?? 'LAURA MÉNDEZ SOTO';
const SOLICITUD = process.env.RE2E_SOLICITUD ?? '';
const PLACEMENT_ID = process.env.RE2E_PLACEMENT_ID ?? '';
const PASSWORD = process.env.BO_ADMIN_PASSWORD ?? process.env.BO_STAFF_PASSWORD ?? 'Backoffice#2026';

// El video es entregable: 1280×800 es el hueco del navegador en el video compuesto, y a esa medida
// entra 1:1. Se fija aquí y no en `playwright.config.ts` porque las otras suites tienen las suyas.
test.use({ viewport: { width: 1280, height: 800 }, video: { mode: 'on', size: { width: 1280, height: 800 } } });

test.describe('Demo completa · quién puede qué, y quién lo hizo', () => {
  test.skip(!CONTRATO, 'sin RE2E_CONTRATO no hay caso cuya huella buscar en la bitácora');

  test('las personas del caso, lo que firma cada rol, la matriz y la bitácora', async ({ page }) => {
    test.setTimeout(300_000);
    iniciaHistoria();
    const bff = escuchaBff(page);
    await login(page, 'admin@kredius.mx', PASSWORD);

    await page.goto('/usuarios');
    await expect(page.locator('.bo-page-title')).toContainText('Usuarios');
    const filas = page.locator('.bo-table tbody tr.clickable');
    await expect(filas.first(), 'el directorio de personal no cargó').toBeVisible({ timeout: 25_000 });
    await page.waitForTimeout(800);

    await test.step('usuarios: cada persona con su rol', async () => {
      historia('usuarios');
      const buscar = page.getByLabel('Buscar usuario por nombre o correo');
      await escribe(page, buscar, 'Olivia');
      const olivia = filas.filter({ hasText: 'Olivia Paz' }).first();
      if (await esperaVisible(olivia, 10_000)) {
        await senala(page, olivia, 'Olivia Paz · Cumplimiento y KYC', 3200);
        await senala(page, olivia.locator('td').nth(1), 'Su rol: dictamina identidades y asigna cartera', 2600);
      } else {
        aviso('Olivia Paz no está en el directorio');
      }
      await escribe(page, buscar, 'Ulises');
      const ulises = filas.filter({ hasText: 'Ulises Ward' }).first();
      if (await esperaVisible(ulises, 10_000)) {
        await senala(page, ulises, 'Ulises Ward · Mesa de crédito', 3200);
      } else {
        aviso('Ulises Ward no está en el directorio');
      }
      await buscar.clear();
      await page.waitForTimeout(600);
    });

    await test.step('roles: lo que cada rol puede firmar', async () => {
      historia('roles');
      await page.goto('/roles');
      await expect(page.locator('.bo-page-title')).toContainText('Roles');
      const rol = page.locator('.bo-table tbody tr.clickable')
        .filter({ has: page.locator('.bo-tree-code', { hasText: /^OPS_SUPERVISOR$/ }) }).first();
      if (!(await esperaVisible(rol, 20_000))) {
        aviso('no encontré el rol OPS_SUPERVISOR');
        await page.waitForTimeout(3000);
        return;
      }
      await senala(page, rol, 'Rol de Olivia: supervisión de operación', 2800);
      await senala(page, rol.locator('td').nth(3), 'Qué firma: la identidad de cada persona', 3000);
      await rol.click();
      const modal = page.locator('.bo-modal');
      await expect(modal).toBeVisible();
      await page.waitForTimeout(700);

      const grupo = modal.locator('.bo-grupo-cap', { hasText: /^Cumplimiento$/ }).locator('xpath=..');
      if (await grupo.count()) {
        await senala(page, grupo, 'Cumplimiento: consultar, dictaminar identidad, resolver listas', 3200);
      }
      const dictamen = capacidad(modal, 'compliance.review-identity');
      if (await dictamen.count()) await senala(page, dictamen, 'Dictaminar identidad: el permiso que usó Olivia', 2800);
      else aviso('el rol no lista compliance.review-identity');
      const beneficiarias = capacidad(modal, 'beneficiaries.review-identity');
      if (await beneficiarias.count()) await senala(page, beneficiarias, 'También la identidad de cada cliente final', 2800);
      // Se cierra con la cruz: «Guardar» está ahí para ADMIN y no se toca.
      await modal.getByRole('button', { name: 'Cerrar' }).click();
      await expect(modal).toHaveCount(0);
    });

    await test.step('permisos: la matriz completa, quién firma qué', async () => {
      historia('permisos');
      await page.goto('/permisos');
      await expect(page.locator('.bo-page-title')).toContainText('Permisos');
      const matriz = page.locator('table.bo-matrix');
      await expect(matriz, 'la matriz de permisos no cargó').toBeVisible({ timeout: 20_000 });
      await page.waitForTimeout(800);
      const fila = (codigo: string) => matriz.locator('tbody tr')
        .filter({ has: page.locator('.bo-tree-code', { hasText: new RegExp(`^${escapa(codigo)}$`) }) }).first();
      const identidad = fila('compliance.review-identity');
      if (await identidad.count()) await senala(page, identidad, 'Dictaminar identidad: solo roles con ✓', 3400);
      else aviso('la matriz no trae compliance.review-identity');
      const decide = fila('applications.decide');
      if (await decide.count()) await senala(page, decide, 'Decidir crédito: la mesa de Ulises', 3400);
      else aviso('la matriz no trae applications.decide');
    });

    await test.step('auditoria: la huella de cada decisión del caso', async () => {
      historia('auditoria');
      await page.goto('/auditoria');
      await expect(page.locator('.bo-page-title')).toContainText('Auditoría');
      const campo = page.getByLabel('Teléfono, correo, CURP, contrato o identificador');
      const hechos = page.locator('.bo-table tbody tr.clickable');

      await buscaEnBitacora(page, campo, CONTRATO);
      const delContrato = hechos.filter({ hasText: /Cuenta de crédito activada|se activó|Contrato firmado|Solicitud aprobada/ });
      if (await esperaVisible(hechos.first(), 20_000)) {
        const primero = (await delContrato.count()) ? delContrato.first() : hechos.first();
        await senala(page, primero, 'Bitácora del contrato: qué, quién y cuándo', 3200);
      } else {
        aviso(`la bitácora no devolvió nada para ${CONTRATO}`);
      }

      const solicitud = SOLICITUD || await solicitudDe(page, bff());
      if (solicitud) {
        await buscaEnBitacora(page, campo, solicitud);
        const aprobada = hechos.filter({ hasText: 'Solicitud aprobada' }).first();
        const decision = hechos.filter({ hasText: 'resolvió la solicitud' }).first();
        const firmado = hechos.filter({ hasText: 'Contrato firmado' }).first();
        if (await esperaVisible(decision.or(aprobada).first(), 15_000)) {
          if (await decision.count()) await senala(page, decision, 'Decisión de Ulises, firmada', 3000);
          if (await aprobada.count()) await senala(page, aprobada, 'Solicitud aprobada', 2600);
          if (await firmado.count()) await senala(page, firmado, `Contrato firmado por ${titulo(DISTRIBUIDORA)}`, 2600);
        } else {
          aviso('la bitácora no trae la decisión de la solicitud');
        }
      } else {
        aviso('no pude resolver la solicitud del contrato (RE2E_SOLICITUD vacío)');
      }

      const colocacion = PLACEMENT_ID || await colocacionDe(page, bff());
      const dictamen = hechos.filter({ hasText: /Olivia Paz/ }).filter({ hasText: /dictamen de identidad/ }).first();
      if (colocacion) {
        await buscaEnBitacora(page, campo, colocacion);
        if (await esperaVisible(dictamen, 15_000)) {
          await senala(page, dictamen, 'Dictamen de identidad, firmado por Olivia', 3400);
          const aprobo = hechos.filter({ hasText: /aprobó la colocación/ }).first();
          if (await aprobo.count()) await senala(page, aprobo, `${titulo(DISTRIBUIDORA)} asumió el riesgo y aprobó`, 2800);
        } else {
          aviso('la bitácora no trae el dictamen de identidad de la colocación');
        }
      } else {
        // Sin la colocación, se acota a lo que hizo el personal interno y se busca a Olivia ahí.
        await buscaEnBitacora(page, campo, CONTRATO);
        const quien = page.getByLabel('Quién actuó');
        await enfoca(page, quien, 700, () => quien.selectOption({ label: 'Personal interno' }));
        await page.waitForTimeout(900);
        if (await dictamen.count()) await senala(page, dictamen, 'Dictamen de identidad, firmado por Olivia', 3400);
        else aviso('no pude ubicar la colocación (RE2E_PLACEMENT_ID vacío) ni el dictamen de Olivia');
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

function escapa(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function esperaVisible(loc: Locator, timeout: number): Promise<boolean> {
  try {
    await expect(loc).toBeVisible({ timeout });
    return true;
  } catch {
    return false;
  }
}

/** Escribe sobre lo que hubiera, tecleado: en el video, un texto que aparece de golpe no se lee. */
async function escribe(page: Page, campo: Locator, texto: string) {
  await enfoca(page, campo, 600, async () => {
    await campo.clear();
    await campo.pressSequentially(texto, { delay: 60 });
  });
  await page.waitForTimeout(900);
}

async function buscaEnBitacora(page: Page, campo: Locator, texto: string) {
  await escribe(page, campo, texto);
  const buscar = page.getByRole('button', { name: 'Buscar', exact: true });
  await enfoca(page, buscar, 500);
  await buscar.click();
  // La consulta reemplaza la tabla: se espera a que el spinner se vaya antes de leer filas.
  await page.waitForTimeout(600);
  await expect(page.locator('.bo-spinner')).toHaveCount(0, { timeout: 20_000 }).catch(() => undefined);
  await page.waitForTimeout(600);
}

/** Una casilla de la ficha del rol por su código. Se señala, nunca se pulsa: pulsarla la cambia. */
function capacidad(modal: Locator, codigo: string): Locator {
  return modal.locator('label.bo-cap-row').filter({ hasText: new RegExp(`\\b${escapa(codigo)}\\b`) }).first();
}

/**
 * La base del BFF tal como la usa la consola, tomada de su primera llamada a `/permissions/me`. Así
 * la prueba no repite una URL que cambia por entorno.
 */
function escuchaBff(page: Page): () => string | null {
  let base: string | null = null;
  page.on('request', (r) => {
    if (base) return;
    const u = new URL(r.url());
    if (u.pathname.endsWith('/permissions/me')) {
      base = `${u.origin}${u.pathname.slice(0, -'/permissions/me'.length)}`;
    }
  });
  return () => base;
}

/** Una consulta al BFF con el token de la sesión abierta. No se ve en el video ni escribe nada. */
async function consultaBff<T>(page: Page, base: string | null, ruta: string): Promise<T | null> {
  if (!base) return null;
  const token = await page.evaluate(() => localStorage.getItem('bo.accessToken'));
  if (!token) return null;
  try {
    const r = await page.request.get(`${base}${ruta}`, { headers: { Authorization: `Bearer ${token}` } });
    return r.ok() ? (await r.json()) as T : null;
  } catch {
    return null;
  }
}

/** La solicitud del contrato: su folio es el mismo con `SOL-` en vez de `CTR-`. */
async function solicitudDe(page: Page, base: string | null): Promise<string | null> {
  const folio = CONTRATO.replace(/^CTR-/, 'SOL-');
  const filas = await consultaBff<Array<{ applicationId: string; folio?: string | null }>>(
    page, base, '/origination/applications');
  return filas?.find((a) => a.folio === folio)?.applicationId ?? null;
}

/** La colocación más reciente de la beneficiaria con la distribuidora del caso. */
async function colocacionDe(page: Page, base: string | null): Promise<string | null> {
  if (!BENEFICIARIA) return null;
  const pagina = await consultaBff<{ content?: Array<{
    placementId: string; beneficiaryName: string | null; distributorName?: string | null; createdAt?: string | null;
  }> }>(page, base, '/beneficiaries/placements?size=100');
  const suyas = (pagina?.content ?? [])
    .filter((p) => (p.beneficiaryName ?? '').toLowerCase() === BENEFICIARIA.toLowerCase())
    .filter((p) => !p.distributorName || p.distributorName.toLowerCase() === DISTRIBUIDORA.toLowerCase())
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
  return suyas[0]?.placementId ?? null;
}
