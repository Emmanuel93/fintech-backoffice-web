import { useEffect, useMemo, useRef, useState } from 'react';
import { receiptsApi, receiptFileName } from '@bo/api-client';
import { isExternalCollaborator } from '@bo/auth';
import {
  useAsync, Collapsible, DataTable, Badge, Button, Select, Spinner, EmptyState, money, date,
  type Column,
} from '@bo/design-system';
import { CLIENT_TYPE_LABELS, type PaymentReceipt } from '@bo/shared-types';

/**
 * The payment receipts inside a file: a distributor's file lists her clients' receipts (one per client and
 * statement), a client's file lists his. Folded like the statements; the header answers how many there are and the
 * latest cutoff. A filter by cutoff is what whoever opens it uses most: «the receipts of the 21st».
 *
 * The amount is what the client pays, without his distributor's early-payment discount (that one is hers). A
 * distributor's employee does not see the section: the receipt carries the client's name and RFC.
 */
export function ReceiptsSection({ partyId, emptyHint }: { partyId: string; emptyHint?: string }) {
  if (isExternalCollaborator()) return null;
  return <ReceiptsPanel partyId={partyId} emptyHint={emptyHint} />;
}

function ReceiptsPanel({ partyId, emptyHint }: { partyId: string; emptyHint?: string }) {
  const { data, loading, error } = useAsync(() => receiptsApi.list(partyId), [partyId]);
  const [cutoff, setCutoff] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [viewing, setViewing] = useState<{ receipt: PaymentReceipt; url: string } | null>(null);
  const viewingUrl = useRef<string | null>(null);

  useEffect(() => () => { if (viewingUrl.current) URL.revokeObjectURL(viewingUrl.current); }, []);

  const receipts = data?.receipts ?? [];
  const cutoffs = useMemo(() => Array.from(new Set(receipts.map((r) => r.cutoffDate))), [receipts]);
  const shown = cutoff ? receipts.filter((r) => r.cutoffDate === cutoff) : receipts;
  const total = shown.reduce((s, r) => s + (r.totalDue ?? 0), 0);

  async function view(r: PaymentReceipt) {
    setBusy(r.receiptId); setFailure(null);
    try {
      const url = await receiptsApi.pdfUrl(partyId, r);
      if (viewingUrl.current) URL.revokeObjectURL(viewingUrl.current);
      viewingUrl.current = url;
      setViewing({ receipt: r, url });
    } catch (e) {
      setFailure(e instanceof Error ? e.message : 'No se pudo abrir el recibo');
    } finally {
      setBusy(null);
    }
  }

  async function download(r: PaymentReceipt) {
    setBusy(r.receiptId); setFailure(null);
    try {
      await receiptsApi.download(partyId, r);
    } catch (e) {
      setFailure(e instanceof Error ? e.message : 'No se pudo descargar el recibo');
    } finally {
      setBusy(null);
    }
  }

  function closeViewer() {
    if (viewingUrl.current) URL.revokeObjectURL(viewingUrl.current);
    viewingUrl.current = null;
    setViewing(null);
  }

  const columns: Array<Column<PaymentReceipt>> = [
    { key: 'cutoff', header: 'Corte', render: (r) => <span style={{ whiteSpace: 'nowrap' }}>{date(r.cutoffDate)}</span> },
    ...(data?.asDistributor ? [{
      key: 'client', header: 'Cliente',
      render: (r: PaymentReceipt) => r.clientName ?? r.beneficiaryPartyId,
    } as Column<PaymentReceipt>] : []),
    {
      key: 'type', header: 'Tipo',
      render: (r) => r.clientType
        ? <Badge tone={r.clientType === 'REVOLVENTE' ? 'ok' : 'muted'}>{CLIENT_TYPE_LABELS[r.clientType]}</Badge>
        : '—',
    },
    { key: 'loans', header: 'Préstamos', align: 'right', render: (r) => r.liveLoans ?? '—' },
    { key: 'due', header: 'A pagar', align: 'right', render: (r) => (r.totalDue == null ? '—' : money(r.totalDue, true)) },
    { key: 'limit', header: 'Fecha límite', render: (r) => <span style={{ whiteSpace: 'nowrap' }}>{date(r.paymentDueDate)}</span> },
    { key: 'ref', header: 'Referencia', render: (r) => <span style={{ fontFamily: 'var(--bo-mono)' }}>{r.paymentReference ?? '—'}</span> },
    {
      key: 'actions', header: '', align: 'right',
      render: (r) => (r.status === 'GENERATED' ? (
        <span style={{ display: 'inline-flex', gap: 6 }}>
          <Button onClick={() => void view(r)} disabled={busy === r.receiptId}>Ver</Button>
          <Button variant="primary" onClick={() => void download(r)} disabled={busy === r.receiptId} title={receiptFileName(r)}>
            {busy === r.receiptId ? 'Bajando…' : 'Descargar'}
          </Button>
        </span>
      ) : <Badge tone={r.status === 'FAILED' ? 'bad' : 'muted'}>{r.status === 'FAILED' ? 'Falló al generar' : 'En cola'}</Badge>),
    },
  ];

  const subtitle = loading && !data ? 'cargando…'
    : error ? 'no se pudieron leer'
      : receipts.length ? `último corte ${date(receipts[0].cutoffDate)}`
        : 'aún no hay recibos';

  return (
    <Collapsible title="Recibos de pago" ariaLabel="Recibos de pago" count={data ? receipts.length : undefined} subtitle={subtitle}>
      {error ? (
        <EmptyState message={`No se pudieron leer los recibos: ${error}`} />
      ) : loading && !data ? <Spinner /> : receipts.length === 0 ? (
        <EmptyState message={emptyHint ?? 'Aún no hay recibos: se generan en cada corte de la línea de su distribuidora.'} />
      ) : (
        <>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 220 }}>
              <Select value={cutoff} onChange={setCutoff} placeholder="Todos los cortes"
                options={[{ value: '', label: 'Todos los cortes' }, ...cutoffs.map((c) => ({ value: c, label: `Corte ${date(c)}` }))]} />
            </div>
            <span className="bo-sub">
              {shown.length} {shown.length === 1 ? 'recibo' : 'recibos'} · {money(total, true)} sin el descuento de la distribuidora
            </span>
          </div>
          <DataTable columns={columns} rows={shown} rowKey={(r) => r.receiptId} emptyMessage="Sin recibos" />
        </>
      )}

      {failure && <p style={{ color: 'var(--bo-bad)', fontSize: 12.5, marginTop: 8 }}>{failure}</p>}

      {viewing && (
        <div className="bo-doc open" style={{ marginTop: 12 }}>
          <div className="bo-doc-tools">
            <b style={{ flex: 1, fontSize: 13 }}>{viewing.receipt.folio} · {viewing.receipt.clientName}</b>
            <a href={viewing.url} target="_blank" rel="noreferrer">Abrir en pestaña</a>
            <a href={viewing.url} download={receiptFileName(viewing.receipt)}>Descargar</a>
            <button type="button" onClick={closeViewer}>Cerrar</button>
          </div>
          <div className="bo-doc-canvas">
            <iframe src={viewing.url} title={`Recibo ${viewing.receipt.folio ?? ''}`} style={{ width: '100%', height: 620, border: 0 }} />
          </div>
        </div>
      )}
    </Collapsible>
  );
}
