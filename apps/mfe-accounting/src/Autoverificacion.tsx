import { accountingApi, type SelfCheckReport } from '@bo/api-client';
import { Badge, Button, CardTitled, EmptyState, Spinner, date, useAsync } from '@bo/design-system';
import { Lista } from './CierreConciliado';

/** The services by the name an operator knows them by. */
const SERVICIO: Record<string, string> = {
  'commission-service': 'Comisiones',
  'banking-service': 'Tesorería',
  'credit-portfolio-service': 'Cartera',
  'statement-service': 'Estados de cuenta',
};

/**
 * What each part of the system says of itself.
 *
 * Every service checks its own data against its own rules — a commission lot adds up to its records, the cash book
 * never closes a day below zero, every account's debt is the sum of its movements, every statement has its document —
 * and says so here, in the same contract as the month-end close. What must hold and does not is a defect; what only
 * informs is something to look at, such as a payout sent days ago that never had an outcome.
 */
export function Autoverificacion() {
  const state = useAsync(() => accountingApi.selfChecks(), []);
  const reports = state.data ?? [];
  const enOrden = reports.filter((r) => r.outcome === 'IN_ORDER').length;
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <CardTitled
        title="Autoverificación del sistema"
        action={
          <Button disabled={state.loading} onClick={() => state.reload()} title="Cada servicio vuelve a revisarse">
            {state.loading ? 'Revisando…' : 'Volver a revisar'}
          </Button>
        }
      >
        <div className="bo-card-pad" style={{ display: 'grid', gap: 8 }}>
          {reports.length > 0 && (
            <div>
              <Badge tone={enOrden === reports.length ? 'ok' : 'bad'}>
                {enOrden === reports.length ? 'Todo en orden' : `${reports.length - enOrden} con diferencias`}
              </Badge>
              {reports[0]?.runAt && <span className="bo-sub"> · revisado el {date(reports[0].runAt)}</span>}
            </div>
          )}
          <div className="bo-sub">
            Cada servicio se revisa a sí mismo con sus propios datos: lo que debe cumplirse detiene, lo que informa es
            para revisar. Es el mismo contrato de la conciliación del cierre de mes, que revisa la contabilidad.
          </div>
        </div>
      </CardTitled>
      {state.error ? (
        <EmptyState message={`No se pudo leer la autoverificación: ${state.error}`} />
      ) : state.loading && reports.length === 0 ? (
        <div className="bo-card-pad"><Spinner /></div>
      ) : (
        reports.map((r) => <Reporte key={r.service} r={r} />)
      )}
    </div>
  );
}

function Reporte({ r }: { r: SelfCheckReport }) {
  const nombre = SERVICIO[r.service] ?? r.service;
  const noCumple = r.checks.filter((c) => c.blocking && !c.ok);
  const paraRevisar = r.checks.filter((c) => !c.blocking && !c.ok);
  const enOrden = r.checks.filter((c) => c.ok);
  const tono = r.outcome === 'IN_ORDER' ? 'ok' : r.outcome === 'UNREACHABLE' ? 'warn' : 'bad';
  const etiqueta = r.outcome === 'IN_ORDER' ? 'En orden'
    : r.outcome === 'UNREACHABLE' ? 'Sin respuesta' : `${noCumple.length} no cumplen`;
  return (
    <CardTitled title={nombre} action={<Badge tone={tono}>{etiqueta}</Badge>}>
      <div className="bo-card-pad" style={{ display: 'grid', gap: 12 }}>
        {r.outcome === 'UNREACHABLE' ? (
          <EmptyState message={`${nombre} no contestó: ${r.error ?? 'sin detalle'}. Sin respuesta no es «en orden».`} />
        ) : (
          <>
            {noCumple.length > 0 && <Lista titulo="No cumple" checks={noCumple} tono="bad" />}
            {paraRevisar.length > 0 && <Lista titulo="Para revisar" checks={paraRevisar} tono="info" />}
            <Lista titulo="En orden" checks={enOrden} tono="ok" />
          </>
        )}
      </div>
    </CardTitled>
  );
}
