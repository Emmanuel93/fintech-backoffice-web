import { test, expect, type Page } from '@playwright/test';
import { login } from './fixtures';

/**
 * The trial balance by product. A product's balance carries everything it moved — its loans or commission lots and
 * the bank side of each —, so it balances by itself; the institution's own facts (funding, capital, their cost) sit
 * apart as «Institución»; and the parts add up to the whole, account by account. Each product also shows its
 * accounting scheme: every concept with the pair of accounts it moves. Read-only.
 *
 * Besides working, it measures: each product's trial balance must answer within the budget a finance operator expects.
 */
const API = process.env.BO_API_URL ?? 'http://backoffice.localhost:8090';
const PASSWORD = process.env.BO_STAFF_PASSWORD ?? 'Backoffice#2026';
const BUDGET_MS = 3_000;
const INSTITUCION = 'INSTITUCION';

interface Period { period: string; status: 'OPEN' | 'CLOSED' }
interface Row { accountCode: string; closingBalance: number }
interface ProductMovement { productType: string; productName: string; vouchers: number }
interface Pair { debitAccount: string; creditAccount: string; amount: number }
interface Scheme { productType: string; productName: string; concepts: Array<{ triggerEvent: string; amount: number; pairs: Pair[] }> }

async function api<T>(page: Page, path: string): Promise<{ body: T; ms: number }> {
  const t = await page.evaluate(() => localStorage.getItem('bo.accessToken'));
  expect(t, 'no hay sesión').toBeTruthy();
  const started = Date.now();
  const res = await page.request.get(`${API}${path}`, { headers: { Authorization: `Bearer ${t}` } });
  expect(res.ok(), `${path} respondió ${res.status()}`).toBeTruthy();
  return { body: (await res.json()) as T, ms: Date.now() - started };
}

const cents = (v: number) => Math.round(v * 100);

test.describe('Balanza por producto', () => {
  test('cada producto cuadra, la institución va aparte y las partes suman la balanza', async ({ page }) => {
    test.setTimeout(120_000);
    await login(page, 'finanzas@kredius.mx', PASSWORD);

    const { body: periods } = await api<Period[]>(page, '/accounting/periods');
    const closed = periods.filter((p) => p.status === 'CLOSED').map((p) => p.period).sort().pop();
    expect(closed, 'no hay ningún mes cerrado: ¿corrió el cierre de mes?').toBeTruthy();
    const { body: products } = await api<ProductMovement[]>(page, `/accounting/products?period=${closed}`);
    const lending = products.filter((p) => p.productType !== INSTITUCION);
    expect(lending.length, `${closed} no movió ningún producto`).toBeGreaterThan(0);

    await test.step('por la API: cada parte cuadra y las partes suman la balanza, cuenta por cuenta', async () => {
      const { body: whole } = await api<Row[]>(page, `/accounting/trial-balance?period=${closed}`);
      const sum = new Map<string, number>();
      for (const p of [...lending.map((l) => l.productType), INSTITUCION]) {
        const { body: rows, ms } = await api<Row[]>(page, `/accounting/trial-balance?period=${closed}&productTypes=${p}`);
        const balance = rows.reduce((s, r) => s + cents(r.closingBalance), 0);
        expect(balance, `la balanza de ${p} no cuadra`).toBe(0);
        rows.forEach((r) => sum.set(r.accountCode, (sum.get(r.accountCode) ?? 0) + cents(r.closingBalance)));
        expect(ms, `la balanza de ${p} tardó ${ms} ms`).toBeLessThan(BUDGET_MS);
      }
      const off = whole.filter((r) => cents(r.closingBalance) !== (sum.get(r.accountCode) ?? 0)).map((r) => r.accountCode);
      expect(off, 'cuentas donde los productos no suman la balanza').toEqual([]);
    });

    await test.step('por la API: el esquema de cada producto, concepto por concepto, suma sus pares', async () => {
      for (const p of lending) {
        const { body: scheme } = await api<Scheme>(page, `/accounting/products/${p.productType}/scheme?to=${closed}`);
        expect(scheme.concepts.length, `${p.productType} sin conceptos`).toBeGreaterThan(0);
        for (const c of scheme.concepts) {
          expect(c.pairs.reduce((s, x) => s + cents(x.amount), 0), `${p.productType} · ${c.triggerEvent}`)
            .toBe(cents(c.amount));
        }
      }
    });

    await test.step('en pantalla: el selector «Producto» filtra la balanza y trae el esquema del producto', async () => {
      await page.goto('/contabilidad/balanza');
      await expect(page.locator('.bo-page-title')).toContainText('Contabilidad');
      await page.getByLabel('Período contable').selectOption(closed!);
      await expect(page.getByText(/Ecuación contable al cierre/)).toBeVisible({ timeout: 20_000 });

      const product = lending[0];
      const started = Date.now();
      await page.getByLabel('Producto de la balanza').selectOption(product.productType);
      const scheme = page.locator('.bo-card').filter({ hasText: `Esquema contable · ${product.productName}` });
      await expect(scheme, 'no apareció el esquema del producto').toBeVisible({ timeout: 20_000 });
      await expect(scheme.locator('tbody tr').first()).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText('Sumas iguales: cuadra')).toBeVisible({ timeout: 20_000 });
      // The equation reads the institution's balance sheet: a product is a part of it, so it hides.
      await expect(page.getByText(/Ecuación contable al cierre/)).toHaveCount(0);
      expect(Date.now() - started, 'la balanza del producto tardó en pantalla').toBeLessThan(BUDGET_MS * 3);

      await page.getByLabel('Producto de la balanza').selectOption(INSTITUCION);
      await expect(page.locator('.bo-card').filter({ hasText: 'Esquema contable · Institución' }))
        .toBeVisible({ timeout: 20_000 });
      await expect(page.getByText('Sumas iguales: cuadra')).toBeVisible({ timeout: 20_000 });

      await page.getByLabel('Producto de la balanza').selectOption('');
      await expect(page.getByText(/Ecuación contable al cierre/)).toBeVisible({ timeout: 20_000 });
    });
  });
});
