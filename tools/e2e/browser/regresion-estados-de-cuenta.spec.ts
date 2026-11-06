import { readFileSync } from 'node:fs';
import { test, expect, type Page, type Locator } from '@playwright/test';
import { login } from './fixtures';

/**
 * Statements from the file of a client and of a distributor: the section lists every cutoff, «Ver»
 * shows the PDF in place and «Descargar» saves the PDF statement-service generated, with its name.
 *
 * The client and the distributor are picked through the API (the first with statements), not by name:
 * that way the test does not depend on one seed. Besides working, it measures: the list and the PDF
 * must arrive within a second or two, as an operator expects when opening a file.
 */
const API = process.env.BO_API_URL ?? 'http://backoffice.localhost:8090';
const PASSWORD = process.env.BO_STAFF_PASSWORD ?? 'Backoffice#2026';
const LIST_BUDGET_MS = 2_000;
const PDF_BUDGET_MS = 3_000;

interface Holder { partyId: string; search: string; statements: number }

async function token(page: Page): Promise<string> {
  const t = await page.evaluate(() => localStorage.getItem('bo.accessToken'));
  expect(t, 'no hay sesión').toBeTruthy();
  return t as string;
}

async function api<T>(page: Page, path: string): Promise<{ body: T; ms: number }> {
  const started = Date.now();
  const res = await page.request.get(`${API}${path}`, { headers: { Authorization: `Bearer ${await token(page)}` } });
  expect(res.ok(), `${path} respondió ${res.status()}`).toBeTruthy();
  return { body: (await res.json()) as T, ms: Date.now() - started };
}

/** The first holder of the list that has statements, and how to find them with the console's search box. */
async function firstWithStatements(page: Page, rows: Array<{ partyId: string; search: string | null }>): Promise<Holder> {
  for (const row of rows) {
    if (!row.search) continue;
    const { body } = await api<{ statements: unknown[] }>(page, `/clients/${row.partyId}/statements`);
    if (body.statements.length > 0) return { partyId: row.partyId, search: row.search, statements: body.statements.length };
  }
  throw new Error('ningún titular de la lista tiene estados de cuenta: ¿la base está sembrada?');
}

async function openFile(page: Page, search: string, placeholder: string | RegExp): Promise<Locator> {
  const box = page.getByPlaceholder(placeholder);
  await box.fill(search);
  const row = page.locator('.bo-table tbody tr.clickable').first();
  await expect(row, `no apareció ${search} en el directorio`).toBeVisible({ timeout: 20_000 });
  await row.click();
  const modal = page.locator('.bo-modal');
  await expect(modal).toBeVisible();
  return modal;
}

async function checkStatements(page: Page, modal: Locator, expected: number): Promise<void> {
  const section = modal.getByRole('region', { name: 'Estados de cuenta' });

  await test.step('plegada, la sección ya dice cuántos hay y deja bajar el último', async () => {
    const started = Date.now();
    await expect(section.locator('.bo-collapsible-count')).toHaveText(String(expected), { timeout: 20_000 });
    const ms = Date.now() - started;
    test.info().annotations.push({ type: 'tiempo del encabezado (ms)', description: String(ms) });
    expect(ms, `el encabezado tardó ${ms} ms`).toBeLessThan(LIST_BUDGET_MS * 2);
    await expect(section.getByText(/último corte/)).toBeVisible();
    await expect(section.locator('tbody tr')).toHaveCount(0);

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      section.getByRole('button', { name: 'Descargar último' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^estado-de-cuenta-.+-\d{4}-\d{2}-\d{2}\.pdf$/);
  });

  await test.step('abierta, lista todos los cortes por contrato', async () => {
    await section.locator('.bo-collapsible-head').click();
    const more = section.getByRole('button', { name: /^Ver los \d+ estados$/ });
    for (let i = await more.count(); i > 0; i -= 1) await more.first().click();
    await expect(section.locator('tbody tr')).toHaveCount(expected, { timeout: 10_000 });
    await section.scrollIntoViewIfNeeded();
    await page.screenshot({ path: test.info().outputPath('estados-de-cuenta.png') });
  });

  await test.step('«Descargar» guarda el PDF de statement-service con su nombre', async () => {
    const started = Date.now();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      section.getByRole('button', { name: 'Descargar', exact: true }).first().click(),
    ]);
    const ms = Date.now() - started;
    test.info().annotations.push({ type: 'tiempo de la descarga (ms)', description: String(ms) });
    expect(download.suggestedFilename()).toMatch(/^estado-de-cuenta-.+-\d{4}-\d{2}-\d{2}\.pdf$/);
    const path = await download.path();
    expect(readFileSync(path).subarray(0, 5).toString()).toBe('%PDF-');
    expect(ms, `la descarga tardó ${ms} ms`).toBeLessThan(PDF_BUDGET_MS);
  });

  await test.step('«Ver» muestra el PDF dentro del expediente', async () => {
    await section.getByRole('button', { name: 'Ver', exact: true }).first().click();
    await expect(section.locator('iframe[title^="Estado de cuenta"]')).toBeVisible({ timeout: 10_000 });
    await expect(section.getByRole('link', { name: 'Descargar' })).toBeVisible();
    await section.getByRole('button', { name: 'Cerrar' }).click();
    await expect(section.locator('iframe')).toHaveCount(0);
  });
}

test.describe('Estados de cuenta desde el expediente', () => {
  test('cliente: lista, ve y descarga sus estados de cuenta', async ({ page }) => {
    await login(page, 'ops@kredius.mx', PASSWORD);
    const { body: clients } = await api<{ content: Array<{ partyId: string; curp: string | null }> }>(
      page, '/clients?type=INDIVIDUAL&size=60');
    const holder = await firstWithStatements(page, clients.content.map((c) => ({ partyId: c.partyId, search: c.curp })));

    await test.step('la API contesta dentro del presupuesto', async () => {
      const { ms } = await api(page, `/clients/${holder.partyId}/statements`);
      expect(ms, `la API tardó ${ms} ms`).toBeLessThan(LIST_BUDGET_MS);
    });

    await page.goto('/clientes');
    const modal = await openFile(page, holder.search, 'Buscar nombre, CURP o RFC…');
    await checkStatements(page, modal, holder.statements);
  });

  test('distribuidor: lista, ve y descarga los estados de su línea', async ({ page }) => {
    await login(page, 'ops@kredius.mx', PASSWORD);
    const { body: distributors } = await api<{ content: Array<{ partyId: string; promoterCode: string | null }> }>(
      page, '/distributors?size=100');
    const holder = await firstWithStatements(page,
      distributors.content.map((d) => ({ partyId: d.partyId, search: d.promoterCode })));

    await page.goto('/clientes');
    await page.getByRole('tab', { name: /distribuidores/i }).click();
    const modal = await openFile(page, holder.search, /buscar por nombre o código/i);
    await checkStatements(page, modal, holder.statements);
  });

  test('la consola no entrega el estado de otro titular aunque se pida a mano', async ({ page }) => {
    await login(page, 'ops@kredius.mx', PASSWORD);
    const { body: clients } = await api<{ content: Array<{ partyId: string; curp: string | null }> }>(
      page, '/clients?type=INDIVIDUAL&size=60');
    const owner = await firstWithStatements(page, clients.content.map((c) => ({ partyId: c.partyId, search: c.curp })));
    const other = clients.content.find((c) => c.partyId !== owner.partyId);
    expect(other, 'hace falta un segundo cliente').toBeTruthy();
    const { body } = await api<{ statements: Array<{ statementId: string }> }>(page, `/clients/${owner.partyId}/statements`);

    const res = await page.request.get(
      `${API}/clients/${other!.partyId}/statements/${body.statements[0].statementId}/pdf?download=true`,
      { headers: { Authorization: `Bearer ${await token(page)}` } });
    expect(res.status()).toBe(404);
  });
});
