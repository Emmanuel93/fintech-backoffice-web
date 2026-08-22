import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  collectionsApi, type BureauReport, type CasesQuery, type CaseStatus,
  type CollectionCase, type CollectionsConfig, type DelinquencyBucket,
} from '@bo/api-client';
import {
  ensureThemeStyles, useAsync, useVista, PageHeader, Card, CardTitled, DataTable, Badge, Button,
  Field, Footnote, Meter, Select, StatCard, Stats, TextInput, Toolbar, EmptyState, Tabs,
  money, count, dateTime, moneyCompact, type Column,
} from '@bo/design-system';
import { dashboardApi } from '@bo/api-client';
import { BUCKET_LABEL, ESTADO_CASO, bucketTono, estrategiaLabel } from './lenguaje';
import { CaseModal } from './CaseModal';
import { Gestiones, Promesas } from './Bandejas';

ensureThemeStyles();

type Vista = 'bandeja' | 'promesas' | 'gestion' | 'autorizar' | 'buro';
const VISTAS: readonly Vista[] = ['bandeja', 'promesas', 'gestion', 'autorizar', 'buro'];

/**
 * Cobranza: la mora, quién la trabaja y con qué resultado.
 *
 * <p>La bandeja se pagina en el servidor. La alternativa que había —listar cuentas morosas desde
 * cartera y preguntarle a cobranza el caso de cada renglón— es una llamada por fila para pintar una
 * tabla, y se degrada justo cuando la mora crece, que es cuando la pantalla importa.
 *
 * <p>Los límites con los que se valida (ventana de contacto, tope de intentos, máximo condonable,
 * umbral de quebranto) se piden al arrancar y se usan para **deshabilitar con la razón a la vista**
 * en vez de dejar intentar y traducir un 422. Un 422 llega cuando el gestor ya redactó la promesa.
 */
export function App({ vista: vistaRuta }: { vista?: string } = {}) {
  const [vista, setVista] = useVista<Vista>(vistaRuta, VISTAS, 'bandeja');
  const [config, setConfig] = useState<CollectionsConfig | null>(null);
  const [abierto, setAbierto] = useState<string | null>(null);

  // La configuración se pide una vez y se comparte con todas las vistas: es la misma para todo el
  // módulo y cambiarla es cosa de ops, no del usuario.
  useEffect(() => {
    let vivo = true;
    collectionsApi.config()
      .then((c) => { if (vivo) setConfig(c); })
      .catch(() => { /* Sin config la pantalla sigue: valida el servidor, que es quien manda. */ });
    return () => { vivo = false; };
  }, []);

  return (
    <div>
      <PageHeader
        title="Cobranza"
        subtitle="Casos de mora, gestión con el deudor, convenios y quebranto. Los saldos que se muestran son los de cartera; el caso lleva su propia proyección para calcular topes."
      />

      <Tabs
        value={vista}
        onChange={setVista}
        tabs={[
          { value: 'bandeja', label: 'Bandeja de casos', icon: '📋' },
          { value: 'promesas', label: 'Promesas de pago', icon: '🤝' },
          { value: 'gestion', label: 'Contacto y gestión', icon: '📇' },
          // Reestructuras y quitas son los dos tipos de convenio y se firman en la misma sesión:
          // los separa el tipo, no el flujo, así que comparten bandeja.
          { value: 'autorizar', label: 'Convenios por autorizar', icon: '✍️' },
          { value: 'buro', label: 'Reportes a buró', icon: '🏦' },
        ]}
      />

      {vista === 'bandeja' && <Bandeja config={config} onAbrir={setAbierto} />}
      {vista === 'promesas' && <Promesas />}
      {vista === 'gestion' && <Gestiones />}
      {vista === 'autorizar' && <PorAutorizar config={config} onAbrir={setAbierto} />}
      {vista === 'buro' && <Buro />}

      {abierto && (
        <CaseModal
          caseId={abierto}
          config={config}
          onClose={() => setAbierto(null)}
        />
      )}
    </div>
  );
}

// ── Bandeja ────────────────────────────────────────────────────────────────

/**
 * Los tramos del agregado de cartera, que **no** son los del caso de cobranza.
 *
 * `credit-portfolio` agrupa en cinco escalones fijos —CURRENT, 1-30, 31-60, 61-90, 90+— y
 * `collections` maneja siete, porque a partir de los 90 días la estrategia cambia tres veces
 * (despacho, quita, quebranto) y el agregado de cartera no necesita esa distinción. Traducir aquí
 * es lo que evita pintar «90+» crudo en una pantalla en español, y el mapa de abajo es lo que
 * permite que pulsar un tramo del reparto acote una bandeja que usa la otra escala.
 */
const TRAMO_LABEL: Record<string, string> = {
  CURRENT: 'Al corriente',
  '1-30': '1 a 30 días',
  '31-60': '31 a 60 días',
  '61-90': '61 a 90 días',
  '90+': 'Más de 90 días',
};

const TRAMO_TONO: Record<string, 'ok' | 'info' | 'warn' | 'bad'> = {
  CURRENT: 'ok', '1-30': 'info', '31-60': 'warn', '61-90': 'warn', '90+': 'bad',
};

/**
 * A qué filtro de la bandeja equivale cada tramo del agregado.
 *
 * `90+` no tiene un bucket equivalente —son tres— así que se acota por días mínimos de atraso, que
 * es la misma pregunta expresada como la entiende la consulta de casos.
 */
const TRAMO_FILTRO: Record<string, { bucket?: DelinquencyBucket; minDias?: number }> = {
  CURRENT: {},
  '1-30': { bucket: 'B1_30' },
  '31-60': { bucket: 'B31_60' },
  '61-90': { bucket: 'B61_90' },
  '90+': { minDias: 91 },
};

/** El tramo donde está concentrado el saldo en mora. */
function peorTramo(buckets: Array<{ key: string; principal: number }>): string {
  return buckets.reduce((peor, b) => (b.principal > peor.principal ? b : peor), buckets[0]).key;
}

function Bandeja({ config, onAbrir }: {
  config: CollectionsConfig | null;
  onAbrir: (caseId: string) => void;
}) {
  const [status, setStatus] = useState<CaseStatus | ''>('');
  const [bucket, setBucket] = useState<DelinquencyBucket | ''>('');
  const [producto, setProducto] = useState('');
  const [minDias, setMinDias] = useState('');
  const [page, setPage] = useState(0);
  const [applied, setApplied] = useState<CasesQuery>({ page: 0, size: 25 });

  const state = useAsync(() => collectionsApi.cases(applied), [JSON.stringify(applied)]);

  const buscar = useCallback(() => {
    const q: CasesQuery = { page: 0, size: 25 };
    if (status) q.status = status;
    if (bucket) q.bucket = bucket;
    if (producto.trim()) q.productType = producto.trim();
    const n = Number(minDias);
    if (minDias.trim() && Number.isFinite(n)) q.minDaysDelinquent = n;
    setPage(0);
    setApplied(q);
  }, [status, bucket, producto, minDias]);

  const limpiar = () => {
    setStatus(''); setBucket(''); setProducto(''); setMinDias('');
    setPage(0); setApplied({ page: 0, size: 25 });
  };

  const irA = (p: number) => {
    setPage(p);
    setApplied((q) => ({ ...q, page: p }));
  };

  /**
   * Pulsar un tramo del reparto acota la bandeja a ese tramo, y **también mueve los campos del
   * filtro**: si sólo cambiara la consulta, el formulario diría una cosa y la tabla otra, y el
   * siguiente «Buscar» desharía en silencio lo que se acababa de elegir.
   */
  const filtrarPorTramo = useCallback((clave: string) => {
    const f = TRAMO_FILTRO[clave] ?? {};
    setBucket(f.bucket ?? '');
    setMinDias(f.minDias != null ? String(f.minDias) : '');
    setStatus('');
    setPage(0);
    setApplied({
      page: 0, size: 25,
      ...(f.bucket ? { bucket: f.bucket } : {}),
      ...(f.minDias != null ? { minDaysDelinquent: f.minDias } : {}),
    });
  }, []);

  /**
   * La mora de la **cartera entera** por tramo de atraso, agregada en la base de datos de
   * credit-portfolio.
   *
   * Antes esta cifra se derivaba de las 25 filas de la página, con una nota que lo advertía. La
   * nota no basta: un número grande en una tarjeta se transcribe a una junta sin leer el pie, y
   * «$412k en mora» calculado sobre una página es falso por dos órdenes de magnitud. Ahora la
   * suma la hace quien tiene todas las filas.
   */
  const tramos = useAsync(() => dashboardApi.stats('dpdBucket'), []);

  const data = state.data;
  const rows = data?.content ?? [];

  const mora = useMemo(() => {
    const buckets = (tramos.data ?? []).filter((b) => b.key !== 'AL_CORRIENTE' && b.key !== 'CURRENT');
    const total = buckets.reduce((s, b) => s + b.principal, 0);
    const cuentas = buckets.reduce((s, b) => s + b.count, 0);
    const mayor = Math.max(1, ...buckets.map((b) => b.principal));
    return { buckets, total, cuentas, mayor };
  }, [tramos.data]);

  const columns: Array<Column<CollectionCase>> = [
    {
      key: 'quien',
      header: 'Deudor',
      render: (c) => (
        <div>
          <b>{c.obligorName ?? 'Sin nombre resuelto'}</b>
          <div className="bo-sub">{c.productType ?? '—'}</div>
        </div>
      ),
    },
    {
      key: 'mora',
      header: 'Mora',
      render: (c) => (
        <div>
          <Badge tone={bucketTono(c.currentBucket)}>{BUCKET_LABEL[c.currentBucket]}</Badge>
          <div className="bo-sub">{c.daysDelinquent} días</div>
        </div>
      ),
    },
    {
      key: 'deuda',
      header: 'Deuda',
      align: 'right',
      render: (c) => money(c.totalDebt),
    },
    {
      key: 'estrategia',
      header: 'Qué toca',
      render: (c) => <span style={{ fontSize: 12.5 }}>{estrategiaLabel(c.strategy)}</span>,
    },
    {
      key: 'estado',
      header: 'Estado',
      render: (c) => <Badge tone={c.status === 'LEGAL' ? 'bad' : 'muted'}>{ESTADO_CASO[c.status]}</Badge>,
    },
    {
      key: 'gestor',
      header: 'Gestor',
      render: (c) => c.assignedAgentId ?? <span className="bo-sub">Sin asignar</span>,
    },
  ];

  return (
    <>
      <Stats>
        <StatCard
          label="Saldo en mora"
          value={tramos.loading ? '…' : moneyCompact(mora.total)}
          tone={mora.total > 0 ? 'bad' : undefined}
          sub="capital de toda la cartera con atraso"
        />
        <StatCard
          label="Cuentas con atraso"
          value={tramos.loading ? '…' : count(mora.cuentas)}
          sub="agregado por credit-portfolio, no por esta página"
        />
        <StatCard
          label="Casos en la bandeja"
          value={data ? count(data.totalElements) : '…'}
          sub={data && data.totalPages > 1 ? `${count(rows.length)} en esta página` : 'con los filtros aplicados'}
        />
        <StatCard
          label="Tramo más pesado"
          value={mora.buckets.length ? (TRAMO_LABEL[peorTramo(mora.buckets)] ?? peorTramo(mora.buckets)) : '—'}
          tone={mora.buckets.length ? 'warn' : undefined}
          sub="donde está concentrado el saldo"
        />
      </Stats>

      <Card style={{ marginBottom: 16 }}>
        <div className="bo-card-pad">
          <div className="bo-field-label" style={{ marginBottom: 12 }}>
            Reparto por tramo de atraso · toda la cartera
          </div>
          {tramos.error ? (
            // El agregado lo publica `/dashboard/stats`, que el BFF gatea con `dashboard.view`.
            // Un gestor de cobranza puede no tenerla: el módulo entra con `portfolio.view`. No es
            // un fallo, es alcance, y decirlo evita que se reporte como error de la consola.
            <span className="bo-page-sub">
              {/autoriz/i.test(tramos.error)
                ? <>El reparto por tramo lo publica <code>/dashboard/stats</code>, que exige la capacidad <b>dashboard.view</b>. La bandeja de abajo funciona igual.</>
                : <>No se pudo cargar el reparto por tramo: {tramos.error}</>}
            </span>
          ) : mora.buckets.length === 0 ? (
            <span className="bo-page-sub">
              {tramos.loading ? 'Cargando…' : 'No hay cartera con atraso.'}
            </span>
          ) : (
            <div className="bo-meter-list">
              {mora.buckets.map((b) => (
                <Meter
                  key={b.key}
                  label={TRAMO_LABEL[b.key] ?? b.key}
                  value={`${money(b.principal)} · ${count(b.count)} ctas.`}
                  pct={(b.principal / mora.mayor) * 100}
                  tone={TRAMO_TONO[b.key] ?? 'bad'}
                  // El tramo también filtra: leer dónde se concentra la mora y acotar por ello no
                  // deberían ser dos gestos distintos.
                  onClick={() => filtrarPorTramo(b.key)}
                  title={`Filtrar la bandeja por ${TRAMO_LABEL[b.key] ?? b.key}`}
                />
              ))}
            </div>
          )}
        </div>
      </Card>

      <Toolbar>
        <Field label="Tramo de mora">
          <Select
            value={bucket}
            onChange={(v) => setBucket(v as DelinquencyBucket | '')}
            placeholder="Todos los tramos"
            ariaLabel="Tramo de mora"
            options={(Object.keys(BUCKET_LABEL) as DelinquencyBucket[])
              .map((b) => ({ value: b, label: BUCKET_LABEL[b] }))}
          />
        </Field>
        <Field label="Estado del caso">
          <Select
            value={status}
            onChange={(v) => setStatus(v as CaseStatus | '')}
            placeholder="Todos los estados"
            ariaLabel="Estado del caso"
            options={(Object.keys(ESTADO_CASO) as CaseStatus[])
              .map((s) => ({ value: s, label: ESTADO_CASO[s] }))}
          />
        </Field>
        <Field label="Producto">
          <TextInput value={producto} onChange={setProducto} placeholder="SIMPLE, REVOLVENTE…" />
        </Field>
        <Field label="Días de mora, mínimo">
          <TextInput value={minDias} onChange={setMinDias} placeholder="31" inputMode="numeric" align="right" />
        </Field>
        <Button variant="primary" onClick={buscar}>Buscar</Button>
        <Button onClick={limpiar}>Limpiar</Button>
      </Toolbar>

      <div style={{ marginTop: 16 }}>
        <CardTitled
          title={`Casos de cobranza${data ? ` · ${count(data.totalElements)}` : ''}`}
          action={<span className="bo-page-sub">Abre uno para registrar gestión, promesa o convenio</span>}
        >
          {state.error ? (
            <EmptyState message={`No se pudo cargar la bandeja: ${state.error}`} />
          ) : (
            <>
              <DataTable
                columns={columns}
                rows={rows}
                rowKey={(c) => c.caseId}
                onRowClick={(c) => onAbrir(c.caseId)}
                loading={state.loading}
                emptyMessage="Ningún caso coincide con estos filtros."
              />
              {data && data.totalPages > 1 && (
                <div className="bo-card-pad" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <Button disabled={page <= 0} onClick={() => irA(page - 1)}>Anterior</Button>
                  <span className="bo-sub">Página {page + 1} de {data.totalPages}</span>
                  <Button disabled={page + 1 >= data.totalPages} onClick={() => irA(page + 1)}>
                    Siguiente
                  </Button>
                </div>
              )}
            </>
          )}
        </CardTitled>
      </div>

      <Footnote>
        El tramo determina la estrategia y la provisión; el escalamiento a legal es automático a los
        90 días. Una promesa vigente suspende la escalada pero <b>no</b> cambia el tramo ni libera
        estimación. El reparto de arriba lo agrega <b>credit-portfolio</b> sobre la cartera entera;
        la deuda que muestra cada renglón es la proyección local del caso, que es la que sirve para
        calcular topes de condonación, no el saldo contable.
      </Footnote>
    </>
  );
}

// ── Convenios por autorizar ────────────────────────────────────────────────

/**
 * El otro par de ojos.
 *
 * <p>Sin esta vista, quien autoriza no tenía dónde ver lo que le toca: el convenio aceptado sólo
 * existía como respuesta de la llamada que lo aceptó, y el flujo dependía de que alguien pasara el
 * identificador por otro medio.
 */
function PorAutorizar({ config, onAbrir }: {
  config: CollectionsConfig | null;
  onAbrir: (caseId: string) => void;
}) {
  const state = useAsync(() => collectionsApi.awaitingAuthorization(), []);
  const rows = state.data ?? [];

  return (
    <div style={{ marginTop: 16 }}>
      <CardTitled title="Convenios aceptados, pendientes de autorizar">
        {state.error ? (
          <EmptyState message={`No se pudo cargar: ${state.error}`} />
        ) : (
          <DataTable
            columns={[
              {
                key: 'tipo', header: 'Convenio',
                render: (a) => (
                  <div>
                    <b>{a.type === 'QUITA_PARCIAL' ? 'Quita parcial' : 'Reestructura'}</b>
                    <div className="bo-sub bo-mono-sm">{a.agreementId.slice(0, 8)}</div>
                  </div>
                ),
              },
              {
                key: 'monto', header: 'Importe', align: 'right',
                render: (a) => a.type === 'QUITA_PARCIAL'
                  ? money(a.forgivenAmount)
                  : `${a.newTerms?.newTermMonths ?? '—'} meses`,
              },
              { key: 'deuda', header: 'Deuda original', align: 'right', render: (a) => money(a.originalDebt) },
              {
                key: 'aceptado', header: 'Aceptado',
                render: (a) => a.respondedAt ? dateTime(a.respondedAt) : '—',
              },
            ]}
            rows={rows}
            rowKey={(a) => a.agreementId}
            onRowClick={(a) => onAbrir(a.caseId)}
            loading={state.loading}
            emptyMessage="No hay convenios esperando autorización."
          />
        )}
      </CardTitled>
      {config && (
        <div className="bo-sub" style={{ marginTop: 8 }}>
          Un convenio propuesto expira solo a los {config.agreementResponseDays} días sin respuesta.
        </div>
      )}
    </div>
  );
}

// ── Buró ───────────────────────────────────────────────────────────────────

/**
 * Pantalla de vigilancia, no de operación: no hay reintento manual — el job de las 02:00 reintenta
 * solo, indefinidamente—, y los enviados no se pueden consultar por ninguna vía. Se dice, porque
 * una bandeja que no vacía nunca parece rota si no se explica.
 */
function Buro() {
  const state = useAsync(() => collectionsApi.bureauReports(), []);
  const rows = useMemo(
    () => [...(state.data ?? [])].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '')),
    [state.data],
  );

  const columns: Array<Column<BureauReport>> = [
    {
      key: 'evento', header: 'Evento',
      render: (r) => r.eventType === 'WRITE_OFF' ? 'Quebranto' : 'Quita parcial',
    },
    { key: 'monto', header: 'Importe reportado', align: 'right', render: (r) => money(r.amountReported) },
    {
      key: 'estado', header: 'Estado',
      render: (r) => <Badge tone={r.status === 'FAILED' ? 'bad' : 'warn'}>{r.status === 'FAILED' ? 'Falló' : 'Pendiente'}</Badge>,
    },
    {
      key: 'ref', header: 'Referencia',
      render: (r) => <span className="bo-mono-sm">{r.bureauReference ?? '—'}</span>,
    },
    { key: 'creado', header: 'Generado', render: (r) => dateTime(r.createdAt) },
  ];

  return (
    <div style={{ marginTop: 16 }}>
      <CardTitled title="Reportes a buró pendientes o fallidos">
        {state.error ? (
          <EmptyState message={`No se pudo cargar: ${state.error}`} />
        ) : (
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(r) => r.reportId}
            loading={state.loading}
            emptyMessage="No hay reportes pendientes ni fallidos."
          />
        )}
      </CardTitled>
      <div className="bo-sub" style={{ marginTop: 8 }}>
        Sólo se listan los pendientes y los fallidos; los enviados no son consultables. El reintento
        es automático a las 02:00 — desde aquí no hay nada que reenviar. La referencia es de un
        conector de prueba: no es folio oficial de buró.
      </div>
    </div>
  );
}

// Module Federation carga el expuesto por su default: `lazyProvider` lee `mod.default`.
// Sin esta línea el remote se sirve, resuelve a `undefined` y React falla con «Lazy element
// type must resolve to a class or function» — un error que no menciona la federación.
export default App;
