import type {
  ClientCreditProfile, PartyReceipts, PaymentReceipt, ReportReason,
} from '@bo/shared-types';
import { isMock } from './config.js';
import { request, requestBlob } from './http.js';
import { CLIENTS, DISTRIBUTORS } from './mock-data.js';

/**
 * The payment receipts of a distributor's clients, and a client's type and red list.
 *
 * The routes hang from the file (`/clients/{partyId}/…`): a distributor's file lists her clients' receipts, a client's
 * file lists his. The BFF hands a receipt's PDF only from the file of its client or its distributor. Marking a client
 * on the red list, or clearing a mark, is collections' management (`collections.manage`).
 */
export const receiptsApi = {
  async list(partyId: string): Promise<PartyReceipts> {
    if (!isMock()) return request<PartyReceipts>(`/clients/${partyId}/receipts`);
    return wait(mockReceipts(partyId));
  },

  /** The PDF as a `blob:` URL; whoever asks for it revokes it when done. */
  async pdfUrl(partyId: string, receipt: PaymentReceipt): Promise<string> {
    return URL.createObjectURL(await pdf(partyId, receipt, false));
  },

  async download(partyId: string, receipt: PaymentReceipt): Promise<void> {
    const url = URL.createObjectURL(await pdf(partyId, receipt, true));
    const link = document.createElement('a');
    link.href = url;
    link.download = receiptFileName(receipt);
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  },

  /** His type (nuevo / revolvente), his marks and their history. */
  async creditProfile(partyId: string): Promise<ClientCreditProfile> {
    if (!isMock()) return request<ClientCreditProfile>(`/clients/${partyId}/credit-profile`);
    return wait(mockProfile(partyId));
  },

  async markRedList(partyId: string, reason: ReportReason, comment: string): Promise<void> {
    if (isMock()) return;
    await request(`/clients/${partyId}/red-list`, { method: 'POST', body: { reason, comment } });
  },

  async clearRedList(partyId: string, flagId: string, comment: string): Promise<void> {
    if (isMock()) return;
    await request(`/clients/${partyId}/red-list/${flagId}/clear`, { method: 'POST', body: { comment } });
  },
};

/** `recibo-<folio>.pdf`, as the BFF names it. */
export function receiptFileName(r: PaymentReceipt): string {
  return `recibo-${r.folio ?? r.receiptId}.pdf`;
}

async function pdf(partyId: string, r: PaymentReceipt, download: boolean): Promise<Blob> {
  if (isMock()) return new Blob([`%PDF-1.4\n% Recibo (demo) ${r.folio ?? ''}\n%%EOF`], { type: 'application/pdf' });
  return requestBlob(`/clients/${partyId}/receipts/${r.receiptId}/pdf${download ? '?download=true' : ''}`);
}

const wait = <T,>(v: T, ms = 240): Promise<T> => new Promise((r) => setTimeout(() => r(v), ms));

/* ============================ mock ============================ */

function mockReceipts(partyId: string): PartyReceipts {
  const distributor = DISTRIBUTORS.find((d) => d.partyId === partyId);
  const clients = distributor ? CLIENTS.slice(0, 4) : CLIENTS.filter((c) => c.partyId === partyId);
  const receipts: PaymentReceipt[] = [];
  clients.forEach((c, k) => {
    for (let cycle = 4; cycle >= 1; cycle -= 1) {
      const day = cycle % 2 === 0 ? '06' : '21';
      const month = String(6 + Math.floor(cycle / 2)).padStart(2, '0');
      const cutoff = `2026-${month}-${day}`;
      receipts.push({
        receiptId: `${c.partyId}-RC-${cycle}`,
        creditAccountId: distributor?.creditLineId ?? 'LINEA-DEMO',
        cycleNumber: cycle,
        beneficiaryPartyId: c.partyId,
        distributorPartyId: distributor?.partyId ?? 'DIST-DEMO',
        periodStart: null,
        cutoffDate: cutoff,
        paymentDueDate: day === '06' ? `2026-${month}-18` : `2026-${String(Number(month) + 1).padStart(2, '0')}-03`,
        status: 'GENERATED',
        folio: `RC-${cutoff.replaceAll('-', '')}-${1234566 + k * 8}`,
        clientName: c.fullName ?? `Cliente ${k + 1}`,
        clientType: k % 2 === 0 ? 'REVOLVENTE' : 'NUEVO',
        liveLoans: 1 + (k % 2),
        totalDue: 487.6 + 120 * k,
        paymentReference: 1234566 + k * 8,
        clabe: '646180157000000004',
        documentBytes: 72_000,
        generatedAt: `${cutoff}T06:12:00Z`,
      });
    }
  });
  receipts.sort((a, b) => b.cutoffDate.localeCompare(a.cutoffDate));
  return { asDistributor: !!distributor, receipts };
}

function mockProfile(partyId: string): ClientCreditProfile {
  const marked = partyId.endsWith('3');
  return {
    beneficiaryPartyId: partyId,
    type: partyId.endsWith('1') ? 'REVOLVENTE' : 'NUEVO',
    redListed: marked,
    flags: marked ? [{
      flagId: 'FLAG-DEMO-1', reason: 'DISTRIBUTOR_REPORT', source: 'DISTRIBUTOR', since: '2026-10-02T17:00:00Z',
      distributorPartyId: 'DIST-DEMO', creditAccountId: null, detail: 'NOT_LOCATABLE', comment: 'No contesta desde septiembre',
    }] : [],
    loansGranted: 3,
    loansPaid: partyId.endsWith('1') ? 2 : 0,
    activeLoans: 1,
    outstanding: 2500,
    history: marked ? [{
      flagId: 'FLAG-DEMO-1', reason: 'DISTRIBUTOR_REPORT', source: 'DISTRIBUTOR', distributorPartyId: 'DIST-DEMO',
      detail: 'NOT_LOCATABLE', comment: 'No contesta desde septiembre', raisedAt: '2026-10-02T17:00:00Z', raisedBy: null,
      clearedAt: null, clearedBy: null, clearComment: null, active: true,
    }] : [],
  };
}
