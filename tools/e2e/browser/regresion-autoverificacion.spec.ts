import { test, expect, type Page } from '@playwright/test';
import { login } from './fixtures';

/**
 * The system verifies itself: commissions, treasury, the portfolio and the statements each check their own data and
 * say so, in the close's contract. After a run every check that must hold holds, and the console shows the four
 * reports with what is for review. Read-only. Besides working, it measures the four reports' answer time.
 */
const API = process.env.BO_API_URL ?? 'http://backoffice.localhost:8090';
const PASSWORD = process.env.BO_STAFF_PASSWORD ?? 'Backoffice#2026';
const BUDGET_MS = 5_000;
const SERVICIOS = ['commission-service', 'banking-service', 'credit-portfolio-service', 'statement-service'];
const NOMBRES = ['Comisiones', 'Tesorería', 'Cartera', 'Estados de cuenta'];

interface Check { code: string; ok: boolean; blocking: boolean; detail: string }
interface Report { service: string; outcome: string; checks: Check[] }

async function api<T>(page: Page, path: string): Promise<{ body: T; ms: number }> {
  const t = await page.evaluate(() => localStorage.getItem('bo.accessToken'));
  expect(t, 'no hay sesión').toBeTruthy();
  const started = Date.now();
  const res = await page.request.get(`${API}${path}`, { headers: { Authorization: `Bearer ${t}` } });
  expect(res.ok(), `${path} respondió ${res.status()}`).toBeTruthy();
  return { body: (await res.json()) as T, ms: Date.now() - started };
}

test.describe('Autoverificación del sistema', () => {
  test('cada servicio se revisa a sí mismo y todo lo que debe cumplirse se cumple', async ({ page }) => {
    test.setTimeout(120_000);
    await login(page, 'finanzas@kredius.mx', PASSWORD);

    await test.step('por la API: cuatro reportes, ninguna comprobación que deba cumplirse fuera', async () => {
      const { body: reports, ms } = await api<Report[]>(page, '/accounting/self-checks');
      expect(reports.map((r) => r.service)).toEqual(SERVICIOS);
      for (const r of reports) {
        expect(r.checks.length, `${r.service} sin comprobaciones`).toBeGreaterThan(0);
        const fuera = r.checks.filter((c) => c.blocking && !c.ok).map((c) => `${c.code}: ${c.detail}`);
        expect(fuera, `${r.service} no cumple`).toEqual([]);
        expect(r.outcome).toBe('IN_ORDER');
      }
      expect(ms, `la autoverificación tardó ${ms} ms`).toBeLessThan(BUDGET_MS);
    });

    await test.step('en pantalla: la pestaña muestra los cuatro reportes en orden', async () => {
      await page.goto('/contabilidad/autoverificacion');
      await expect(page.locator('.bo-page-title')).toContainText('Contabilidad');
      await expect(page.getByText('Todo en orden')).toBeVisible({ timeout: 20_000 });
      for (const nombre of NOMBRES) {
        const card = page.locator('.bo-card').filter({ has: page.locator('.bo-card-head', { hasText: nombre }) });
        await expect(card.first(), `no apareció ${nombre}`).toBeVisible();
        await expect(card.first().getByText('En orden', { exact: true }).first()).toBeVisible();
      }
    });
  });
});
