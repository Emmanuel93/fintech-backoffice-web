import { test, expect, type Page, type Locator } from '@playwright/test';
import { login, logout } from './fixtures';

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
 */
const APP_ID = process.env.RE2E_APP_ID ?? '';
const FOLIO = process.env.RE2E_FOLIO ?? '';
const ACCION = (process.env.RE2E_ACCION ?? 'aprobar') as 'aprobar' | 'rechazar';
const MOTIVO = process.env.RE2E_MOTIVO ?? 'Capacidad de pago insuficiente para el monto solicitado.';
const PASSWORD = process.env.BO_STAFF_PASSWORD ?? 'Backoffice#2026';

/** Ancla estable: el modal titula con el folio y, si no hay, con el propio applicationId. */
const ancla = FOLIO || APP_ID;

test.describe('Regresión E2E · decisión del analista', () => {
  test.skip(!APP_ID, 'sin RE2E_APP_ID no hay solicitud que decidir');

  test('la solicitud llega a la bandeja de por-decidir y un underwriter la resuelve', async ({ page }) => {
    // ── El analista de crédito puede analizarla, pero no decidirla ─────────
    await login(page, 'analista@kredius.mx', PASSWORD);
    await abrirBandeja(page);
    const fichaAnalista = await abrirFicha(page, ancla);
    await expect(fichaAnalista).toContainText('Evaluación');
    await expect(fichaAnalista).toContainText('Buró de crédito');
    await expect(
      fichaAnalista.getByText('Tu rol puede analizar esta solicitud, pero no decidirla.'),
      'el gate de capacidad debe cerrar la decisión al analista',
    ).toBeVisible();
    await page.waitForTimeout(1200); // el video es entregable: sin pausa no se alcanza a leer
    await fichaAnalista.getByRole('button', { name: 'Cerrar' }).click();
    await logout(page);

    // ── El underwriter sí decide ───────────────────────────────────────────
    await login(page, 'underwriter@kredius.mx', PASSWORD);
    await abrirBandeja(page);
    const ficha = await abrirFicha(page, ancla);

    await test.step('la ficha trae con qué decidir', async () => {
      await expect(ficha).toContainText('Evaluación');
      await expect(ficha).toContainText('Capturado por el solicitante');
      await expect(ficha).toContainText('Decisión');
      await page.waitForTimeout(1500);
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
      await ficha.getByPlaceholder('Por qué se aprueba o se rechaza').fill(MOTIVO);
      await expect(ficha.getByRole('button', { name: 'Rechazar', exact: true })).toBeEnabled();
      await page.waitForTimeout(1000);
      await ficha.getByRole('button', { name: 'Rechazar', exact: true }).click();
    } else {
      await page.waitForTimeout(1000);
      await ficha.getByRole('button', { name: 'Aprobar', exact: true }).click();
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
  await page.goto('/solicitudes');
  await expect(page.locator('.bo-page-title')).toContainText(/solicitudes de crédito|por decidir/i);
  await page.getByRole('button', { name: /Por decidir/ }).click();
  await page.waitForTimeout(800);
}

/**
 * Abre la ficha de la solicitud del journey.
 *
 * La tabla no publica el `applicationId` en el DOM, así que se busca por folio en la fila y, como
 * red, se abre fila por fila comprobando el subtítulo del modal —que es el folio o, si no lo hay,
 * el propio id—. Abrir "la primera fila" y dar por hecho que es la nuestra es exactamente el
 * atajo que convierte un verde en una mentira cuando la cola tiene datos sembrados.
 */
async function abrirFicha(page: Page, ancla: string): Promise<Locator> {
  const modal = page.locator('.bo-modal');
  const filas = page.locator('.bo-table tbody tr.clickable');
  await expect(filas.first(), 'la cola de por-decidir llegó vacía').toBeVisible({ timeout: 25_000 });

  const directa = filas.filter({ hasText: ancla });
  if (await directa.count()) {
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
