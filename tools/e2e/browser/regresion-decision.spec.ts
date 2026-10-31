import { test, expect, type Page, type Locator } from '@playwright/test';
import { login, logout, iniciaHistoria, historia, enfoca } from './fixtures';

/**
 * La decisión del analista, desde la consola.
 *
 * No origina nada: la solicitud la creó una persona en la app, y el orquestador
 * (`fintech-services/tools/regresion-e2e`) pasa aquí su identificador. Este spec sólo hace lo que
 * le toca al backoffice — que la solicitud **se vea** en la bandeja de por-decidir, que la ficha
 * traiga con qué decidir, que el rol equivocado no pueda, y que al aprobar la fila se mueva.
 *
 * Separarlo así es lo que hace que un rojo signifique algo: con la solicitud ya sembrada por la
 * app y verificada por API, un fallo aquí sólo puede ser la consola.
 *
 * Momentos de la historia (`historia()`), en orden: bandeja → roles → ficha → aprueba.
 */
const APP_ID = process.env.RE2E_APP_ID ?? '';
const FOLIO = process.env.RE2E_FOLIO ?? '';
const ACCION = (process.env.RE2E_ACCION ?? 'aprobar') as 'aprobar' | 'rechazar';
const MOTIVO = process.env.RE2E_MOTIVO ?? 'Capacidad de pago insuficiente para el monto solicitado.';
const PASSWORD = process.env.BO_STAFF_PASSWORD ?? 'Backoffice#2026';

/** Ancla estable: el modal titula con el folio y, si no hay, con el propio applicationId. */
const ancla = FOLIO || APP_ID;

// El video es entregable. Sin tamaño explícito Playwright lo encoge a que quepa en 800×800 y la
// ficha salía a 800×450, ilegible. 1280×800 es el hueco del navegador en el video compuesto
// (`NAVEGADOR` en `tools/regresion-e2e/video.py`): a esa medida entra 1:1. Se fija aquí y no en
// `playwright.config.ts` porque las otras suites tienen sus propias medidas.
test.use({ viewport: { width: 1280, height: 800 }, video: { mode: 'on', size: { width: 1280, height: 800 } } });

test.describe('Regresión E2E · decisión del analista', () => {
  test.skip(!APP_ID, 'sin RE2E_APP_ID no hay solicitud que decidir');

  test('la solicitud llega a la bandeja de por-decidir y un underwriter la resuelve', async ({ page }) => {
    iniciaHistoria();
    // ── El analista de crédito puede analizarla, pero no decidirla ─────────
    await login(page, 'analista@kredius.mx', PASSWORD);
    await irABandeja(page);
    historia('bandeja');
    await filtrarPorDecidir(page, true);
    const fichaAnalista = await abrirFicha(page, ancla, true);

    // El mismo caso, visto por quien no puede firmarlo: es la mitad del modelo de roles que se ve.
    historia('roles');
    await expect(fichaAnalista).toContainText('Evaluación');
    await expect(fichaAnalista).toContainText('Buró de crédito');
    const sinDecision = fichaAnalista.getByText('Tu rol puede analizar esta solicitud, pero no decidirla.');
    await expect(sinDecision, 'el gate de capacidad debe cerrar la decisión al analista').toBeVisible();
    await page.waitForTimeout(800);
    await enfoca(page, sinDecision, 2400); // el video es entregable: sin pausa no se alcanza a leer
    await page.waitForTimeout(600);
    const cerrar = fichaAnalista.getByRole('button', { name: 'Cerrar' });
    await enfoca(page, cerrar, 700);
    await cerrar.click();
    await logout(page);

    // ── El underwriter sí decide ───────────────────────────────────────────
    await login(page, 'underwriter@kredius.mx', PASSWORD);
    await abrirBandeja(page);
    const ficha = await abrirFicha(page, ancla, true);
    historia('ficha');

    await test.step('la ficha trae con qué decidir', async () => {
      await expect(ficha).toContainText('Evaluación');
      await expect(ficha).toContainText('Capturado por el solicitante');
      await expect(ficha).toContainText('Decisión');
      await page.waitForTimeout(600);
      // Score y buró son con lo que se decide: se señalan antes de firmar, no después. Del bloque
      // de evaluación, sólo las cifras de arriba (score, riesgo): la tabla de reglas que sigue es
      // más alta que la pantalla, y centrar el bloque entero dejaba el score fuera de cuadro.
      const evaluacion = bloque(ficha, 'Evaluación');
      const score = evaluacion.locator('dl').first();
      await enfoca(page, (await score.count()) ? score : evaluacion, 2200);
      const buro = bloque(ficha, 'Buró de crédito');
      if (await buro.count()) await enfoca(page, buro, 2200);
      await page.waitForTimeout(600);
    });

    // `exact: true` no es cosmético: cada documento del expediente trae su propio «✕ Rechazar»
    // (Expediente.tsx:233) y el `name` de getByRole busca por **subcadena**, así que pedir
    // «Rechazar» dentro del modal resolvía a cinco botones —los cuatro del expediente más el de
    // la decisión— y Playwright abortaba por strict mode antes de comprobar nada.
    await test.step('rechazar sin motivo está cerrado', async () => {
      // No es un detalle de UI: un rechazo sin motivo es un rechazo que nadie puede explicarle
      // al cliente, y la CONDUSEF lo pregunta.
      await expect(ficha.getByRole('button', { name: 'Rechazar', exact: true })).toBeDisabled();
    });

    if (ACCION === 'rechazar') {
      // `rechaza` no está en el guion del video (que sólo cuenta la aprobación): el orquestador la
      // ignora, y eso es mejor que rotular «aprueba» sobre un rechazo.
      historia('rechaza');
      const motivo = ficha.getByPlaceholder('Por qué se aprueba o se rechaza');
      await enfoca(page, motivo, 800, () => motivo.pressSequentially(MOTIVO, { delay: 25 }));
      const rechazar = ficha.getByRole('button', { name: 'Rechazar', exact: true });
      await expect(rechazar).toBeEnabled();
      await enfoca(page, rechazar);
      await rechazar.click();
    } else {
      historia('aprueba');
      const aprobar = ficha.getByRole('button', { name: 'Aprobar', exact: true });
      await enfoca(page, aprobar, 1600);
      await aprobar.click();
    }

    await expect(page.locator('.bo-modal'), 'la decisión cierra la ficha').toHaveCount(0, {
      timeout: 20_000,
    });
    await page.waitForTimeout(1500);

    await test.step('la solicitud sale de la cola de por-decidir', async () => {
      await page.reload();
      await abrirBandeja(page);
      // Con la cola vacía la consola no pinta tabla, sino «Nada esperando decisión.»: afirmar
      // sobre `.bo-table` se quedaría sin elemento que resolver en vez de pasar.
      await expect(
        page.locator('.bo-table tbody tr.clickable').filter({ hasText: ancla }),
      ).toHaveCount(0);
      await page.waitForTimeout(1200);
    });

    await logout(page);
  });
});

/** Bandeja filtrada a lo que espera decisión humana. */
async function abrirBandeja(page: Page) {
  await irABandeja(page);
  await filtrarPorDecidir(page);
}

async function irABandeja(page: Page) {
  await page.goto('/solicitudes');
  await expect(page.locator('.bo-page-title')).toContainText(/solicitudes de crédito|por decidir/i);
}

/** `mostrar`: señalar el filtro antes de tocarlo, para que en el video se vea qué se eligió. */
async function filtrarPorDecidir(page: Page, mostrar = false) {
  const porDecidir = page.getByRole('button', { name: /Por decidir/ });
  if (mostrar) await enfoca(page, porDecidir);
  await porDecidir.click();
  await page.waitForTimeout(800);
}

/** El bloque de la ficha que titula `titulo` (sus `<h4>`): el título es lo único estable que lo nombra. */
function bloque(ficha: Locator, titulo: string): Locator {
  return ficha.getByRole('heading', { name: titulo, exact: true }).locator('xpath=..');
}

/**
 * Abre la ficha de la solicitud del journey.
 *
 * La tabla no publica el `applicationId` en el DOM, así que se busca por folio en la fila y, como
 * red, se abre fila por fila comprobando el subtítulo del modal —que es el folio o, si no lo hay,
 * el propio id—. Abrir "la primera fila" y dar por hecho que es la nuestra es exactamente el
 * atajo que convierte un verde en una mentira cuando la cola tiene datos sembrados.
 */
async function abrirFicha(page: Page, ancla: string, mostrar = false): Promise<Locator> {
  const modal = page.locator('.bo-modal');
  const filas = page.locator('.bo-table tbody tr.clickable');
  await expect(filas.first(), 'la cola de por-decidir llegó vacía').toBeVisible({ timeout: 25_000 });

  const directa = filas.filter({ hasText: ancla });
  if (await directa.count()) {
    if (mostrar) await enfoca(page, directa.first());
    await directa.first().click();
    await expect(modal).toBeVisible();
    return modal;
  }

  const total = Math.min(await filas.count(), 25);
  for (let i = 0; i < total; i++) {
    await filas.nth(i).click();
    await expect(modal).toBeVisible();
    if ((await modal.innerText()).includes(ancla)) return modal;
    await modal.getByRole('button', { name: 'Cerrar' }).click();
    await expect(modal).toHaveCount(0);
  }
  throw new Error(`no encontré la solicitud ${ancla} en la cola de por-decidir`);
}
