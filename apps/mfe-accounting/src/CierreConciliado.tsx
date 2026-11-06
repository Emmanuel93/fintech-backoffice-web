import { accountingApi, type CloseCheck } from '@bo/api-client';
import { Badge, Button, CardTitled, EmptyState, Spinner, date, money, useAsync } from '@bo/design-system';
import { periodoLabel } from './lenguaje';

/**
 * The month-end close's reconciliation, on the trial balance it publishes.
 *
 * Every fact is booked as it happens; at the end of the month the close checks the subledgers are complete (the
 * portfolio closed the last day, risk measured the reserve at that date) and that the ledger equals them account by
 * account, and only then publishes the month. While the month is open this is a dry run: it books nothing and says
 * what would keep the close from going through. A month whose last day has not come is checked to date: what is measured
 * on the last day (the reserve, the funding's interest) shows as pending, not as a difference. A closed month shows the
 * reconciliation its close ran.
 */
export function CierreConciliado({ periodo, version }: { periodo: string; version: number }) {
  const state = useAsync(() => accountingApi.reconciliation(periodo), [periodo, version]);
  const r = state.data;

  const bloquean = r?.checks.filter((c) => c.blocking && !c.ok && !c.pending) ?? [];
  const pendientes = r?.checks.filter((c) => c.pending) ?? [];
  const informan = r?.checks.filter((c) => !c.blocking && !c.pending) ?? [];
  const enOrden = r?.checks.filter((c) => c.blocking && c.ok) ?? [];

  const titulo = r?.closedAt
    ? `Conciliación del cierre de ${periodoLabel(periodo)}`
    : `Conciliación para cerrar ${periodoLabel(periodo)}`;

  return (
    <CardTitled
      title={titulo}
      action={
        <Button disabled={state.loading} onClick={() => state.reload()}
          title="Vuelve a correr la conciliación en seco: no asienta nada">
          {state.loading ? 'Conciliando…' : 'Volver a conciliar'}
        </Button>
      }
    >
      {state.error ? (
        <EmptyState message={`No se pudo conciliar el período: ${state.error}`} />
      ) : !r ? (
        <div className="bo-card-pad"><Spinner /></div>
      ) : (
        <div className="bo-card-pad" style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Badge tone={r.outcome === 'RECONCILED' ? 'ok' : r.outcome === 'IN_PROGRESS' ? 'info' : 'bad'}>
              {r.outcome === 'RECONCILED' ? 'Concilia'
                : r.outcome === 'IN_PROGRESS' ? 'En curso: en orden a la fecha'
                  : `${bloquean.length} sin conciliar`}
            </Badge>
            <span className="bo-sub">
              {r.closedAt
                ? `Cerrado el ${date(r.closedAt)} con ${r.checks.length} comprobaciones.`
                : r.outcome === 'RECONCILED'
                  ? 'El mes se puede cerrar: al cerrar se devengan las comisiones del mes y se publica esta balanza.'
                  : r.outcome === 'IN_PROGRESS'
                    ? `El mes sigue abierto: lo que se puede comprobar hoy está en orden y ${pendientes.length === 1
                      ? 'una comprobación se mide' : `${pendientes.length} comprobaciones se miden`} al cerrar el mes.`
                    : 'El mes no se puede cerrar todavía: corrige lo que no concilia y vuelve a conciliar.'}
            </span>
          </div>

          {bloquean.length > 0 && <Lista titulo="No concilia" checks={bloquean} tono="bad" />}
          {pendientes.length > 0 && <Lista titulo="Se miden al cierre del mes" checks={pendientes} tono="info" />}
          <Lista titulo="En orden" checks={enOrden} tono="ok" />
          {informan.length > 0 && <Lista titulo="Para tu información" checks={informan} tono="info" />}
        </div>
      )}
    </CardTitled>
  );
}

export function Lista({ titulo, checks, tono }: { titulo: string; checks: CloseCheck[]; tono: 'ok' | 'bad' | 'info' }) {
  const marca = tono === 'ok' ? '✓' : tono === 'bad' ? '✗' : 'i';
  const color = tono === 'ok' ? 'var(--bo-ok)' : tono === 'bad' ? 'var(--bo-bad)' : 'var(--bo-info)';
  return (
    <div>
      <div className="bo-sub" style={{ fontWeight: 650, marginBottom: 4 }}>{titulo}</div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
        {checks.map((c) => (
          <li key={c.code} style={{ display: 'grid', gridTemplateColumns: '20px 1fr auto', gap: 8, alignItems: 'baseline' }}>
            <span aria-hidden style={{ color, fontWeight: 750 }}>{marca}</span>
            <span>
              <b>{c.title}</b>
              <div className="bo-sub">{c.detail}</div>
            </span>
            {tono === 'bad' && c.amount != null && c.amount > 0 && (
              <span style={{ fontVariantNumeric: 'tabular-nums', color }}>{money(c.amount, true)}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
