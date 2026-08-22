import { useMemo, useState } from 'react';
import { auditApi, type AuditEntry, type AuditQuery } from '@bo/api-client';
import {
  ensureThemeStyles, useAsync, Block, PageHeader, Card, CardTitled, Modal, Badge,
  Button, Field, TextInput, Select, DataTable, EmptyState, Spinner, count,
  type Column,
} from '@bo/design-system';
import {
  CANAL_LABEL, CATEGORIA_LABEL, TIPO_ACTOR_LABEL, canalLabel, categoriaLabel,
  desenlace, endpoint, eventoLabel, frase, moduloLabel, tipoActor, type TipoActor,
} from './lenguaje';

ensureThemeStyles();

/**
 * La fecha y la hora de una entrada, separadas para el renglón de la tabla.
 *
 * <p>El BFF normalmente manda la etiqueta ya resuelta con su zona —«2026-08-12 10:44:34 CST»— y
 * de ahí sale todo. Cuando falta hay que caer al instante ISO, y ahí no se puede rebanar: sobre
 * «2026-08-10T18:00:00Z» un `slice(11)` devuelve «18:00:00Z», que son seis horas corridas
 * respecto de lo que muestra el resto de la columna. Nadie que lea la bitácora tiene cómo notar
 * que ese renglón viene en UTC, así que el ISO se convierte a hora local y se marca el
 * desfase —feo, pero sin ambigüedad, y sólo aparece cuando el servicio no mandó etiqueta.
 */
function instante(
  etiqueta: string | null | undefined,
  iso: string | null | undefined,
): { fecha: string; hora: string } {
  if (etiqueta) return { fecha: etiqueta.slice(0, 10), hora: etiqueta.slice(11) };
  if (!iso) return { fecha: '—', hora: '' };

  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { fecha: iso, hora: '' };

  const p2 = (n: number) => String(n).padStart(2, '0');
  return {
    fecha: `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`,
    hora: d.toLocaleTimeString('es-MX', {
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false, timeZoneName: 'short',
    }),
  };
}

/**
 * Si la entrada dice sobre quién se actuó.
 *
 * <p>La sección se omite entera cuando no hay sujeto, en vez de pintarla con guiones. La mayoría
 * de la bitácora son hechos de dominio y accesos a listados, que no van sobre nadie en particular:
 * una ficha vacía en cada uno de esos renglones enseñaría a saltársela, y entonces también se
 * saltaría las veces que sí dice algo.
 */
function haySujeto(e: AuditEntry): boolean {
  return !!(e.subjectName || e.subjectCurp || e.subjectEmail || e.subjectPhone || e.partyId);
}

/**
 * Si a esta entrada le falta la identidad completa de quien actuó.
 *
 * <p>La causa puede ser una de dos —la entrada es anterior a que se capturara CURP y teléfono, o
 * esa persona no los tiene en su expediente— y desde aquí no se distinguen. Por eso el aviso dice
 * el hecho y no la causa: afirmar «es una entrada vieja» sería falso cada vez que se trate de
 * alguien sin CURP registrada, que hoy es la mayoría del personal sembrado.
 *
 * <p>Lo que sí se puede afirmar, y es lo que le sirve a quien audita, es que ese hueco no se
 * repara: la bitácora no se reescribe. Sólo aplica a actos de personas —los hechos de dominio no
 * tienen actor a quien identificar—.
 */
function identidadIncompleta(e: AuditEntry): boolean {
  if (!e.actor || e.actor === 'SYSTEM' || e.actor === 'anonymousUser') return false;
  return !e.actorCurp && !e.actorPhone;
}

/** Cuándo ocurrió el hecho, que es lo que va en la tabla. */
function cuando(e: AuditEntry): { fecha: string; hora: string } {
  return instante(e.occurredAtLabel ?? e.createdAtLabel, e.occurredAt ?? e.createdAt);
}

/** Las dos partes en una sola línea, para el detalle. */
function instanteLargo(
  etiqueta: string | null | undefined,
  iso: string | null | undefined,
): string {
  const { fecha, hora } = instante(etiqueta, iso);
  return hora ? `${fecha} ${hora}` : fecha;
}

/**
 * Bitácora regulatoria, para revisarse como se revisa un acta.
 *
 * <p>Antes esta pantalla mostraba seis columnas de identificadores: tipo de evento en mayúsculas,
 * y prefijos de UUID para actor, sujeto y agregado. Con eso no se puede contestar ninguna de las
 * preguntas con que llega una revisión —quién entró aquí, desde dónde, era de la casa o un
 * cliente, tuvo éxito— sin cruzar cada identificador contra otras pantallas. Auditar se volvía
 * transcribir.
 *
 * <p>Ahora cada renglón es una oración con su hora, su procedencia y su desenlace, y los filtros
 * son las preguntas reales de una revisión: qué clase de persona, por qué canal, qué clase de
 * hecho, y si salió bien. Lo técnico —endpoint, payload, agente, correlación— vive en el detalle,
 * que es donde se necesita al documentar un hallazgo, no al recorrer la lista.
 */
export function App() {
  const [subject, setSubject] = useState('');
  const [eventType, setEventType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [applied, setApplied] = useState<AuditQuery>({});
  const [selected, setSelected] = useState<AuditEntry | null>(null);

  // Filtros que se aplican sobre lo ya traído: son recortes de lectura, no consultas nuevas.
  const [tipo, setTipo] = useState('');
  const [canal, setCanal] = useState('');
  const [categoria, setCategoria] = useState('');
  const [soloFallos, setSoloFallos] = useState(false);

  const state = useAsync(() => auditApi.list(applied), [JSON.stringify(applied)]);

  const buscar = () => {
    const q: AuditQuery = {};
    if (subject.trim()) q.subject = subject.trim();
    if (eventType) q.eventType = eventType;
    // El servicio espera instantes ISO completos: una fecha suelta le devuelve 400. Se completa
    // aquí en vez de pedirle la hora a quien audita.
    if (from) q.from = `${from}T00:00:00Z`;
    if (to) q.to = `${to}T23:59:59Z`;
    setApplied(q);
  };

  const limpiar = () => {
    setSubject(''); setEventType(''); setFrom(''); setTo(''); setApplied({});
    setTipo(''); setCanal(''); setCategoria(''); setSoloFallos(false);
  };

  const todas = state.data ?? [];

  const rows = useMemo(() => todas.filter((e) => {
    if (tipo && tipoActor(e) !== tipo) return false;
    if (canal && (e.actorChannel ?? '').toUpperCase() !== canal) return false;
    if (categoria && (e.category ?? '').toUpperCase() !== categoria) return false;
    if (soloFallos && desenlace(e).ok) return false;
    return true;
  }), [todas, tipo, canal, categoria, soloFallos]);

  /** El panorama de lo que se está mirando, antes de leer un solo renglón. */
  const resumen = useMemo(() => {
    const porTipo = new Map<TipoActor, number>();
    let fallos = 0;
    const actores = new Set<string>();
    const ips = new Set<string>();
    todas.forEach((e) => {
      porTipo.set(tipoActor(e), (porTipo.get(tipoActor(e)) ?? 0) + 1);
      if (!desenlace(e).ok) fallos++;
      if (e.actorName || e.actor) actores.add(e.actorName ?? e.actor!);
      if (e.actorIp) ips.add(e.actorIp);
    });
    return { porTipo, fallos, actores: actores.size, ips: ips.size };
  }, [todas]);

  const eventTypes = useMemo(
    () => [...new Set(todas.map((e) => e.eventType))].sort(),
    [todas],
  );

  const columns: Array<Column<AuditEntry>> = [
    {
      key: 'cuando',
      header: 'Fecha y hora',
      render: (e) => {
        const { fecha, hora } = cuando(e);
        return (
          <div>
            <b style={{ fontSize: 12.5 }}>{fecha}</b>
            <div className="bo-sub">{hora}</div>
          </div>
        );
      },
    },
    {
      key: 'quien',
      header: 'Quién',
      render: (e) => {
        const t = tipoActor(e);
        return (
          <div>
            <b>{e.actorName ?? e.actorEmail ?? (e.actor ? 'Usuario identificado' : 'Sistema')}</b>
            <div className="bo-sub">
              <Badge tone={t === 'INTERNO' ? 'info' : t === 'SISTEMA' ? 'muted' : 'warn'}>
                {TIPO_ACTOR_LABEL[t]}
              </Badge>
              {e.actorRoles && <span> {e.actorRoles}</span>}
            </div>
          </div>
        );
      },
    },
    {
      key: 'que',
      header: 'Qué pasó',
      render: (e) => (
        <div style={{ maxWidth: 460 }}>
          <span style={{ fontSize: 12.5 }}>{frase(e)}</span>
          <div className="bo-sub">{eventoLabel(e.eventType)} · {categoriaLabel(e.category)}</div>
        </div>
      ),
    },
    {
      key: 'donde',
      header: 'Desde dónde',
      render: (e) => (
        <div>
          <span style={{ fontSize: 12.5 }}>{canalCorto(e.actorChannel)}</span>
          <div className="bo-sub bo-mono-sm">{e.actorIp ?? '—'}</div>
        </div>
      ),
    },
    {
      key: 'resultado',
      header: 'Resultado',
      render: (e) => {
        const d = desenlace(e);
        return <Badge tone={d.ok ? 'ok' : 'bad'}>{d.texto}</Badge>;
      },
    },
  ];

  return (
    <div>
      <PageHeader
        title="Auditoría"
        subtitle="Bitácora inmutable. Cada hecho queda con quién lo provocó, desde dónde, sobre qué y con qué resultado. El detalle trae el endpoint y el payload tal como se recibieron."
      />

      <Card>
        <div className="bo-card-pad" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 300px', minWidth: 240 }}>
            <Field label="Teléfono, correo, CURP, contrato o identificador">
              <TextInput value={subject} onChange={setSubject} grow
                         placeholder="5544332211 · ana@correo.mx · CTR-202608-… · CURP" />
            </Field>
          </div>
          <Field label="Tipo de evento">
            <Select value={eventType} onChange={setEventType}
                    options={[{ value: '', label: 'Todos los eventos' },
                              ...eventTypes.map((t) => ({ value: t, label: eventoLabel(t) }))]} />
          </Field>
          <Field label="Desde"><TextInput type="date" value={from} onChange={setFrom} /></Field>
          <Field label="Hasta"><TextInput type="date" value={to} onChange={setTo} /></Field>
          <Button variant="primary" onClick={buscar}>Buscar</Button>
          {(subject || eventType || from || to || tipo || canal || categoria || soloFallos) && (
            <Button onClick={limpiar}>Limpiar</Button>
          )}
        </div>

        {/* Los filtros de una revisión: qué clase de persona, por dónde entró, qué clase de hecho
            y si salió bien. Son las preguntas con que se acota un hallazgo. */}
        <div className="bo-card-pad" style={{ paddingTop: 0, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Field label="Quién actuó">
            <Select value={tipo} onChange={setTipo}
                    options={[{ value: '', label: 'Cualquier tipo de usuario' },
                              ...Object.entries(TIPO_ACTOR_LABEL).map(([value, label]) => ({ value, label }))]} />
          </Field>
          <Field label="Canal">
            <Select value={canal} onChange={setCanal}
                    options={[{ value: '', label: 'Todos los canales' },
                              ...Object.entries(CANAL_LABEL).map(([value, label]) => ({ value, label }))]} />
          </Field>
          <Field label="Tipo de registro">
            <Select value={categoria} onChange={setCategoria}
                    options={[{ value: '', label: 'Todas las categorías' },
                              ...Object.entries(CATEGORIA_LABEL).map(([value, label]) => ({ value, label }))]} />
          </Field>
          <Button variant={soloFallos ? 'primary' : 'default'}
                  onClick={() => setSoloFallos((v) => !v)}>
            Sólo lo que falló{resumen.fallos > 0 ? ` · ${resumen.fallos}` : ''}
          </Button>
        </div>

        {applied.subject && (
          <div className="bo-card-pad" style={{ paddingTop: 0 }}>
            <span className="bo-page-sub">
              Historia de <b>{applied.subject}</b> — se unen sus eventos como prospecto, como
              cliente y como usuario que inicia sesión, porque son la misma persona.
            </span>
          </div>
        )}
      </Card>

      {todas.length > 0 && (
        <div className="bo-kpis" style={{ margin: '14px 0' }}>
          <ResumenTarjeta label="Registros" valor={count(todas.length)}
                          pie={`${count(resumen.actores)} usuarios distintos`} />
          <ResumenTarjeta label="Personal interno"
                          valor={count(resumen.porTipo.get('INTERNO') ?? 0)}
                          pie="operaciones desde la consola" />
          <ResumenTarjeta label="Clientes y terceros"
                          valor={count((resumen.porTipo.get('CLIENTE') ?? 0)
                                     + (resumen.porTipo.get('DISTRIBUIDOR') ?? 0)
                                     + (resumen.porTipo.get('NEGOCIO') ?? 0))}
                          pie="desde la app móvil" />
          <ResumenTarjeta label="Sin éxito" valor={count(resumen.fallos)}
                          pie={`${count(resumen.ips)} direcciones IP distintas`}
                          tono={resumen.fallos > 0 ? 'bad' : undefined} />
        </div>
      )}

      <CardTitled
        title={`Hechos registrados${rows.length !== todas.length ? ` · ${rows.length} de ${todas.length}` : rows.length ? ` · ${rows.length}` : ''}`}
        action={<span className="bo-page-sub">Abre uno para ver el endpoint, el payload y la sesión</span>}
      >
        <Block state={state} emptyLabel="No hay eventos con ese criterio." isEmpty={(d) => d.length === 0}>
          {() => rows.length === 0
            ? <EmptyState message="Ningún registro con esos filtros." />
            : <DataTable columns={columns} rows={rows} rowKey={(e) => e.entryId} onRowClick={setSelected} />}
        </Block>
      </CardTitled>

      {selected && <EntryModal entry={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

function ResumenTarjeta({ label, valor, pie, tono }: {
  label: string; valor: string; pie: string; tono?: 'bad';
}) {
  return (
    <div className="bo-kpi">
      <div className="bo-kpi-label">{label}</div>
      <div className="bo-kpi-value" style={{ color: tono === 'bad' ? 'var(--bo-bad)' : undefined }}>{valor}</div>
      <div className="bo-kpi-delta" style={{ color: 'var(--bo-text-muted)' }}>{pie}</div>
    </div>
  );
}

/**
 * El acta de un hecho.
 *
 * <p>Lo que se necesita para documentar un hallazgo: la frase, quién con nombre y correo, desde
 * qué IP y con qué navegador, sobre qué recurso, con qué endpoint, cuánto tardó y qué contestó.
 * El payload va al final, tal como llegó — es evidencia, no un resumen.
 */
function EntryModal({ entry, onClose }: { entry: AuditEntry; onClose: () => void }) {
  const state = useAsync(() => auditApi.detail(entry.entryId), [entry.entryId]);
  const t = tipoActor(entry);
  const d = desenlace(entry);
  const ep = endpoint(entry);

  return (
    <Modal
      title={eventoLabel(entry.eventType)}
      subtitle={`${entry.eventType} · ${categoriaLabel(entry.category)}`}
      onClose={onClose}
      size="wide"
    >
      <div className="bo-acta">{frase(entry)}</div>

      <section style={{ marginTop: 16 }}>
        <div className="bo-grupo-cap">Quién</div>
        <div className="bo-defs cols-3">
          <Def k="Nombre" v={entry.actorName ?? '— (no identificado)'} />
          <Def k="Correo" v={entry.actorEmail ?? '—'} />
          {entry.actorCurp && <Def k="CURP" v={entry.actorCurp} mono />}
          {entry.actorPhone && <Def k="Teléfono" v={entry.actorPhone} />}
          <Def k="Tipo de usuario" v={TIPO_ACTOR_LABEL[t]} />
          <Def k="Roles" v={entry.actorRoles ?? '—'} />
          <Def k="Identificador" v={entry.actor ?? '—'} mono />
          <Def k="Sesión" v={entry.sessionId ?? '— (no registrada)'} mono />
          {identidadIncompleta(entry) && (
            <div className="bo-sub" style={{ gridColumn: '1 / -1', marginTop: 4 }}>
              Sin CURP ni teléfono en este registro. La bitácora no se reescribe: si falta, faltó
              al momento del acceso.
            </div>
          )}
        </div>
      </section>

      <section style={{ marginTop: 16 }}>
        <div className="bo-grupo-cap">Desde dónde y cuándo</div>
        <div className="bo-defs cols-3">
          <Def k="Canal" v={canalLabel(entry.actorChannel)} />
          <Def k="Dirección IP" v={entry.actorIp ?? '—'} mono />
          <Def k="Ocurrió" v={instanteLargo(entry.occurredAtLabel ?? entry.createdAtLabel, entry.occurredAt ?? entry.createdAt)} />
          <Def k="Registrado en bitácora" v={instanteLargo(entry.createdAtLabel, entry.createdAt)} />
          <Def k="Navegador / cliente" v={entry.userAgent ?? '—'} mono />
        </div>
      </section>

      {haySujeto(entry) && (
        <section style={{ marginTop: 16 }}>
          <div className="bo-grupo-cap">Sobre quién se actuó</div>
          <div className="bo-defs cols-3">
            <Def k="Nombre" v={entry.subjectName ?? '— (no identificado)'} />
            {entry.subjectCurp && <Def k="CURP" v={entry.subjectCurp} mono />}
            {entry.subjectEmail && <Def k="Correo" v={entry.subjectEmail} />}
            {entry.subjectPhone && <Def k="Teléfono" v={entry.subjectPhone} />}
            <Def k="Identificador" v={entry.partyId ?? '—'} mono />
          </div>
        </section>
      )}

      <section style={{ marginTop: 16 }}>
        <div className="bo-grupo-cap">Sobre qué</div>
        <div className="bo-defs cols-3">
          <Def k="Pantalla o proceso" v={moduloLabel(entry)} />
          <Def k="Servicio de origen" v={entry.domainSource} />
          <Def k="Tipo de recurso" v={entry.resourceType ?? '—'} />
          <Def k="Recurso" v={entry.resourceId ?? entry.aggregateId ?? '—'} mono />
          <Def k="Correlación" v={entry.correlationId ?? '—'} mono />
        </div>
      </section>

      <section style={{ marginTop: 16 }}>
        <div className="bo-grupo-cap">Cómo se ejecutó</div>
        <div className="bo-defs cols-3">
          <Def k="Endpoint consumido" v={ep ?? '— (evento de dominio, sin petición HTTP)'} mono />
          <Def k="Resultado" v={d.texto} />
          <Def k="Duración" v={entry.durationMs != null ? `${entry.durationMs} ms` : '—'} />
        </div>
      </section>

      <section style={{ marginTop: 18 }}>
        <div className="bo-grupo-cap">Payload recibido</div>
        <p className="bo-page-sub" style={{ margin: '0 0 6px' }}>
          Tal como llegó, con los secretos enmascarados en origen. Es evidencia, no un resumen.
        </p>
        {state.loading ? <Spinner /> : (
          <pre className="bo-payload">{formatPayload(state.data?.payload)}</pre>
        )}
      </section>
    </Modal>
  );
}

function Def({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div>
      <div className="bo-def-k">{k}</div>
      <div className="bo-def-v" style={mono || v.length > 34
        ? { fontFamily: 'var(--bo-mono)', fontSize: 11.5, wordBreak: 'break-all' }
        : undefined}>{v}</div>
    </div>
  );
}

function canalCorto(c: string | null | undefined): string {
  const map: Record<string, string> = {
    BACKOFFICE: 'Backoffice', MOBILE: 'App móvil', SERVICE: 'Servicio interno',
  };
  return c ? map[c.toUpperCase()] ?? c : '—';
}

function formatPayload(payload: unknown): string {
  if (payload == null) return 'Sin payload.';
  if (typeof payload === 'string') {
    try { return JSON.stringify(JSON.parse(payload), null, 2); } catch { return payload; }
  }
  return JSON.stringify(payload, null, 2);
}

export default App;
