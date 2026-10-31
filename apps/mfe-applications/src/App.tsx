import { useMemo, useState } from 'react';
import { applicationsApi, REVIEW_STATUSES, type ApplicationQuery, type ApplicationRow } from '@bo/api-client';
import {
  ensureThemeStyles, useAsync, useVista, Block, PageHeader, CardTitled, dateTime,
  Badge, Button, Chip, DataTable, Field, Footnote, SearchInput, Select, TextInput, Toolbar, type Tone,
} from '@bo/design-system';
import { ApplicationModal } from './ApplicationModal';
import { ETAPAS, Pipeline } from './Pipeline';
import { Beneficiarios } from './Beneficiarios';
import { Cumplimiento } from './Cumplimiento';

ensureThemeStyles();

const STATUSES = [
  'PENDING_SCORING', 'UNDER_MANUAL_REVIEW', 'COMMITTEE_REVIEW', 'PENDING_DOCUMENTS',
  'APPROVED', 'REJECTED', 'OFFER_PRESENTED', 'OFFER_ACCEPTED',
  'PENDING_SIGNATURE', 'CONTRACT_SIGNED', 'DISBURSED',
];
const PRODUCTS = ['PERSONAL_LOAN', 'PAYROLL_LOAN', 'SME_LOAN', 'REVOLVING_LINE', 'DISTRIBUTOR_LINE'];
const AUDIENCES = ['B2C', 'B2B', 'B2B2C'];

/**
 * Bandeja de solicitudes.
 *
 * Dos vistas sobre la misma cola: **todas** y **por decidir**. La segunda no es un módulo aparte
 * —es el filtro por los estados en que una persona todavía tiene que resolver—, que es exactamente
 * lo que hace la mesa de comité. Tiene ruta propia (`/solicitudes/decidir`) porque es una bandeja
 * de trabajo: se entra a ella varias veces al día y se manda por enlace a quien tiene que firmar.
 */
type Vista = 'bandeja' | 'decidir' | 'beneficiarios' | 'cumplimiento';
const VISTAS: readonly Vista[] = ['bandeja', 'decidir', 'beneficiarios', 'cumplimiento'];

export function App({ vista: vistaRuta }: { vista?: string } = {}) {
  const [vista, setVista] = useVista<Vista>(vistaRuta, VISTAS, 'bandeja');
  const [query, setQuery] = useState<ApplicationQuery>({});
  const [etapa, setEtapa] = useState<string[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const onlyReview = vista === 'decidir';

  // Beneficiarios es otra cola con otro dueño: la colocación la decide la distribuidora y aquí sólo
  // se vigila. Vive en este módulo porque comparte sección —Originación— y ninguna de las dos
  // pantallas necesita lo que carga la otra.
  if (vista === 'beneficiarios') {
    return (
      <div>
        <PageHeader
          title="Beneficiarios · KYC"
          subtitle="Lo que esta consola valida de un beneficiario es su identidad, y nada más. Quién decide colocarle crédito —y asume el riesgo— es su distribuidora; el historial que ella ve es informativo y no bloquea."
        />
        <Beneficiarios />
      </div>
    );
  }

  // Cumplimiento cruza los dos embudos: la misma persona —pida para sí o la coloque una
  // distribuidora— tiene una sola verificación de identidad y de listas. Vive aquí porque es la
  // compuerta de originar, y separarla en otro remote sería cargar otro módulo para la misma INE.
  if (vista === 'cumplimiento') {
    return (
      <div>
        <PageHeader
          title="Cumplimiento · identidad y listas"
          subtitle="Una verificación por persona, para cualquier producto: que sea quien dice ser y que no sea la persona de una lista. Sin proveedor biométrico, las dos las firma alguien de esta mesa."
        />
        <Cumplimiento />
      </div>
    );
  }

  // El embudo se calcula **sin** el filtro de estatus: si se recalculara con él, elegir una
  // etapa dejaría el tablero con una sola barra al 100% y se perdería justo la comparación
  // para la que existe. Los demás filtros —producto, fecha— sí lo acotan, porque ahí el embudo
  // de ese recorte es lo que se quiere ver.
  const state = useAsync(() => applicationsApi.list(query), [JSON.stringify(query)]);

  const claveEtapa = useMemo(
    () => ETAPAS.find((e) => etapa && e.estatus.join() === etapa.join())?.clave ?? null,
    [etapa],
  );

  const rows = (state.data ?? [])
    .filter((r) => !onlyReview || (REVIEW_STATUSES as readonly string[]).includes(r.status))
    .filter((r) => !etapa || etapa.includes(r.status));

  const pendientes = (state.data ?? []).filter((r) =>
    (REVIEW_STATUSES as readonly string[]).includes(r.status),
  ).length;

  const set = (k: keyof ApplicationQuery) => (v: string) =>
    setQuery((q) => ({ ...q, [k]: v || undefined }));

  return (
    <div>
      <PageHeader
        title={onlyReview ? 'Por decidir' : 'Solicitudes de crédito'}
        subtitle={onlyReview
          ? 'Lo que espera decisión humana: el motor ya evaluó y mandó estos casos a revisión, comité o firma.'
          : 'El ciclo completo: captura, mesa de análisis, decisión, oferta, contrato y desembolso. Una persona decide sólo cuando el motor manda la solicitud a revisión.'}
        actions={<Chip tone={onlyReview ? 'warn' : undefined}>
          {onlyReview ? `${pendientes} esperando firma` : `${(state.data ?? []).length} en el embudo`}
        </Chip>}
      />

      <Block state={state} emptyLabel="Todavía no hay solicitudes." isEmpty={(d) => d.length === 0}>
        {(todas) => (
          <Pipeline
            rows={todas}
            activa={claveEtapa}
            onElegir={(e) => { setEtapa(e); if (e) setVista('bandeja'); }}
          />
        )}
      </Block>

      <Toolbar>
        <Button
          onClick={() => { setVista(onlyReview ? 'bandeja' : 'decidir'); setEtapa(null); }}
          selected={onlyReview}
          title="Las que esperan decisión humana"
        >
          Por decidir {pendientes > 0 && <b>· {pendientes}</b>}
        </Button>
        {etapa && (
          <Button onClick={() => setEtapa(null)} selected>Etapa filtrada · quitar</Button>
        )}

        <SearchInput
          value={query.q ?? ''}
          onChange={set('q')}
          onClear={() => set('q')('')}
          placeholder="Código de promotor…"
          ariaLabel="Buscar por código de promotor"
          title="El BFF busca por código de promotor, no por nombre ni folio"
        />
        <Filtro todos="Todos los estatus" options={STATUSES} value={query.status} onChange={set('status')} />
        <Filtro todos="Todos los productos" options={PRODUCTS} value={query.productType} onChange={set('productType')} />
        <Filtro todos="Todas las audiencias" options={AUDIENCES} value={query.targetAudience} onChange={set('targetAudience')} />
        {/* Las dos fechas son un solo filtro —un rango—, así que envuelven juntas: separadas, al
            quebrar la línea se quedaba «Hasta» en un renglón propio, lejos de su pareja. */}
        <div style={{ display: 'flex', gap: 10 }}>
          <Field label="Desde"><TextInput type="date" value={query.from ?? ''} onChange={set('from')} /></Field>
          <Field label="Hasta"><TextInput type="date" value={query.to ?? ''} onChange={set('to')} /></Field>
        </div>
      </Toolbar>

      <CardTitled
        title={`Solicitudes${rows.length ? ` · ${rows.length}` : ''}`}
        action={<span className="bo-page-sub">Abre una para ver score, buró y decidir</span>}
      >
      <Block
        state={state}
        emptyLabel="No hay solicitudes con esos filtros."
        isEmpty={(d) => d.length === 0}
      >
        {() =>
          rows.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--bo-text-muted)', padding: 16 }}>
              {onlyReview ? 'Nada esperando decisión.' : 'No hay solicitudes con esos filtros.'}
            </p>
          ) : (
            <DataTable
              rows={rows}
              rowKey={(r) => r.applicationId}
              onRowClick={(r) => setSelected(r.applicationId)}
              columns={[
                { key: 'folio', header: 'Folio', render: (r) => <code>{r.folio ?? '—'}</code> },
                { key: 'prospecto', header: 'Prospecto', render: (r) => <b>{r.prospectName ?? '—'}</b> },
                { key: 'producto', header: 'Producto', render: (r) => label(r.productType) },
                { key: 'monto', header: 'Monto', align: 'right', render: (r) => money(r.requestedAmount) },
                { key: 'estatus', header: 'Estatus', render: (r) => <StatusPill status={r.status} /> },
                { key: 'riesgo', header: 'Riesgo', render: (r) => <Risk level={r.riskLevel} /> },
                { key: 'decision', header: 'Decisión', render: (r) => decisionLabel(r.decision) },
                { key: 'flujo', header: 'Flujo', render: (r) => r.approvalFlow ?? '—' },
                { key: 'fecha', header: 'Fecha', render: (r) => dateTime(r.createdAt) },
              ]}
            />
          )
        }
      </Block>
      </CardTitled>

      <Footnote>
        El ciclo es <b>PENDING_SCORING → SCORING → APPROVED | UNDER_MANUAL_REVIEW →
        OFFER_PRESENTED → OFFER_ACCEPTED → PENDING_SIGNATURE → CONTRACT_SIGNED → DISBURSED</b>. El
        embudo se calcula sin el filtro de estatus a propósito: recalculado con él, elegir una etapa
        dejaría el tablero con una sola barra al 100% y se perdería la comparación para la que
        existe. El origen comercial y el ejecutivo están en el expediente, no en la lista.
      </Footnote>

      {selected && (
        <ApplicationModal
          applicationId={selected}
          onClose={() => setSelected(null)}
          onChanged={() => { setSelected(null); state.reload(); }}
        />
      )}
    </div>
  );
}

/** Filtro de un valor del catálogo: el vacío no es «ninguno», es «todos». */
function Filtro({ todos, options, value, onChange }: {
  /** Cómo se lee el filtro sin aplicar — «Todas las audiencias». */
  todos: string; options: string[]; value?: string; onChange: (v: string) => void;
}) {
  return (
    <Select
      value={value ?? ''}
      onChange={onChange}
      placeholder={todos}
      ariaLabel={todos}
      options={options.map((o) => ({ value: o, label: label(o) }))}
    />
  );
}

/** Los mismos tonos que el resto de la consola: la mesa de comité y la cartera se leen igual. */
export function StatusPill({ status }: { status: string }) {
  const review = (REVIEW_STATUSES as readonly string[]).includes(status);
  const done = status === 'DISBURSED' || status === 'CONTRACT_SIGNED';
  const tone: Tone = status === 'REJECTED' ? 'bad' : review ? 'warn' : done ? 'ok' : 'muted';
  return <Badge tone={tone}>{label(status)}</Badge>;
}

function Risk({ level }: { level: string | null }) {
  if (!level) return <>—</>;
  const tone: Tone = level === 'ALTO' ? 'bad' : level === 'MEDIO' ? 'warn' : 'ok';
  return <Badge tone={tone}>{level}</Badge>;
}

export function label(v: string | null | undefined): string {
  if (!v) return '—';
  const map: Record<string, string> = {
    PENDING_SCORING: 'En evaluación',
    UNDER_MANUAL_REVIEW: 'Revisión manual',
    COMMITTEE_REVIEW: 'Comité',
    PENDING_DOCUMENTS: 'Faltan documentos',
    APPROVED: 'Aprobada',
    REJECTED: 'Rechazada',
    OFFER_PRESENTED: 'Oferta presentada',
    OFFER_ACCEPTED: 'Oferta aceptada',
    PENDING_SIGNATURE: 'Por firmar',
    CONTRACT_SIGNED: 'Firmada',
    DISBURSED: 'Desembolsada',
    PERSONAL_LOAN: 'Préstamo personal',
    PAYROLL_LOAN: 'Crédito de nómina',
    SME_LOAN: 'Crédito PyME',
    REVOLVING_LINE: 'Línea revolvente',
    DISTRIBUTOR_LINE: 'Línea distribuidor',
  };
  return map[v] ?? v;
}

export function decisionLabel(d: string | null | undefined): string {
  const map: Record<string, string> = {
    AUTO_APPROVED: 'Auto-aprobada',
    MANUAL_REVIEW: 'A revisión',
    REJECTED: 'Auto-rechazada',
  };
  return d ? map[d] ?? d : '—';
}

export function money(v: number | null | undefined): string {
  return v == null ? '—' : `$${Math.round(v).toLocaleString('es-MX')}`;
}

export default App;
