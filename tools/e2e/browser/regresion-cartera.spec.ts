import { test, expect, type Page, type Locator } from '@playwright/test';
import { login, logout } from './fixtures';

/**
 * La cuenta del journey, vista en cartera.
 *
 * Se busca **esa** cuenta, no la primera fila de la tabla: con la base sembrada, verificar la
 * primera fila es verificar el seed, no el journey que se acaba de correr.
 */
const CUENTA = process.env.RE2E_CUENTA ?? '';
/**
 * El ancla es el **número de contrato**, no el `creditAccountId`: la consola no pinta el UUID en
 * ningún sitio —la columna es «Contrato» y el subtítulo del modal es `contractNumber`—, así que
 * buscar por id abriría cuarenta modales para acabar verificando la primera fila.
 */
const CONTRATO = process.env.RE2E_CONTRATO ?? '';
const ESPERADO = process.env.RE2E_ESPERADO ?? ''; // liquidado | activo | ''
const PASSWORD = process.env.BO_STAFF_PASSWORD ?? 'Backoffice#2026';

test.describe('Regresión E2E · la cuenta en cartera', () => {
  test.skip(!CONTRATO && !CUENTA, 'sin RE2E_CONTRATO/RE2E_CUENTA no hay cuenta que revisar');

  test('la cuenta aparece con su calendario, sus pagos y su avance', async ({ page }) => {
    await login(page, 'analista@kredius.mx', PASSWORD);
    await page.goto('/cartera');
    await expect(page.locator('.bo-page-title')).toContainText(/cartera de crédito/i);
    await page.waitForTimeout(1000);

    await test.step('los indicadores de arriba están calculados', async () => {
      await expect(page.getByText('Capital colocado')).toBeVisible();
      await expect(page.getByText('Cartera vencida (90+)')).toBeVisible();
      await page.waitForTimeout(800);
    });

    const modal = await abrirCuenta(page, CONTRATO || CUENTA);

    await test.step('resumen: saldos y avance del plan', async () => {
      await expect(modal).toContainText('Saldos');
      await expect(modal).toContainText('Seguimiento del plan');
      await expect(modal).toContainText('Mensualidades cubiertas');
      await page.waitForTimeout(1500);
    });

    // En una línea revolvente el plan de pagos **no cuelga de la cuenta**: cada disposición
    // lleva el suyo. La pestaña «Calendario» de la línea está vacía por diseño, así que exigirle
    // filas era pedirle a la línea el calendario de otra cosa. La presencia de la pestaña
    // «Disposiciones» es lo que distingue una línea de un préstamo a plazo.
    const disposiciones = modal.getByRole('tab', { name: /disposiciones/i });
    const esLinea = (await disposiciones.count()) > 0;

    await test.step('el plan de pagos tiene filas donde le toca', async () => {
      const pestana = esLinea ? disposiciones : modal.getByRole('tab', { name: /calendario/i });
      await pestana.click();
      await page.waitForTimeout(900);
      // `DataTable` pinta el vacío como un <tr> más: contarlo daría por lleno un calendario vacío.
      const filas = await modal.locator('.bo-table tbody tr:not(:has(.bo-table-empty))').count();
      expect(
        filas,
        esLinea ? 'la línea no muestra ninguna disposición' : 'el calendario llegó vacío',
      ).toBeGreaterThan(0);
    });

    await test.step('los pagos aplicados se ven', async () => {
      await modal.getByRole('tab', { name: /pagos/i }).click();
      await page.waitForTimeout(900);
      const texto = await modal.innerText();
      expect(texto).toMatch(/aplicados|Todavía no se registran pagos/i);
    });

    if (esLinea) {
      await test.step('y el calendario de la línea se deja ver, aunque viva en la disposición', async () => {
        await modal.getByRole('tab', { name: /calendario/i }).click();
        await page.waitForTimeout(900);
      });
    }

    if (ESPERADO === 'liquidado') {
      await test.step('la cuenta quedó saldada', async () => {
        await modal.getByRole('tab', { name: /resumen/i }).click();
        await page.waitForTimeout(700);
        const texto = await modal.innerText();
        expect(texto, 'liquidada, el adeudo no puede seguir arriba').toMatch(
          /liquidad|saldad|SETTLED|\$0\.00|\$0/i,
        );
      });
    }

    await page.waitForTimeout(1200);
    await modal.getByRole('button', { name: 'Cerrar' }).click();
    await logout(page);
  });
});

async function abrirCuenta(page: Page, ancla: string): Promise<Locator> {
  const modal = page.locator('.bo-modal');
  const filas = page.locator('.bo-table tbody tr.clickable');
  await expect(filas.first(), 'la cartera llegó vacía').toBeVisible({ timeout: 25_000 });

  // La búsqueda es por nombre o número de contrato: se usa el buscador de la propia consola en
  // vez de paginar a mano, que es además lo que haría una persona.
  const buscador = page.getByPlaceholder('Buscar cliente o contrato…');
  if (await buscador.count()) {
    await buscador.fill(ancla);
    await page.waitForTimeout(1200);
  }

  const fila = filas.filter({ hasText: ancla });
  await expect(fila.first(), `no encontré la cuenta ${ancla} en cartera`).toBeVisible({
    timeout: 20_000,
  });
  await fila.first().click();

  await expect(modal).toBeVisible();
  // El modal se pinta con un spinner mientras `useAsync` resuelve: leerlo antes es leer un modal
  // vacío y dar por bueno cualquier contenido.
  await expect(modal.getByText('Saldos'), 'el detalle no terminó de cargar').toBeVisible({
    timeout: 20_000,
  });
  return modal;
}
