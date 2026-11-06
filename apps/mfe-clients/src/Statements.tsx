import { useEffect, useMemo, useRef, useState } from 'react';
import { statementsApi, statementFileName } from '@bo/api-client';
import { isExternalCollaborator } from '@bo/auth';
import {
  useAsync, Collapsible, DataTable, Badge, Button, Spinner, EmptyState, money, date,
  type Column,
} from '@bo/design-system';
import {
  PRODUCT_TYPE_LABELS, ACCOUNT_STATUS_LABELS, accountStatusTone,
  type AccountStatement, type PartyStatements,
} from '@bo/shared-types';

/**
 * The statements of a client or a distributor, inside their file.
 *
 * It is an operational screen: whoever opens the file usually wants the latest statement, or the one of a given
 * month, and the file has other sections to read. So the section starts folded, and its header already answers
 * the first question — how many there are, the latest cutoff, and a button to download it — without opening.
 * Opened, the statements are grouped by contract (a distributor may also have an own-use credit), newest first,
 * the latest six at sight and the rest one click away.
 *
 * A distributor's employee does not see the section: the statement carries the borrower's RFC and address, and the
 * BFF denies it to them anyway. Hiding it keeps the console from offering a button that can only answer 403.
 */
export function StatementsSection({ partyId, emptyHint }: { partyId: string; emptyHint?: string }) {
  if (isExternalCollaborator()) return null;
  return <StatementsPanel partyId={partyId} emptyHint={emptyHint} />;
}

const VISIBLE_PER_CONTRACT = 6;

const STATUS_LABELS: Record<AccountStatement['status'], string> = {
  PENDING: 'En cola',
  GENERATING: 'Generándose',
  GENERATED: 'Generado',
  FAILED: 'Falló al generar',
};

interface ContractGroup {
  contractNumber: string;
  account: PartyStatements['accounts'][number] | undefined;
  statements: AccountStatement[];
}

function StatementsPanel({ partyId, emptyHint }: { partyId: string; emptyHint?: string }) {
  const { data, loading, error } = useAsync(() => statementsApi.list(partyId), [partyId]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [viewing, setViewing] = useState<{ statement: AccountStatement; url: string } | null>(null);
  const viewingUrl = useRef<string | null>(null);

  // Every blob opened holds memory until it is revoked: the previous one when another is opened, and the last
  // one when the file is closed.
  useEffect(() => () => { if (viewingUrl.current) URL.revokeObjectURL(viewingUrl.current); }, []);

  const statements = data?.statements ?? [];
  const latest = statements.find((s) => s.downloadable);

  // One group per contract, in the order the accounts come; a statement whose account is not listed still gets
  // its group.
  const groups = useMemo<ContractGroup[]>(() => {
    const byContract = new Map<string, AccountStatement[]>();
    (data?.statements ?? []).forEach((s) => {
      const key = s.contractNumber ?? s.creditAccountId;
      byContract.set(key, [...(byContract.get(key) ?? []), s]);
    });
    const ordered: ContractGroup[] = (data?.accounts ?? [])
      .filter((a) => byContract.has(a.contractNumber))
      .map((a) => ({ contractNumber: a.contractNumber, account: a, statements: byContract.get(a.contractNumber) ?? [] }));
    byContract.forEach((rows, key) => {
      if (!ordered.some((g) => g.contractNumber === key)) ordered.push({ contractNumber: key, account: undefined, statements: rows });
    });
    return ordered;
  }, [data]);

  async function view(s: AccountStatement) {
    setBusy(s.statementId);
    setFailure(null);
    try {
      const url = await statementsApi.pdfUrl(partyId, s);
      if (viewingUrl.current) URL.revokeObjectURL(viewingUrl.current);
      viewingUrl.current = url;
      setViewing({ statement: s, url });
    } catch (e) {
      setFailure(e instanceof Error ? e.message : 'No se pudo abrir el estado de cuenta');
    } finally {
      setBusy(null);
    }
  }

  async function download(s: AccountStatement) {
    setBusy(s.statementId);
    setFailure(null);
    try {
      await statementsApi.download(partyId, s);
    } catch (e) {
      setFailure(e instanceof Error ? e.message : 'No se pudo descargar el estado de cuenta');
    } finally {
      setBusy(null);
    }
  }

  function closeViewer() {
    if (viewingUrl.current) URL.revokeObjectURL(viewingUrl.current);
    viewingUrl.current = null;
    setViewing(null);
  }

  const columns: Array<Column<AccountStatement>> = [
    { key: 'cycle', header: 'Ciclo', align: 'right', render: (s) => s.cycleNumber },
    {
      key: 'period',
      header: 'Periodo',
      render: (s) => <span style={{ whiteSpace: 'nowrap' }}>{`${date(s.periodStart)} – ${date(s.cutoffDate)}`}</span>,
    },
    { key: 'due', header: 'Fecha límite', render: (s) => <span style={{ whiteSpace: 'nowrap' }}>{date(s.paymentDueDate)}</span> },
    { key: 'balance', header: 'Saldo al corte', align: 'right', render: (s) => money(s.balanceAtCutoff, true) },
    {
      key: 'due-amount',
      header: 'A pagar',
      align: 'right',
      render: (s) => (
        <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
          <span>{s.amountDue == null ? '—' : money(s.amountDue, true)}</span>
          {s.minimumPayment != null && <span className="bo-sub">mín. {money(s.minimumPayment, true)}</span>}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: (s) => (s.downloadable ? (
        <span style={{ display: 'inline-flex', gap: 6 }}>
          <Button onClick={() => void view(s)} disabled={busy === s.statementId} title="Ver el PDF aquí">Ver</Button>
          <Button variant="primary" onClick={() => void download(s)} disabled={busy === s.statementId}
            title={statementFileName(s)}>
            {busy === s.statementId ? 'Bajando…' : 'Descargar'}
          </Button>
        </span>
      ) : <Badge tone={s.status === 'FAILED' ? 'bad' : 'muted'}>{STATUS_LABELS[s.status] ?? s.status}</Badge>),
    },
  ];

  const subtitle = loading && !data
    ? 'cargando…'
    : error
      ? 'no se pudieron leer'
      : latest
        ? `último corte ${date(latest.cutoffDate)} · ${latest.contractNumber ?? ''}`
        : 'aún no hay estados de cuenta';

  return (
    <Collapsible
      title="Estados de cuenta"
      ariaLabel="Estados de cuenta"
      count={data ? statements.length : undefined}
      subtitle={subtitle}
      actions={latest && (
        <Button onClick={() => void download(latest)} disabled={busy === latest.statementId}
          title={`Descargar ${statementFileName(latest)}`}>
          {busy === latest.statementId ? 'Bajando…' : 'Descargar último'}
        </Button>
      )}
    >
      {error ? (
        <EmptyState message={`No se pudieron leer los estados de cuenta: ${error}`} />
      ) : loading && !data ? <Spinner /> : groups.length === 0 ? (
        <EmptyState message={emptyHint ?? 'Aún no hay estados de cuenta: se generan en cada corte de sus cuentas.'} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {groups.map((g) => {
            const open = expanded[g.contractNumber] ?? false;
            const rows = open ? g.statements : g.statements.slice(0, VISIBLE_PER_CONTRACT);
            return (
              <div key={g.contractNumber} role="group" aria-label={`Contrato ${g.contractNumber}`}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '2px 0 6px' }}>
                  <b style={{ fontFamily: 'var(--bo-mono)', fontSize: 12.5 }}>{g.contractNumber}</b>
                  {g.account && <span className="bo-sub">{PRODUCT_TYPE_LABELS[g.account.productType] ?? g.account.productType}</span>}
                  {g.account && (
                    <Badge tone={accountStatusTone(g.account.status)}>{ACCOUNT_STATUS_LABELS[g.account.status] ?? g.account.status}</Badge>
                  )}
                  <span className="bo-sub" style={{ marginLeft: 'auto' }}>
                    {g.statements.length} {g.statements.length === 1 ? 'estado' : 'estados'}
                  </span>
                </div>
                <DataTable columns={columns} rows={rows} rowKey={(s) => s.statementId} emptyMessage="Sin estados de cuenta" />
                {g.statements.length > VISIBLE_PER_CONTRACT && (
                  <button type="button"
                    style={{ marginTop: 6, background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--bo-primary)', fontSize: 12.5 }}
                    onClick={() => setExpanded((e) => ({ ...e, [g.contractNumber]: !open }))}>
                    {open ? 'Ver sólo los últimos' : `Ver los ${g.statements.length} estados`}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {failure && <p style={{ color: 'var(--bo-bad)', fontSize: 12.5, marginTop: 8 }}>{failure}</p>}

      {viewing && (
        <div className="bo-doc open" style={{ marginTop: 12 }}>
          <div className="bo-doc-tools">
            <b style={{ flex: 1, fontSize: 13 }}>
              {viewing.statement.contractNumber} · corte {date(viewing.statement.cutoffDate)}
            </b>
            <a href={viewing.url} target="_blank" rel="noreferrer">Abrir en pestaña</a>
            <a href={viewing.url} download={statementFileName(viewing.statement)}>Descargar</a>
            <button type="button" onClick={closeViewer}>Cerrar</button>
          </div>
          <div className="bo-doc-canvas">
            <iframe src={viewing.url} title={`Estado de cuenta ${viewing.statement.contractNumber ?? ''} ${viewing.statement.cutoffDate}`}
              style={{ width: '100%', height: 620, border: 0 }} />
          </div>
        </div>
      )}
    </Collapsible>
  );
}
