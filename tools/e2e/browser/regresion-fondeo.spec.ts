import { test, expect, type Page } from '@playwright/test';
import { login } from './fixtures';

/**
 * Funding on the treasury screen: where the money the institution lends comes from. The seeded history has a capital
 * contribution and a funding line drawn on its first day, whose interest is accrued and paid at every month's end.
 * Read-only: it never records a movement. Besides working, it measures: the list must arrive within two seconds.
 */
const API = process.env.BO_API_URL ?? 'http://backoffice.localhost:8090';
const PASSWORD = process.env.BO_STAFF_PASSWORD ?? 'Backoffice#2026';
const LIST_BUDGET_MS = 2_000;

interface Source { fundingSourceId: string; kind: string; contributed: number; principal: number; accruedThrough: string | null }
interface Movement { type: string }

async function api<T>(page: Page, path: string): Promise<{ body: T; ms: number }> {
  const t = await page.evaluate(() => localStorage.getItem('bo.accessToken'));
  const started = Date.now();
  const res = await page.request.get(`${API}${path}`, { headers: { Authorization: `Bearer ${t}` } });
  expect(res.ok(), `${path} respondió ${res.status()}`).toBeTruthy();
  return { body: (await res.json()) as T, ms: Date.now() - started };
}

test.describe('Fondeo en tesorería', () => {
  test('el capital y la línea de fondeo, con los intereses de cada mes', async ({ page }) => {
    test.setTimeout(120_000);
    await login(page, 'finanzas@kredius.mx', PASSWORD);

    const { body: sources, ms } = await api<Source[]>(page, '/treasury/funding');
    expect(ms, `el fondeo tardó ${ms} ms`).toBeLessThan(LIST_BUDGET_MS);
    const capital = sources.find((s) => s.kind === 'CAPITAL');
    const line = sources.find((s) => s.kind === 'CREDIT_LINE');
    expect(capital?.contributed, 'no hay capital aportado').toBeGreaterThan(0);
    expect(line?.principal, 'no hay línea dispuesta').toBeGreaterThan(0);
    expect(line?.accruedThrough, 'la línea no tiene intereses devengados').toBeTruthy();
    const { body: movements } = await api<Movement[]>(page, `/treasury/funding/${line!.fundingSourceId}/movements`);
    expect(movements.map((m) => m.type)).toEqual(expect.arrayContaining(['DRAWDOWN', 'INTEREST_ACCRUAL', 'INTEREST_PAYMENT']));

    await test.step('en pantalla: el fondeo y los movimientos de la línea', async () => {
      await page.goto('/contabilidad/tesoreria');
      const card = page.locator('.bo-card').filter({ hasText: 'Capital aportado' });
      await expect(card, 'no apareció el fondeo').toBeVisible({ timeout: 20_000 });
      await expect(card.getByText('Línea de fondeo', { exact: true })).toBeVisible({ timeout: 20_000 });
      await expect(card.getByText('Registrar línea de fondeo')).toBeVisible();
      await card.locator('.bo-table tbody tr', { hasText: 'Línea de fondeo' }).first().click();
      const modal = page.locator('.bo-modal');
      await expect(modal).toBeVisible();
      // In the movements table, not in the form's selector (which also offers «Pago de intereses»).
      const table = modal.locator('.bo-table tbody');
      await expect(table.getByText('Devengo de intereses').first()).toBeVisible({ timeout: 20_000 });
      await expect(table.getByText('Pago de intereses').first()).toBeVisible();
    });
  });
});
