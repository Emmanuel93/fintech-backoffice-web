import {
  treasuryApi,
  type BankAccount, type Disbursement, type DisbursementEvent, type MovementTrace,
  type MovementTraceStep, type StpOrder,
} from '@bo/api-client';
import {
  useAsync, Modal, Badge, Defs, DefRow, Spinner, Timeline,
  dateTime, money, type TimelineStep,
} from '@bo/design-system';
import {
  DISPERSION_FALLIDA, DISPERSION_TERMINAL, VIA_PAGO,
  eslabonLabel, estadoDispersion, faltaLabel,
} from './lenguaje';

const mono = { fontFamily: 'var(--bo-mono)', fontSize: 12.5 } as const;

/**
 * Un SPEI de punta a punta: cuánto, a quién, por dónde, con qué clave, y si ya cerró su cadena.
 *
 * <p>Es la pantalla que se tiene abierta al hablar con el banco receptor o con quien no recibió su
 * dinero. La clave de rastreo va arriba y completa porque es lo que se dicta; el CEP, porque es la
 * prueba que se manda.
 *
 * <p>Cada bloque viene de un servicio distinto —el recorrido de disbursement, la orden de stp, la
 * traza de banking— y **cada uno puede faltar**. Si stp-service no contesta, la persona del
 * teléfono todavía puede leer en qué estado va el pago; perder la ficha entera por la orden de STP
 * convertiría una degradación en una caída. Lo que falta se dice en voz baja, sin alarma.
 */
export function DispersionModal({ fila, cuentas, onClose }: {
  fila: Disbursement;
  /** Las cuentas propias, ya cargadas en la pantalla: dicen por cuál salió si STP no contesta. */
  cuentas: BankAccount[];
  onClose: () => void;
}) {
  const state = useAsync(() => treasuryApi.disbursement(fila.disbursementId), [fila.disbursementId]);
  // La ficha es más fresca que la fila: entre listar y abrir pudo liquidarse.
  const d = state.data?.disbursement ?? fila;
  const e = estadoDispersion(d.status);
  const stp = state.data?.stpOrder ?? null;
  const cep = stp?.cepUrl ?? d.cepUrl;

  // Si STP no contestó, la cuenta ordenante se deduce de las cuentas propias del mismo proveedor.
  // Se dice que es deducida: afirmar una CLABE ordenante que nadie confirmó sería inventarla.
  const ordenante = stp?.orderingClabeMasked
    ? `${stp.orderingName ?? 'Cuenta propia'} · ${stp.orderingClabeMasked}`
    : (() => {
        const c = cuentas.find((x) => x.status === 'ACTIVE' && x.provider && x.provider === d.provider);
        return c ? `${c.bankName} · ${c.clabeMasked ?? ''} (la ordenante activa de ${c.provider})` : null;
      })();

  return (
    <Modal
      title="Dispersión SPEI"
      subtitle={`${d.beneficiaryName ?? 'Beneficiario'} · ${money(d.amount, true)}`}
      onClose={onClose}
      size="wide"
      actions={<Badge tone={e.tono}>{e.texto}</Badge>}
    >
      {d.status === 'ACCEPTED' && (
        <div className="bo-alert bo-huerfanos" style={{ marginBottom: 16 }}>
          <b>STP aceptó la orden, pero el dinero todavía no llega.</b> Aceptada no es depositada:
          sólo «Liquidada» afirma que el banco receptor abonó la cuenta, y es cuando aparece el CEP.
        </div>
      )}

      <section style={{ marginBottom: 20 }}>
        <div className="bo-grupo-cap">La dispersión</div>
        <Defs className="cols-3">
          <DefRow k="Monto" v={<b>{money(d.amount, true)} {d.currency !== 'MXN' ? d.currency : ''}</b>} />
          <DefRow k="Beneficiario" v={d.beneficiaryName ?? '—'} />
          <DefRow k="CLABE destino" v={<span style={mono}>{d.beneficiaryClabeMasked ?? '—'}</span>} />
          <DefRow
            k="Clave de rastreo"
            v={d.trackingKey
              ? <b style={mono}>{d.trackingKey}</b>
              : (
                <span className="bo-sub">
                  {DISPERSION_TERMINAL.has(String(d.status)) ? 'no registrada' : 'sin clave: todavía no sale al banco'}
                </span>
              )}
          />
          <DefRow k="Cuenta ordenante" v={ordenante ?? <span className="bo-sub">sin dato</span>} />
          <DefRow k="Proveedor" v={[d.provider, VIA_PAGO[String(d.rail)] ?? d.rail].filter(Boolean).join(' · ')} />
          <DefRow k="Solicitada" v={dateTime(d.createdAt)} />
          <DefRow k="Liquidada" v={d.settledAt ? dateTime(d.settledAt) : <span className="bo-sub">todavía no</span>} />
          <DefRow k="Disposición" v={<span className="bo-mono-sm">{d.dispositionId ?? '—'}</span>} />
        </Defs>
      </section>

      {state.loading ? <Spinner /> : state.error ? (
        <p className="bo-page-sub">No se pudo leer el detalle de la dispersión: {state.error}</p>
      ) : (
        <>
          <section style={{ marginBottom: 20 }}>
            <div className="bo-grupo-cap">Por dónde pasó</div>
            <Recorrido eventos={state.data?.timeline ?? null} />
          </section>

          <section style={{ marginBottom: 20 }}>
            <div className="bo-grupo-cap">Orden en STP</div>
            <OrdenStp orden={stp} cep={cep} />
          </section>

          <section>
            <div className="bo-grupo-cap">Rastro del dinero</div>
            <Rastro traza={state.data?.movementTrace ?? null} />
          </section>
        </>
      )}
    </Modal>
  );
}

/** Lo que falta se dice en voz baja: es una fuente que no contestó, no un error de la pantalla. */
function SinDato({ fuente }: { fuente: string }) {
  return <p className="bo-page-sub" style={{ margin: 0 }}>Sin dato de {fuente}.</p>;
}

function Recorrido({ eventos }: { eventos: DisbursementEvent[] | null }) {
  if (!eventos) return <SinDato fuente="disbursement-service" />;
  if (eventos.length === 0) return <p className="bo-page-sub" style={{ margin: 0 }}>Sin movimientos registrados.</p>;
  const pasos: TimelineStep[] = eventos.map((ev, i) => {
    const t = estadoDispersion(ev.status);
    const ultimo = i === eventos.length - 1;
    return {
      label: `${t.texto}${ev.detail ? ` — ${ev.detail}` : ''}`,
      time: ev.occurredAt ? dateTime(ev.occurredAt) : undefined,
      // El último salto es donde está hoy, salvo que sea un final: «Liquidada» no está en curso.
      tone: DISPERSION_FALLIDA.has(String(ev.status)) ? 'falla'
        : ultimo && !DISPERSION_TERMINAL.has(String(ev.status)) ? 'ahora' : 'hecho',
    };
  });
  return <Timeline steps={pasos} />;
}

function OrdenStp({ orden, cep }: { orden: StpOrder | null; cep: string | null }) {
  if (!orden) {
    return (
      <>
        <SinDato fuente="stp-service" />
        {cep && <EnlaceCep url={cep} />}
      </>
    );
  }
  const e = estadoDispersion(orden.status);
  return (
    <>
      <Defs className="cols-3">
        <DefRow k="Orden" v={<span style={mono}>{orden.stpOrderId}</span>} />
        <DefRow k="Clave de rastreo" v={<span style={mono}>{orden.trackingKey ?? '—'}</span>} />
        <DefRow k="Estatus en STP" v={<Badge tone={e.tono}>{e.texto}</Badge>} />
        <DefRow
          k="Ordenante"
          v={<span>{orden.orderingName ?? '—'}<div className="bo-sub" style={mono}>{orden.orderingClabeMasked ?? ''}</div></span>}
        />
        <DefRow
          k="Beneficiario"
          v={<span>{orden.beneficiaryName ?? '—'}<div className="bo-sub" style={mono}>{orden.beneficiaryClabeMasked ?? ''}</div></span>}
        />
        <DefRow k="Monto" v={money(orden.amount, true)} />
        <DefRow k="Liquidada" v={orden.settledAt ? dateTime(orden.settledAt) : <span className="bo-sub">todavía no</span>} />
      </Defs>
      {cep
        ? <EnlaceCep url={cep} />
        : (
          <p className="bo-sub" style={{ margin: '10px 0 0' }}>
            El CEP lo emite Banxico cuando el banco receptor abona; antes de eso no hay comprobante.
          </p>
        )}
    </>
  );
}

/**
 * El comprobante electrónico de pago. Abre en otra pestaña: es de Banxico, no de la consola, y
 * quien lo pide suele estar a media llamada con la ficha abierta.
 */
function EnlaceCep({ url }: { url: string }) {
  return (
    <div style={{ marginTop: 12 }}>
      <a className="bo-btn" href={url} target="_blank" rel="noopener noreferrer">
        Ver comprobante CEP ↗
      </a>
    </div>
  );
}

/** Un eslabón está hecho si quien proyecta la traza lo dice, o si trae fecha o referencia. */
function hecho(s: MovementTraceStep): boolean {
  if (/PENDING|MISSING|PENDIENTE|FALTA/i.test(s.status ?? '')) return false;
  return s.status != null || s.occurredAt != null || s.reference != null;
}

/**
 * La cadena del dinero: de la disposición a la póliza.
 *
 * Lo que la hace útil no es el sí, es el **no**: una traza incompleta dice exactamente en qué
 * eslabón se detuvo, y con eso a quién preguntarle —al banco, a conciliación o a contabilidad—.
 */
function Rastro({ traza }: { traza: MovementTrace | null }) {
  if (!traza) return <SinDato fuente="banking-service" />;
  return (
    <div className="bo-totales">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
        <b style={{ fontSize: 13 }}>Disposición → banco → estado de cuenta → póliza</b>
        <Badge tone={traza.complete ? 'ok' : 'warn'}>
          {traza.complete ? 'Cadena completa' : 'Cadena incompleta'}
        </Badge>
      </div>
      <div className="bo-totales-grid">
        {traza.steps.map((s, i) => {
          const ok = hecho(s);
          return (
            <div key={`${s.step}-${i}`} className="bo-totales-fila">
              <span>
                <b style={{ color: ok ? 'var(--bo-ok)' : 'var(--bo-warn)', marginRight: 6 }}>{ok ? '✓' : '○'}</b>
                {eslabonLabel(s.step)}
                {s.reference && <span className="bo-sub" style={mono}> · {s.reference}</span>}
              </span>
              <span className="bo-sub">{ok ? (s.occurredAt ? dateTime(s.occurredAt) : 'hecho') : 'pendiente'}</span>
            </div>
          );
        })}
      </div>
      {!traza.complete && traza.missingLink && (
        <p style={{ margin: '10px 0 0', fontSize: 13, color: 'var(--bo-warn)' }}>
          <b>Falta:</b> {faltaLabel(traza.missingLink)}.
        </p>
      )}
    </div>
  );
}
