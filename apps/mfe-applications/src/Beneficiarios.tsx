import { useMemo, useState } from 'react';
import {
  beneficiariesApi,
  type BeneficiaryCaptured, type BeneficiaryConsent, type IdentityEvidence, type IdentityStatus,
  type Placement, type PlacementStatus, type PlacementStep,
} from '@bo/api-client';
import {
  useAsync, Badge, Block, Button, CardTitled, Chip, DataTable, DefRow, Defs, Field, Footnote, Modal,
  Select, StatCard, Stats, TextArea, Timeline, Toolbar, Spinner,
  count, date, dateTime, money, type Column, type Tone, type TimelineStep,
} from '@bo/design-system';
import { Can } from '@bo/auth';
import { VisorDocumentos } from './Expediente';

/**
 * El estado del proceso, dicho como lo que pasó y no como lo que dice la base.
 *
 * El dominio nombra `BUREAU_READY` y `DISBURSING`; para quien vigila la bandeja lo que importa es
 * en qué paso está y de quién depende que avance. Eso es lo que se traduce aquí.
 */
const ESTADO: Record<PlacementStatus, { texto: string; tono: Tone; quien: string }> = {
  INVITED:         { texto: 'Liga enviada',        tono: 'muted', quien: 'espera a la beneficiaria' },
  KYC_IN_PROGRESS: { texto: 'Verificando identidad', tono: 'info', quien: 'la beneficiaria está en ello' },
  KYC_COMPLETED:   { texto: 'Identidad completa',  tono: 'info',  quien: 'espera consulta de historial' },
  BUREAU_READY:    { texto: 'Historial listo',     tono: 'warn',  quien: 'espera decisión de la distribuidora' },
  APPROVED:        { texto: 'Aprobada',            tono: 'ok',    quien: 'la distribuidora asumió el riesgo' },
  DISBURSING:      { texto: 'Depositando',         tono: 'info',  quien: 'SPEI en camino' },
  DISBURSED:       { texto: 'Depositada',          tono: 'ok',    quien: 'el dinero llegó' },
  PAID_OFF:        { texto: 'Liquidada',           tono: 'muted', quien: 'terminó de pagar' },
  REJECTED:        { texto: 'No colocada',         tono: 'muted', quien: 'la distribuidora decidió no colocar' },
  EXPIRED:         { texto: 'Liga vencida',        tono: 'warn',  quien: 'pasaron los 7 días' },
  CANCELLED:       { texto: 'Cancelada',           tono: 'muted', quien: 'la distribuidora revocó la liga' },
  FAILED:          { texto: 'Falló',               tono: 'bad',   quien: 'siempre con motivo' },
};

const IDENTIDAD: Record<IdentityStatus, { texto: string; tono: Tone }> = {
  PENDING:      { texto: 'Sin empezar', tono: 'muted' },
  IN_PROGRESS:  { texto: 'En proceso',  tono: 'warn' },
  VERIFIED:     { texto: 'Comprobada',  tono: 'ok' },
  NOT_VERIFIED: { texto: 'Sin comprobar', tono: 'bad' },
};

/** Los estados que todavía se pueden mover. El resto son terminales y no son cola de trabajo. */
const VIVOS: PlacementStatus[] = [
  'INVITED', 'KYC_IN_PROGRESS', 'KYC_COMPLETED', 'BUREAU_READY', 'APPROVED', 'DISBURSING',
];

function estado(s: PlacementStatus) {
  return ESTADO[s] ?? { texto: s, tono: 'muted' as Tone, quien: '' };
}

/**
 * Colocaciones a beneficiarios · KYC.
 *
 * <p>Desde aquí no se coloca ni se deposita nada —colocar lo decide la distribuidora desde su app,
 * y el depósito lo resuelve credit-portfolio—. Lo que se hace aquí son dos cosas: ver dónde se
 * atoró una colocación y por qué, que es la pregunta que llega por teléfono cuando una beneficiaria
 * no recibió su dinero; y **dictaminar su identidad**, que es lo único de la colocación que firma
 * la financiera.
 *
 * <p>La regla que ordena la pantalla: <b>validamos identidad, no riesgo</b>. El score que ve la
 * distribuidora es informativo y no bloquea; lo único que detiene el depósito es una identidad sin
 * comprobar. Por eso la identidad tiene columna propia y no se mezcla con el estado del proceso.
 */
export function Beneficiarios() {
  const [status, setStatus] = useState<PlacementStatus | ''>('');
  const [identidad, setIdentidad] = useState<IdentityStatus | ''>('');
  const [atoradas, setAtoradas] = useState(false);
  const [abierta, setAbierta] = useState<Placement | null>(null);

  const state = useAsync(() => beneficiariesApi.list({
    status: status ? [status] : undefined,
    identityStatus: identidad ? [identidad] : undefined,
    stalledDays: atoradas ? 2 : undefined,
    size: 100,
  }), [status, identidad, atoradas]);

  const filas = state.data?.content ?? [];

  const resumen = useMemo(() => {
    const vivas = filas.filter((p) => VIVOS.includes(p.status));
    return {
      porVerificar: filas.filter((p) => p.identityStatus === 'PENDING' || p.identityStatus === 'IN_PROGRESS').length,
      // Lo único que detiene el depósito. Es la cifra accionable de la pantalla.
      sinIdentidad: filas.filter((p) => p.identityStatus === 'NOT_VERIFIED').length,
      verificadas: filas.filter((p) => p.identityStatus === 'VERIFIED').length,
      atoradas: vivas.filter((p) => p.staleDays >= 2).length,
    };
  }, [filas]);

  const columns: Array<Column<Placement>> = [
    {
      key: 'quien', header: 'Beneficiaria',
      render: (p) => (
        <div>
          <b>{p.beneficiaryName ?? 'Sin nombre todavía'}</b>
          {/* El teléfono llega enmascarado del servicio: es dato de alguien que no es cliente de
              la casa, y la consola no debe poder recomponerlo. */}
          <div className="bo-sub bo-mono-sm">{p.beneficiaryPhoneMask ?? '—'}</div>
        </div>
      ),
    },
    {
      key: 'distribuidora', header: 'Distribuidora',
      render: (p) => (
        <div>
          <span style={{ fontSize: 12.5 }}>{p.distributorName ?? '—'}</span>
          <div className="bo-sub">asume el riesgo de esta colocación</div>
        </div>
      ),
    },
    { key: 'monto', header: 'Monto', align: 'right', render: (p) => money(p.amount) },
    {
      key: 'plazo', header: 'Plazo', align: 'right',
      render: (p) => (p.termFortnights ? `${p.termFortnights} qnas.` : '—'),
    },
    {
      key: 'estado', header: 'En qué paso va',
      render: (p) => {
        const e = estado(p.status);
        return (
          <div>
            <Badge tone={e.tono}>{e.texto}</Badge>
            <div className="bo-sub">{p.statusReason ?? e.quien}</div>
          </div>
        );
      },
    },
    {
      key: 'identidad', header: 'Identidad',
      render: (p) => {
        const i = IDENTIDAD[p.identityStatus] ?? { texto: p.identityStatus, tono: 'muted' as Tone };
        return (
          <div>
            <Badge tone={i.tono}>{i.texto}</Badge>
            {!p.disbursementAllowed && <div className="bo-sub">no habilita el depósito</div>}
          </div>
        );
      },
    },
    {
      key: 'quieto', header: 'Sin moverse', align: 'right',
      render: (p) => {
        if (!VIVOS.includes(p.status)) return <span className="bo-sub">—</span>;
        return p.staleDays >= 2
          ? <b style={{ color: 'var(--bo-warn)' }}>{count(p.staleDays)} d</b>
          : <span className="bo-sub">{count(p.staleDays)} d</span>;
      },
    },
  ];

  return (
    <>
      <Stats>
        <StatCard label="Identidad por comprobar" value={count(resumen.porVerificar)}
                  tone={resumen.porVerificar > 0 ? 'warn' : undefined}
                  sub="en verificación o sin empezar" />
        <StatCard label="Identidad sin comprobar" value={count(resumen.sinIdentidad)}
                  tone={resumen.sinIdentidad > 0 ? 'bad' : undefined}
                  sub="es lo único que detiene el depósito" />
        <StatCard label="Comprobadas" value={count(resumen.verificadas)}
                  tone={resumen.verificadas > 0 ? 'ok' : undefined}
                  sub="habilitan el depósito" />
        <StatCard label="Atoradas 2+ días" value={count(resumen.atoradas)}
                  tone={resumen.atoradas > 0 ? 'warn' : undefined}
                  sub="vivas y sin avanzar" />
      </Stats>

      {/* Sin Incode conectado nadie más comprueba la identidad: terminar la liga deja el
          expediente listo para revisión, no revisado. Decirlo arriba es lo que evita leer
          «Identidad completa» como «ya la validó alguien». */}
      <div className="bo-alert bo-huerfanos">
        <b>La identidad la comprueba una persona de esta mesa.</b> El proveedor biométrico no está
        conectado: la beneficiaria sube su INE y una selfie desde la liga, y aquí se comparan contra
        lo que capturó. Abre la colocación para ver su expediente y firmar <b>Identidad comprobada</b>
        o <b>No es ella</b>. Hasta que alguien lo haga, el depósito no sale.
      </div>

      <Toolbar>
        <Field label="En qué paso va">
          <Select
            value={status}
            onChange={(v) => setStatus(v as PlacementStatus | '')}
            placeholder="Todos los pasos"
            ariaLabel="Paso del proceso"
            options={(Object.keys(ESTADO) as PlacementStatus[])
              .map((s) => ({ value: s, label: ESTADO[s].texto }))}
          />
        </Field>
        <Field label="Identidad">
          <Select
            value={identidad}
            onChange={(v) => setIdentidad(v as IdentityStatus | '')}
            placeholder="Cualquier estado"
            ariaLabel="Estado de la identidad"
            options={(Object.keys(IDENTIDAD) as IdentityStatus[])
              .map((s) => ({ value: s, label: IDENTIDAD[s].texto }))}
          />
        </Field>
        <Button
          selected={atoradas}
          onClick={() => setAtoradas((v) => !v)}
          title="Las que llevan dos días o más sin avanzar"
        >
          Sólo las atoradas
        </Button>
      </Toolbar>

      <CardTitled
        title={`Colocaciones${state.data ? ` · ${count(state.data.totalElements)}` : ''}`}
        action={<span className="bo-page-sub">Abre una para ver por dónde pasó y dónde se detuvo</span>}
      >
        <Block state={state} emptyLabel="Todavía no hay colocaciones a beneficiarios.">
          {() => (
            <DataTable
              columns={columns}
              rows={filas}
              rowKey={(p) => p.placementId}
              onRowClick={setAbierta}
              emptyMessage="Ninguna colocación con esos filtros."
            />
          )}
        </Block>
      </CardTitled>

      <Footnote>
        Esta pantalla es de <b>KYC</b>, no del embudo de crédito: el embudo completo —captura,
        scoring, decisión, oferta, contrato y desembolso— vive en <b>Solicitudes de crédito</b>.
        Validamos <b>identidad, no riesgo</b>: el historial que ve la distribuidora es informativo y
        no bloquea la colocación — quien decide colocar es ella, y firma que asume el riesgo. Lo
        único que detiene el depósito es una identidad sin comprobar. El crédito fluye a la
        beneficiaria y <b>la deuda queda con la distribuidora</b>, así que estas colocaciones suman
        en su línea, no en una cartera propia de la beneficiaria. Lo único que se firma aquí es la
        identidad; aprobar y depositar ocurren en la app de la distribuidora y en credit-portfolio.
      </Footnote>

      {abierta && (
        <PlacementModal
          key={abierta.placementId}
          placement={abierta}
          onClose={() => setAbierta(null)}
          onChanged={() => { setAbierta(null); state.reload(); }}
        />
      )}
    </>
  );
}

/**
 * Por dónde pasó una colocación, dónde se detuvo, y con qué se dictamina su identidad.
 *
 * El recorrido es la respuesta a la pregunta que trae a alguien a esta pantalla —«¿por qué no le ha
 * llegado su dinero?»— y se contesta leyendo en qué salto se paró y quién lo provocó. Cuando la
 * respuesta es «nadie ha comprobado su identidad», el expediente y la firma están aquí mismo.
 */
function PlacementModal({ placement: fila, onClose, onChanged }: {
  placement: Placement;
  onClose: () => void;
  onChanged: () => void;
}) {
  const state = useAsync(() => beneficiariesApi.detail(fila.placementId), [fila.placementId]);
  // La ficha es más fresca que la fila: entre listar y abrir pudo terminar la liga.
  const placement = state.data?.placement ?? fila;
  const e = estado(placement.status);
  const i = IDENTIDAD[placement.identityStatus] ?? { texto: placement.identityStatus, tono: 'muted' as Tone };
  const evidencia = state.data?.identityEvidence ?? null;

  const [motivo, setMotivo] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setFailure(null);
    try { await fn(); onChanged(); }
    catch (err) { setFailure(err instanceof Error ? err.message : 'No se pudo registrar el dictamen'); }
    finally { setBusy(false); }
  };

  // Se dictamina sobre el veredicto explícito, no sobre el derivado: `identityStatus` dice
  // «en proceso» tanto si falta la selfie como si está todo y nadie lo ha mirado. Sin
  // `identityDecision` —BFF anterior— se cae al derivado, que es lo más cercano.
  const sinDictamen = placement.identityDecision
    ? placement.identityDecision === 'PENDING'
    : placement.identityStatus === 'PENDING' || placement.identityStatus === 'IN_PROGRESS';
  const hayExpediente = !!evidencia?.available && (evidencia.documents ?? []).length > 0;

  const pasos: TimelineStep[] = (state.data?.timeline ?? []).map((s: PlacementStep, idx, todos) => ({
    label: `${estado(s.toStatus).texto}${s.reason ? ` — ${s.reason}` : ''}`,
    time: `${dateTime(s.occurredAt)} · ${actorLabel(s.actor)}`,
    // El último salto es donde está hoy; los fallos se marcan aunque no sean el último.
    tone: s.toStatus === 'FAILED' ? 'falla' : idx === todos.length - 1 ? 'ahora' : 'hecho',
  }));

  return (
    <Modal
      title={placement.beneficiaryName ?? 'Colocación'}
      subtitle={`${placement.distributorName ?? fila.distributorName ?? 'Distribuidora'} · ${money(placement.amount)}${placement.termFortnights ? ` a ${placement.termFortnights} quincenas` : ''}`}
      onClose={onClose}
      size="wide"
      actions={<Badge tone={e.tono}>{e.texto}</Badge>}
    >
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
        <Chip tone={i.tono}>Identidad: {i.texto}</Chip>
        <Chip tone={placement.disbursementAllowed ? 'ok' : 'bad'}>
          {placement.disbursementAllowed ? 'Puede depositarse' : 'Depósito detenido'}
        </Chip>
        {placement.statusReason && <Chip tone="bad">{placement.statusReason}</Chip>}
      </div>

      <section style={{ marginBottom: 20 }}>
        <div className="bo-grupo-cap">La colocación</div>
        <div className="bo-defs cols-3">
          <div><div className="bo-def-k">Monto</div><div className="bo-def-v">{money(placement.amount)}</div></div>
          <div><div className="bo-def-k">Plazo</div><div className="bo-def-v">{placement.termFortnights ? `${placement.termFortnights} quincenas` : '—'}</div></div>
          <div><div className="bo-def-k">Teléfono</div><div className="bo-def-v bo-mono-sm">{placement.beneficiaryPhoneMask ?? '—'}</div></div>
          <div><div className="bo-def-k">Invitada</div><div className="bo-def-v">{dateTime(placement.createdAt)}</div></div>
          <div><div className="bo-def-k">Último movimiento</div><div className="bo-def-v">{dateTime(placement.updatedAt)}</div></div>
          <div><div className="bo-def-k">Sin moverse</div><div className="bo-def-v">{count(placement.staleDays)} días</div></div>
        </div>
      </section>

      <section style={{ marginBottom: 20 }}>
        <div className="bo-grupo-cap">Su expediente de identidad</div>
        {state.loading ? <Spinner /> : state.error ? (
          <p className="bo-page-sub">No se pudo leer el expediente: {state.error}</p>
        ) : (
          <Evidencia placementId={placement.placementId} evidencia={evidencia} />
        )}
      </section>

      {placement.identityDecidedBy && (
        <section style={{ marginBottom: 20 }}>
          <div className="bo-grupo-cap">Dictamen</div>
          <Defs className="cols-3">
            <DefRow k="Firmó" v={placement.identityDecidedBy} />
            <DefRow k="Cuándo" v={dateTime(placement.identityDecidedAt ?? null)} />
            <DefRow k="Origen" v={placement.identityVerificationSource === 'MANUAL' || !placement.identityVerificationSource
              ? 'Revisión manual' : placement.identityVerificationSource} />
          </Defs>
          {placement.identityRejectionReason && (
            <p style={{ fontSize: 13, color: 'var(--bo-bad)', margin: '8px 0 0' }}>
              Motivo: {placement.identityRejectionReason}
            </p>
          )}
        </section>
      )}

      {!state.loading && sinDictamen && hayExpediente && (
        <Can
          capability="beneficiaries.review-identity"
          fallback={<p className="bo-page-sub">Tu rol puede ver este expediente, pero no dictaminar la identidad.</p>}
        >
          <section style={{ ...cajaStyle, marginBottom: 20 }}>
            <h4 style={{ margin: '0 0 6px', fontSize: 13, fontWeight: 600 }}>¿Es ella?</h4>
            <p className="bo-page-sub" style={{ margin: '0 0 10px' }}>
              Compara la foto de la INE con la selfie, y el nombre, la CURP y la fecha de nacimiento
              de la credencial contra lo que capturó. Tu firma es lo único que habilita el depósito.
            </p>
            <Field label="Motivo" hint="Obligatorio si no es ella: queda en el expediente y es lo que se le explica a la distribuidora.">
              <TextArea value={motivo} onChange={setMotivo} rows={2} placeholder="Qué no coincide" />
            </Field>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
              <Button
                variant="primary"
                disabled={busy}
                onClick={() => run(() => beneficiariesApi.reviewIdentity(placement.placementId, 'VERIFIED'))}
              >
                Identidad comprobada
              </Button>
              <Button
                variant="danger"
                disabled={busy || !motivo.trim()}
                title={!motivo.trim() ? 'Escribe qué no coincide para poder rechazar' : undefined}
                onClick={() => run(() => beneficiariesApi.reviewIdentity(placement.placementId, 'REJECTED', motivo.trim()))}
              >
                No es ella
              </Button>
            </div>
            {failure && <p style={{ fontSize: 13, color: 'var(--bo-bad)', margin: '10px 0 0' }}>{failure}</p>}
          </section>
        </Can>
      )}

      <section>
        <div className="bo-grupo-cap">Por dónde pasó</div>
        {state.loading ? <Spinner /> : state.error ? (
          <p className="bo-page-sub">No se pudo leer el recorrido: {state.error}</p>
        ) : pasos.length === 0 ? (
          <p className="bo-page-sub">Sin movimientos registrados.</p>
        ) : (
          <Timeline steps={pasos} />
        )}
      </section>
    </Modal>
  );
}

/**
 * Lo que ella entregó en la liga: INE, selfie, sus datos y lo que firmó.
 *
 * Cada parte se degrada sola. Una beneficiaria que se quedó en la selfie tiene documentos y no
 * datos, y eso se dice así en vez de esconder la sección entera.
 */
function Evidencia({ placementId, evidencia }: { placementId: string; evidencia: IdentityEvidence | null }) {
  if (!evidencia) {
    return <p className="bo-page-sub">El servicio no publicó evidencia de identidad para esta colocación.</p>;
  }
  if (!evidencia.available) {
    return (
      <p className="bo-page-sub">
        Todavía no hay expediente que revisar{evidencia.reason ? `: ${evidencia.reason}` : '.'}
      </p>
    );
  }
  const docs = evidencia.documents ?? [];
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {docs.length === 0 ? (
        <p className="bo-page-sub">No subió documentos.</p>
      ) : (
        <VisorDocumentos
          docs={docs.map((d) => ({ ...d, key: d.documentType }))}
          abrir={(tipo) => beneficiariesApi.documentUrl(placementId, tipo)}
        />
      )}
      <div>
        <h5 style={h5Style}>Lo que capturó</h5>
        {evidencia.captured ? <Capturado c={evidencia.captured} /> : (
          <p className="bo-page-sub">Todavía no confirma sus datos.</p>
        )}
      </div>
      <div>
        <h5 style={h5Style}>Lo que firmó</h5>
        <Consentimientos consents={evidencia.consents ?? []} />
      </div>
    </div>
  );
}

function Capturado({ c }: { c: BeneficiaryCaptured }) {
  const domicilio = [
    [c.street, c.exteriorNumber].filter(Boolean).join(' '),
    c.neighborhood, c.municipality, c.city, c.state, c.postalCode && `CP ${c.postalCode}`,
  ].filter(Boolean).join(', ');
  return (
    <Defs className="cols-3">
      <DefRow k="Nombre(s)" v={c.firstName ?? '—'} />
      <DefRow k="Primer apellido" v={c.lastName1 ?? '—'} />
      <DefRow k="Segundo apellido" v={c.lastName2 ?? '—'} />
      <DefRow k="CURP" v={<code>{c.curp ?? '—'}</code>} />
      <DefRow k="RFC" v={<code>{c.rfc ?? '—'}</code>} />
      <DefRow k="Nacimiento" v={date(c.dateOfBirth)} />
      <DefRow k="Ocupación" v={c.occupation ?? '—'} />
      <DefRow k="Ingreso mensual" v={c.monthlyIncome != null ? money(c.monthlyIncome) : '—'} />
      <DefRow k="CLABE del depósito" v={<code>{c.clabeMasked ?? '—'}</code>} />
      <DefRow k="Domicilio" v={domicilio || '—'} />
    </Defs>
  );
}

const CONSENTIMIENTO: Record<string, string> = {
  PRIVACY_NOTICE: 'Aviso de privacidad',
  BUREAU_AUTHORIZATION: 'Consulta a buró y círculo de crédito',
  CREDIT_OWNERSHIP: 'Entiende que el crédito es suyo',
};

function Consentimientos({ consents }: { consents: BeneficiaryConsent[] }) {
  if (consents.length === 0) return <p className="bo-page-sub">Todavía no firma su autorización.</p>;
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {consents.map((c) => (
        <div key={c.consentType} style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap', fontSize: 13 }}>
          <Badge tone="ok">Aceptado</Badge>
          <b>{CONSENTIMIENTO[c.consentType] ?? c.consentType}</b>
          {/* La versión y la IP son lo que convierte una casilla marcada en evidencia: qué texto
              aceptó y desde dónde. */}
          <span className="bo-sub" style={{ marginTop: 0 }}>
            {dateTime(c.acceptedAt)} · texto {c.textVersion ?? '—'} · IP {c.ipAddress ?? '—'}
          </span>
        </div>
      ))}
    </div>
  );
}

const cajaStyle = { padding: 14, borderRadius: 'var(--bo-radius)', border: '1px solid var(--bo-border)' } as const;
const h5Style = { margin: '0 0 6px', fontSize: 12, color: 'var(--bo-text-muted)' } as const;

function actorLabel(a: string): string {
  const map: Record<string, string> = {
    DISTRIBUTOR: 'lo hizo la distribuidora',
    BENEFICIARY: 'lo hizo la beneficiaria',
    SYSTEM: 'automático',
  };
  return map[a] ?? a.toLowerCase();
}
