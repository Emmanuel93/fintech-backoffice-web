import { test, expect, type Page } from '@playwright/test';
import { login } from './fixtures';

/**
 * The month-end close's reconciliation, on the trial balance screen. A closed month shows the reconciliation its
 * close ran — every blocking check in order —; the open month shows a dry run that books nothing. Read-only: it never
 * presses «Cerrar período».
 *
 * Besides working, it measures: the reconciliation runs over every account of the ledger, and must answer within a
 * few seconds, as a finance operator expects when opening the screen.
 */
const API = process.env.BO_API_URL ?? 'http://backoffice.localhost:8090';
const PASSWORD = process.env.BO_STAFF_PASSWORD ?? 'Backoffice#2026';
const RECONCILIATION_BUDGET_MS = 5_000;

interface Period { period: string; status: 'OPEN' | 'CLOSED' }
interface Check { code: string; ok: boolean; blocking: boolean; pending?: boolean }
interface Reconciliation { outcome: string; closedAt: string | null; preview: boolean; checks: Check[] }

async function api<T>(page: Page, path: string): Promise<{ body: T; ms: number }> {
  const t = await page.evaluate(() => localStorage.getItem('bo.accessToken'));
  expect(t, 'no hay sesión').toBeTruthy();
  const started = Date.now();
  const res = await page.request.get(`${API}${path}`, { headers: { Authorization: `Bearer ${t}` } });
  expect(res.ok(), `${path} respondió ${res.status()}`).toBeTruthy();
  return { body: (await res.json()) as T, ms: Date.now() - started };
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre',
  'noviembre', 'diciembre'];

test.describe('Cierre contable conciliado', () => {
  test('un mes cerrado muestra su conciliación y el mes abierto una corrida en seco', async ({ page }) => {
    test.setTimeout(120_000);
    await login(page, 'finanzas@kredius.mx', PASSWORD);

    const { body: periods } = await api<Period[]>(page, '/accounting/periods');
    const closed = periods.filter((p) => p.status === 'CLOSED').map((p) => p.period).sort().pop();
    const open = periods.find((p) => p.status === 'OPEN')?.period;
    expect(closed, 'no hay ningún mes cerrado: ¿corrió el cierre de mes?').toBeTruthy();

    await test.step('el mes cerrado concilió: todas las comprobaciones que bloquean, en orden', async () => {
      const { body, ms } = await api<Reconciliation>(page, `/accounting/periods/${closed}/reconciliation`);
      expect(body.outcome).toBe('RECONCILED');
      expect(body.closedAt).toBeTruthy();
      expect(body.checks.filter((c) => c.blocking && !c.ok).map((c) => c.code)).toEqual([]);
      expect(body.checks.map((c) => c.code)).toEqual(expect.arrayContaining(
        ['BALANZA_CUADRA', 'ECUACION_CONTABLE', 'CARTERA_CERRADA', 'RESERVA_MEDIDA', 'CAPITAL_1201', 'POR_COBRAR_1203',
          'RESERVA_1290', 'DIFERIDAS_2150', 'BANCOS_1101']));
      // Banks against treasury's cash book blocks the close now: a closed month has it reconciled.
      expect(body.checks.find((c) => c.code === 'BANCOS_1101')).toMatchObject({ ok: true, blocking: true });
      expect(ms, `la conciliación de ${closed} tardó ${ms} ms`).toBeLessThan(RECONCILIATION_BUDGET_MS);
    });

    await test.step('en pantalla: la balanza del mes cerrado trae su conciliación', async () => {
      await page.goto('/contabilidad/balanza');
      await expect(page.locator('.bo-page-title')).toContainText('Contabilidad');
      const mes = MESES[Number(closed!.slice(4)) - 1];
      await page.getByLabel('Período contable').selectOption(closed!);
      const card = page.locator('.bo-card').filter({ hasText: 'Conciliación del cierre de' });
      const started = Date.now();
      await expect(card, 'no apareció la conciliación del cierre').toBeVisible({ timeout: 20_000 });
      await expect(card.locator('.bo-card-head')).toContainText(new RegExp(mes, 'i'));
      await expect(card.getByText('Concilia', { exact: true })).toBeVisible({ timeout: 20_000 });
      await expect(card.getByText('Capital: cartera contra el mayor 1201')).toBeVisible();
      await expect(card.getByText('Bancos 1101 contra el libro de caja de tesorería')).toBeVisible();
      // The trial balance itself: debit balances equal credit balances.
      await expect(page.getByText('Sumas iguales: cuadra')).toBeVisible({ timeout: 20_000 });
      await expect(card.getByText('Para tu información')).toBeVisible();
      expect(Date.now() - started, 'la tarjeta tardó en conciliar').toBeLessThan(RECONCILIATION_BUDGET_MS * 2);
    });

    if (open) {
      await test.step('el mes abierto: una corrida en seco que no asienta nada', async () => {
        const { body } = await api<Reconciliation>(page, `/accounting/periods/${open}/reconciliation`);
        expect(body.preview).toBe(true);
        expect(body.closedAt).toBeNull();
        // A month whose last day has not come is checked to date: what the last day measures is pending, never a
        // difference (before, the 4th of a month said «differences» because the 30th had not closed).
        expect(body.checks.filter((c) => c.blocking && !c.ok && !c.pending).map((c) => c.code)).toEqual([]);
        await page.getByLabel('Período contable').selectOption(open);
        const card = page.locator('.bo-card').filter({ hasText: 'Conciliación para cerrar' });
        await expect(card).toBeVisible({ timeout: 20_000 });
        if (body.outcome === 'IN_PROGRESS') {
          await expect(card.getByText('En curso: en orden a la fecha')).toBeVisible({ timeout: 20_000 });
          await expect(card.getByText('Se miden al cierre del mes')).toBeVisible();
        }
        await expect(card.getByRole('button', { name: 'Volver a conciliar' })).toBeEnabled({ timeout: 20_000 });
      });
    }
  });
});
