import { useEffect, useMemo, useState } from 'react';
import {
  complianceApi,
  type ComplianceIdentityStatus, type ScreeningCheck, type ScreeningStatus,
  type VerificationDetail, type VerificationRow,
} from '@bo/api-client';
import {
  useAsync, Badge, Block, Button, CardTitled, Chip, DataTable, DefRow, Defs, Field, Footnote,
  Modal, SearchInput, Select, StatCard, Stats, TextArea, Toolbar,
  count, date, dateTime, type Column, type Tone,
} from '@bo/design-system';
import { Can, useCapabilities } from '@bo/auth';
import { VisorDocumentos } from './Expediente';

const IDENTIDAD: Record<ComplianceIdentityStatus, { texto: string; tono: Tone }> = {
  PENDING:   { texto: 'Sin evidencia',   tono: 'muted' },
  IN_REVIEW: { texto: 'Por dictaminar',  tono: 'warn' },
  VERIFIED:  { texto: 'Comprobada',      tono: 'ok' },
  REJECTED:  { texto: 'Rechazada',       tono: 'bad' },
};

const LISTAS: Record<ScreeningStatus, { texto: string; tono: Tone }> = {
  PENDING:         { texto: 'Sin cotejar',            tono: 'muted' },
  CLEARED:         { texto: 'Sin coincidencias',      tono: 'ok' },
  POTENTIAL_MATCH: { texto: 'Posible coincidencia',   tono: 'warn' },
  CONFIRMED_MATCH: { texto: 'Coincidencia confirmada', tono: 'bad' },
};

const identidad = (s: string) =>
  IDENTIDAD[s as ComplianceIdentityStatus] ?? { texto: s, tono: 'muted' as Tone };
const listas = (s: string) =>
  LISTAS[s as ScreeningStatus] ?? { texto: s, tono: 'muted' as Tone };

/** Dónde todavía cabe un dictamen de identidad. Lo demás ya lo firmó alguien. */
export function identidadAbierta(r: VerificationRow): boolean {
  return r.identityStatus === 'PENDING' || r.identityStatus === 'IN_REVIEW';
}

/**
 * Dónde cabe resolver las listas. `PENDING` entra porque, sin cotejo automático corriendo, quien
 * revisa a la persona es también quien deja constancia de que no aparece.
 */
export function listasAbiertas(r: VerificationRow): boolean {
  return r.screeningStatus === 'POTENTIAL_MATCH' || r.screeningStatus === 'PENDING';
}

/** Cuántas filas se leen para las cifras de arriba. Ver `resumen` sobre por qué no es todo. */
const MUESTRA = 200;

/**
 * Mesa de cumplimiento: identidad y listas de cada persona, sea del producto que sea.
 *
 * Es la cola de trabajo que antes no existía. Sin proveedor biométrico, la identidad de quien pide
 * crédito se quedaba en `IN_REVIEW` hasta que alguien la mirara, y no había dónde mirarla: el
 * expediente de solicitudes dictamina documentos para redactar una petición, no firma que la
 * persona es quien dice ser. Esta pantalla es esa firma.
 *
 * La bandeja abre filtrada a **por dictaminar** porque es para lo que se entra. Las cifras de
 * arriba no siguen el filtro: si lo hicieran, con «por dictaminar» aplicado dirían siempre que no
 * hay ninguna comprobada, que es verdad del recorte y mentira de la mesa.
 */
export function Cumplimiento() {
  const [estadoIdentidad, setEstadoIdentidad] = useState<ComplianceIdentityStatus | ''>('IN_REVIEW');
  const [estadoListas, setEstadoListas] = useState<ScreeningStatus | ''>('');
  const [texto, setTexto] = useState('');
  const [q, setQ] = useState('');
  const [abierta, setAbierta] = useState<string | null>(null);

  // La búsqueda va al servidor; mandarla por tecla sería una petición por letra de un nombre.
  useEffect(() => {
    const t = setTimeout(() => setQ(texto.trim()), 350);
    return () => clearTimeout(t);
  }, [texto]);

  const state = useAsync(() => complianceApi.list({
    identityStatus: estadoIdentidad ? [estadoIdentidad] : undefined,
    screeningStatus: estadoListas ? [estadoListas] : undefined,
    q: q || undefined,
    size: 50,
  }), [estadoIdentidad, estadoListas, q]);

  // Las cifras salen de una lectura aparte, sin filtros. Se acota a las más recientes porque el
  // BFF no publica todavía un agregado de la mesa; cuando la muestra no alcanza, se dice.
  const universo = useAsync(() => complianceApi.list({ size: MUESTRA }), []);

  const resumen = useMemo(() => {
    const filas = universo.data?.content ?? [];
    return {
      porDictaminar: filas.filter((r) => r.identityStatus === 'IN_REVIEW').length,
      posibles: filas.filter((r) => r.screeningStatus === 'POTENTIAL_MATCH').length,
      pueden: filas.filter((r) => r.allowsToProceed).length,
      bloqueadas: filas.filter((r) => !r.allowsToProceed).length,
      parcial: (universo.data?.totalElements ?? 0) > filas.length,
    };
  }, [universo.data]);

  const recargar = () => { state.reload(); universo.reload(); };
  const muestra = resumen.parcial ? `en las ${MUESTRA} más recientes` : undefined;

  const columns: Array<Column<VerificationRow>> = [
    {
      key: 'persona', header: 'Persona',
      render: (r) => (
        <div>
          <b>{r.fullName ?? 'Sin nombre capturado'}</b>
          <div className="bo-sub bo-mono-sm">{r.rfc ?? '—'}</div>
        </div>
      ),
    },
    { key: 'curp', header: 'CURP', render: (r) => <code>{r.curp ?? '—'}</code> },
    {
      key: 'identidad', header: 'Identidad',
      render: (r) => { const i = identidad(r.identityStatus); return <Chip tone={i.tono}>{i.texto}</Chip>; },
    },
    {
      key: 'listas', header: 'Listas',
      render: (r) => { const l = listas(r.screeningStatus); return <Chip tone={l.tono}>{l.texto}</Chip>; },
    },
    { key: 'desde', header: 'Desde', render: (r) => dateTime(r.createdAt) },
    {
      key: 'opera', header: 'Puede operar',
      render: (r) => (
        <div>
          <Badge tone={r.allowsToProceed ? 'ok' : 'bad'}>{r.allowsToProceed ? 'Sí' : 'No'}</Badge>
          {!r.allowsToProceed && r.blockReason && <div className="bo-sub">{r.blockReason}</div>}
        </div>
      ),
    },
  ];

  return (
    <>
      <Stats>
        <StatCard label="Identidad por dictaminar" value={count(resumen.porDictaminar)}
                  tone={resumen.porDictaminar > 0 ? 'warn' : undefined}
                  sub={muestra ?? 'esperan a que alguien compare INE y selfie'} />
        <StatCard label="Posibles coincidencias en listas" value={count(resumen.posibles)}
                  tone={resumen.posibles > 0 ? 'warn' : undefined}
                  sub={muestra ?? 'casi siempre homónimos; hay que resolverlas'} />
        <StatCard label="Pueden operar" value={count(resumen.pueden)}
                  tone={resumen.pueden > 0 ? 'ok' : undefined}
                  sub={muestra ?? 'identidad comprobada y listas despejadas'} />
        <StatCard label="Bloqueadas" value={count(resumen.bloqueadas)}
                  tone={resumen.bloqueadas > 0 ? 'bad' : undefined}
                  sub={muestra ?? 'no avanzan en ningún producto'} />
      </Stats>

      <Toolbar>
        <Field label="Identidad">
          <Select
            value={estadoIdentidad}
            onChange={(v) => setEstadoIdentidad(v as ComplianceIdentityStatus | '')}
            placeholder="Cualquier estado"
            ariaLabel="Estado de la identidad"
            options={(Object.keys(IDENTIDAD) as ComplianceIdentityStatus[])
              .map((s) => ({ value: s, label: IDENTIDAD[s].texto }))}
          />
        </Field>
        <Field label="Listas">
          <Select
            value={estadoListas}
            onChange={(v) => setEstadoListas(v as ScreeningStatus | '')}
            placeholder="Cualquier resultado"
            ariaLabel="Resultado en listas"
            options={(Object.keys(LISTAS) as ScreeningStatus[])
              .map((s) => ({ value: s, label: LISTAS[s].texto }))}
          />
        </Field>
        <SearchInput
          value={texto}
          onChange={setTexto}
          onClear={() => setTexto('')}
          placeholder="Nombre, CURP o RFC…"
          ariaLabel="Buscar persona"
        />
      </Toolbar>

      <CardTitled
        title={`Personas${state.data ? ` · ${count(state.data.totalElements)}` : ''}`}
        action={<span className="bo-page-sub">Abre una para comparar su INE contra su selfie y dictaminar</span>}
      >
        <Block state={state} emptyLabel="No hay verificaciones todavía.">
          {(pagina) => (
            <DataTable
              columns={columns}
              rows={pagina.content}
              rowKey={(r) => r.verificationId}
              onRowClick={(r) => setAbierta(r.verificationId)}
              emptyMessage={estadoIdentidad === 'IN_REVIEW' && !estadoListas && !q
                ? 'Nada por dictaminar.'
                : 'Ninguna persona con esos filtros.'}
            />
          )}
        </Block>
      </CardTitled>

      <Footnote>
        Cada persona tiene <b>una</b> verificación, la use el producto que la use: antes la misma
        persona podía tener una identidad comprobada en solicitudes y otra pendiente en
        beneficiarios. <b>Identidad</b> y <b>listas</b> son dos firmas: la primera dice que es quien
        dice ser; la segunda, que no es la persona listada. Una coincidencia posible casi siempre es
        un homónimo, y por eso no bloquea sola — la bloquea que alguien la confirme.
      </Footnote>

      {abierta && (
        <VerificacionModal
          key={abierta}
          verificationId={abierta}
          onClose={() => setAbierta(null)}
          onChanged={(cerrar) => { if (cerrar) setAbierta(null); recargar(); }}
        />
      )}
    </>
  );
}

/**
 * La ficha de una persona y sus dos dictámenes.
 *
 * Se lee de arriba abajo en el orden en que se revisa: lo que capturó, su INE y su selfie, y lo
 * que dijeron las listas. Los dictámenes van al final porque se firman después de mirar, no antes.
 */
export function VerificacionModal({ verificationId, onClose, onChanged }: {
  verificationId: string;
  onClose: () => void;
  /** `cerrar` = ya no queda nada que esta sesión pueda firmar aquí. */
  onChanged: (cerrar: boolean) => void;
}) {
  const state = useAsync(() => complianceApi.detail(verificationId), [verificationId]);
  const { can } = useCapabilities();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [notasIdentidad, setNotasIdentidad] = useState('');
  const [notasListas, setNotasListas] = useState('');

  /**
   * Después de un dictamen la ficha se cierra… salvo que quede el otro por firmar y quien está
   * aquí pueda firmarlo. Cerrarla entonces obligaría a buscar a la misma persona en la bandeja para
   * terminar lo que se estaba haciendo con ella.
   */
  const run = async (fn: () => Promise<VerificationRow>) => {
    setBusy(true); setFailure(null);
    try {
      const r = await fn();
      const quedaAlgo = (identidadAbierta(r) && can('compliance.review-identity'))
        || (listasAbiertas(r) && can('compliance.adjudicate'));
      if (quedaAlgo) state.reload();
      onChanged(!quedaAlgo);
    } catch (e) {
      setFailure(e instanceof Error ? e.message : 'No se pudo registrar el dictamen');
    } finally {
      setBusy(false);
    }
  };

  const v = state.data?.verification;
  const sinNotasIdentidad = !notasIdentidad.trim();
  const sinNotasListas = !notasListas.trim();

  return (
    <Modal
      title={v?.fullName ?? 'Verificación'}
      subtitle={v?.curp ?? verificationId}
      onClose={onClose}
      size="wide"
      actions={v && (
        <Badge tone={v.allowsToProceed ? 'ok' : 'bad'}>
          {v.allowsToProceed ? 'Puede operar' : 'Detenida'}
        </Badge>
      )}
    >
      <Block state={state} emptyLabel="No se encontró la verificación.">
        {(d: VerificationDetail) => {
          const r = d.verification;
          const i = identidad(r.identityStatus);
          const l = listas(r.screeningStatus);
          return (
            <div style={{ display: 'grid', gap: 20 }}>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Chip tone={i.tono}>Identidad: {i.texto}</Chip>
                <Chip tone={l.tono}>Listas: {l.texto}</Chip>
                {r.blockReason && <Chip tone="bad">{r.blockReason}</Chip>}
              </div>

              {/* Dicho en la ficha y no sólo en el manual: quien dictamina tiene que saber que su
                  firma es la única comprobación que hay, y que no está confirmando la de nadie. */}
              <div className="bo-alert bo-huerfanos">
                <b>Sin proveedor biométrico conectado:</b> la identidad la comprueba una persona
                comparando la INE contra la selfie y los datos capturados.
              </div>

              <section>
                <div className="bo-grupo-cap">La persona</div>
                <Persona d={d} />
              </section>

              <section>
                <div className="bo-grupo-cap">INE y selfie</div>
                {(d.documents ?? []).length === 0 ? (
                  <p className="bo-page-sub">
                    No ha subido documentos. Sin INE y selfie no hay con qué dictaminar la identidad.
                  </p>
                ) : (
                  <VisorDocumentos
                    docs={(d.documents ?? []).map((doc) => ({ ...doc, key: doc.documentType }))}
                    abrir={(tipo) => complianceApi.documentUrl(verificationId, tipo)}
                  />
                )}
              </section>

              <section>
                <div className="bo-grupo-cap">Cotejos contra listas</div>
                <Cotejos checks={d.checks ?? []} />
              </section>

              {r.decidedBy && (
                <section>
                  <div className="bo-grupo-cap">Último dictamen</div>
                  <Defs className="cols-3">
                    <DefRow k="Firmó" v={r.decidedBy} />
                    <DefRow k="Cuándo" v={dateTime(r.decidedAt)} />
                    <DefRow k="Notas" v={r.decisionNotes ?? '—'} />
                  </Defs>
                </section>
              )}

              {identidadAbierta(r) && (
                <Can
                  capability="compliance.review-identity"
                  fallback={<p className="bo-page-sub">Tu rol puede ver esta verificación, pero no dictaminar la identidad.</p>}
                >
                  <section style={cajaStyle}>
                    <h4 style={h4Style}>Identidad</h4>
                    <Field
                      label="Notas del dictamen"
                      hint="Obligatorias también para aprobar: sin proveedor, la aprobación vale lo que diga qué revisaste."
                    >
                      <TextArea
                        value={notasIdentidad}
                        onChange={setNotasIdentidad}
                        rows={3}
                        placeholder="Qué revisaste y por qué"
                      />
                    </Field>
                    <div style={botonesStyle}>
                      <Button
                        variant="primary"
                        disabled={busy || sinNotasIdentidad}
                        title={sinNotasIdentidad ? 'Escribe qué revisaste para poder dictaminar' : undefined}
                        onClick={() => run(() => complianceApi.reviewIdentity(verificationId, 'VERIFIED', notasIdentidad.trim()))}
                      >
                        Aprobar identidad
                      </Button>
                      <Button
                        variant="danger"
                        disabled={busy || sinNotasIdentidad}
                        title={sinNotasIdentidad ? 'Escribe qué no coincide para poder rechazar' : undefined}
                        onClick={() => run(() => complianceApi.reviewIdentity(verificationId, 'REJECTED', notasIdentidad.trim()))}
                      >
                        Rechazar identidad
                      </Button>
                    </div>
                  </section>
                </Can>
              )}

              {listasAbiertas(r) && (
                <Can
                  capability="compliance.adjudicate"
                  fallback={<p className="bo-page-sub">Resolver una coincidencia en listas es de otro rol.</p>}
                >
                  <section style={cajaStyle}>
                    <h4 style={h4Style}>Listas</h4>
                    <p className="bo-page-sub" style={{ margin: '0 0 10px' }}>
                      {r.screeningStatus === 'POTENTIAL_MATCH'
                        ? 'Hay una coincidencia posible. Compara fecha de nacimiento, CURP y domicilio contra el registro listado antes de firmar.'
                        : 'Todavía no hay un cotejo registrado. Si la revisaste a mano, deja constancia aquí.'}
                    </p>
                    <Field label="Notas" hint="Obligatorias: confirmar una coincidencia bloquea a la persona en todos los productos.">
                      <TextArea
                        value={notasListas}
                        onChange={setNotasListas}
                        rows={3}
                        placeholder="Por qué se despeja o se confirma"
                      />
                    </Field>
                    <div style={botonesStyle}>
                      <Button
                        variant="primary"
                        disabled={busy || sinNotasListas}
                        title={sinNotasListas ? 'Escribe por qué es un homónimo' : undefined}
                        onClick={() => run(() => complianceApi.adjudicate(verificationId, 'CLEARED', notasListas.trim()))}
                      >
                        Despejar homonimia
                      </Button>
                      <Button
                        variant="danger"
                        disabled={busy || sinNotasListas}
                        title={sinNotasListas ? 'Escribe por qué es la persona listada' : undefined}
                        onClick={() => run(() => complianceApi.adjudicate(verificationId, 'CONFIRMED_MATCH', notasListas.trim()))}
                      >
                        Confirmar coincidencia
                      </Button>
                    </div>
                  </section>
                </Can>
              )}

              {failure && <p style={{ fontSize: 13, color: 'var(--bo-bad)', margin: 0 }}>{failure}</p>}
            </div>
          );
        }}
      </Block>
    </Modal>
  );
}

/**
 * Lo capturado. Si el prospecto no viene —el servicio no respondió o no hay captura—, se cae a lo
 * que trae la propia verificación, que es poco pero alcanza para saber de quién se trata.
 */
function Persona({ d }: { d: VerificationDetail }) {
  const p = d.prospect;
  const r = d.verification;
  if (!p) {
    return (
      <>
        <Defs className="cols-3">
          <DefRow k="CURP" v={r.curp ?? '—'} />
          <DefRow k="RFC" v={r.rfc ?? '—'} />
          <DefRow k="Nacimiento" v={date(r.dateOfBirth)} />
        </Defs>
        <p className="bo-page-sub">Sin datos capturados del prospecto: sólo hay lo que guarda la verificación.</p>
      </>
    );
  }
  const domicilio = [
    [p.street, p.exteriorNumber].filter(Boolean).join(' '),
    p.neighborhood, p.municipality, p.city, p.state, p.postalCode && `CP ${p.postalCode}`,
  ].filter(Boolean).join(', ');
  return (
    <Defs className="cols-3">
      <DefRow k="Nombre(s)" v={p.firstName ?? '—'} />
      <DefRow k="Primer apellido" v={p.lastName1 ?? '—'} />
      <DefRow k="Segundo apellido" v={p.lastName2 ?? '—'} />
      <DefRow k="CURP" v={<code>{p.curp ?? '—'}</code>} />
      <DefRow k="RFC" v={<code>{p.rfc ?? '—'}</code>} />
      <DefRow k="Nacimiento" v={date(p.dateOfBirth)} />
      <DefRow k="Género" v={p.gender ?? '—'} />
      <DefRow k="Teléfono" v={p.phone ?? '—'} />
      <DefRow k="Correo" v={p.email ?? '—'} />
      <DefRow k="Domicilio" v={domicilio || '—'} />
      <DefRow k="Canal" v={p.channelType ?? '—'} />
      <DefRow k="Tipo de prospecto" v={p.prospectType ?? '—'} />
    </Defs>
  );
}

function Cotejos({ checks }: { checks: ScreeningCheck[] }) {
  if (checks.length === 0) {
    return <p className="bo-page-sub">Nadie la ha cotejado contra las listas todavía.</p>;
  }
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {checks.map((c, idx) => {
        const hayCoincidencias = c.matches != null
          && !(Array.isArray(c.matches) && c.matches.length === 0);
        return (
          <div key={`${c.checkedAt}-${idx}`} style={{ ...cajaStyle, padding: 10 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <Badge tone={outcomeTone(c.outcome)}>{listas(c.outcome ?? '—').texto}</Badge>
              <span style={{ fontSize: 12.5 }}>{dateTime(c.checkedAt)}</span>
              {c.trigger && <span className="bo-sub" style={{ marginTop: 0 }}>· {c.trigger}</span>}
            </div>
            {/* La versión de cada lista es lo que permite contestar, meses después, contra qué se
                cotejó: una lista se actualiza y el mismo nombre puede dejar de aparecer. */}
            {c.listVersions != null && (
              <div className="bo-sub bo-mono-sm" style={{ marginTop: 6 }}>
                Listas: {versiones(c.listVersions)}
              </div>
            )}
            {hayCoincidencias && (
              <pre className="bo-payload" style={{ marginTop: 8 }}>{JSON.stringify(c.matches, null, 2)}</pre>
            )}
          </div>
        );
      })}
    </div>
  );
}

function outcomeTone(o: string | null): Tone {
  if (o === 'CLEARED') return 'ok';
  if (o === 'POTENTIAL_MATCH') return 'warn';
  if (o === 'CONFIRMED_MATCH') return 'bad';
  return 'muted';
}

function versiones(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    return Object.entries(v as Record<string, unknown>).map(([k, x]) => `${k} ${String(x)}`).join(' · ');
  }
  return JSON.stringify(v);
}

const h4Style = { margin: '0 0 6px', fontSize: 13, fontWeight: 600 } as const;
const cajaStyle = { padding: 14, borderRadius: 'var(--bo-radius)', border: '1px solid var(--bo-border)' } as const;
const botonesStyle = { display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 } as const;
