import type { AccountStatement, PartyStatements } from '@bo/shared-types';
import { isMock } from './config.js';
import { request, requestBlob } from './http.js';
import { ACCOUNTS, DISTRIBUTORS } from './mock-data.js';

/**
 * Statements of a client or a distributor, from their file.
 *
 * The route hangs from the holder (`/clients/{partyId}/statements`), not from the statement: the BFF
 * only hands over a statement from the file of whoever owns it, so a statement id copied from another
 * file answers 404. The PDF goes through `fetch` because the endpoint requires the token, which a plain
 * link does not send.
 */
export const statementsApi = {
  async list(partyId: string): Promise<PartyStatements> {
    if (!isMock()) return request<PartyStatements>(`/clients/${partyId}/statements`);
    return wait(mockStatements(partyId));
  },

  /** The PDF as a `blob:` URL, to open in a new tab. Whoever asks for it revokes it when done. */
  async pdfUrl(partyId: string, statement: AccountStatement): Promise<string> {
    return URL.createObjectURL(await pdf(partyId, statement, false));
  },

  /** Saves the PDF with the same file name statement-service gives it. */
  async download(partyId: string, statement: AccountStatement): Promise<void> {
    const url = URL.createObjectURL(await pdf(partyId, statement, true));
    const link = document.createElement('a');
    link.href = url;
    link.download = statementFileName(statement);
    document.body.appendChild(link);
    link.click();
    link.remove();
    // The browser has taken the file by the next tick; the URL is released a little later to be safe.
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  },
};

/** `estado-de-cuenta-<contract>-<cutoff>.pdf`, as statement-service names it. */
export function statementFileName(s: AccountStatement): string {
  return `estado-de-cuenta-${s.contractNumber ?? s.creditAccountId}-${s.cutoffDate}.pdf`;
}

async function pdf(partyId: string, s: AccountStatement, download: boolean): Promise<Blob> {
  if (isMock()) return mockPdf(s);
  return requestBlob(`/clients/${partyId}/statements/${s.statementId}/pdf${download ? '?download=true' : ''}`);
}

const wait = <T,>(v: T, ms = 240): Promise<T> => new Promise((r) => setTimeout(() => r(v), ms));

/* ============================ mock ============================ */

type MockAccount = Pick<PartyStatements['accounts'][number], 'creditAccountId' | 'contractNumber' | 'productType' | 'status'>
  & { principalBalance: number };

/** Six monthly cutoffs per account of the party (a distributor's line too), newest first. */
function mockStatements(partyId: string): PartyStatements {
  const distributor = DISTRIBUTORS.find((d) => d.partyId === partyId);
  const accounts: MockAccount[] = ACCOUNTS.filter((a) => a.obligorPartyId === partyId);
  // The mock distributors' own line is not among the accounts: it is drawn from the distributor's row.
  if (distributor?.creditLineId && !accounts.some((a) => a.creditAccountId === distributor.creditLineId)) {
    accounts.push({
      creditAccountId: distributor.creditLineId,
      contractNumber: `KRD-DL-${distributor.promoterCode ?? distributor.partyId.slice(0, 6)}`,
      productType: 'DISTRIBUTOR_LINE',
      status: 'ACTIVE',
      principalBalance: Math.max((distributor.creditLineLimit ?? 0) - (distributor.creditLineAvailable ?? 0), 0),
    });
  }
  const statements: AccountStatement[] = [];
  accounts.filter((a) => a.status !== 'PENDING_ACTIVATION').forEach((a) => {
    for (let cycle = 6; cycle >= 1; cycle -= 1) {
      const cutoff = `2026-${String(cycle + 3).padStart(2, '0')}-02`;
      const balance = Math.max(a.principalBalance + 1000 * (6 - cycle), 0);
      statements.push({
        statementId: `${a.creditAccountId}-ST-${cycle}`,
        creditAccountId: a.creditAccountId,
        contractNumber: a.contractNumber,
        productType: a.productType,
        cycleNumber: cycle,
        periodStart: `2026-${String(cycle + 2).padStart(2, '0')}-03`,
        cutoffDate: cutoff,
        paymentDueDate: `2026-${String(cycle + 3).padStart(2, '0')}-22`,
        balanceAtCutoff: balance,
        amountDue: balance,
        minimumPayment: Math.round(balance * 0.05 * 100) / 100,
        status: 'GENERATED',
        documentBytes: 42_000,
        generatedAt: `${cutoff}T06:10:00Z`,
        downloadable: true,
      });
    }
  });
  statements.sort((x, y) => y.cutoffDate.localeCompare(x.cutoffDate));
  return {
    accounts: accounts.map((a) => ({
      creditAccountId: a.creditAccountId, contractNumber: a.contractNumber, productType: a.productType, status: a.status,
    })),
    statements,
  };
}

/** A one-page PDF that says what it is: in mock there is no statement-service to render the real one. */
function mockPdf(s: AccountStatement): Blob {
  const text = `Estado de cuenta (demo) ${s.contractNumber ?? ''} corte ${s.cutoffDate}`;
  const stream = `BT /F1 14 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => { offsets.push(body.length); body += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((off) => { body += `${String(off).padStart(10, '0')} 00000 n \n`; });
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new Blob([body], { type: 'application/pdf' });
}
