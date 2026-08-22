import { useState } from 'react';
import { productsApi } from '@bo/api-client';
import { RequireRole } from '@bo/auth';
import {
  ensureThemeStyles, useAsync, useVista, PageHeader, Card, CardTitled, DataTable, Modal, Badge, Button,
  Field, Footnote, TextInput, NumberInput, Checkbox, Select, Spinner, Tabs, rate, money, count,
  type Column,
} from '@bo/design-system';
import {
  PRODUCT_TYPE_LABELS, PRODUCT_STATUS_LABELS, productStatusTone, behaviorLabel,
  type ProductDefinition, type CreateProductVersionRequest, type ProductType, type ProductBehavior,
} from '@bo/shared-types';
import { ProductoModal } from './ProductoModal';
import { PoliticaModal } from './PoliticaModal';
import { PoliticasLista } from './PoliticasLista';

ensureThemeStyles();

/**
 * Las dos mitades de definir un producto de crédito: **qué se cobra** y **a quién se le presta**.
 *
 * Tienen pantalla propia porque son dos preguntas de gobierno distintas —el catálogo se compara por
 * tasa y plazo; las políticas, por qué queda cubierto y qué no— pero viven en el mismo módulo
 * porque un producto sin política se autoriza sólo contra su score mínimo, sin mirar el buró, y eso
 * es un descuido que no se nota hasta que se aprueban solicitudes que no debían.
 */
type Vista = 'catalogo' | 'politicas';
const VISTAS: readonly Vista[] = ['catalogo', 'politicas'];

export function App({ vista: vistaRuta }: { vista?: string } = {}) {
  const [vista, setVista] = useVista<Vista>(vistaRuta, VISTAS, 'catalogo');
  const { data, loading, reload } = useAsync(() => productsApi.list(), []);
  const [busy, setBusy] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [abierto, setAbierto] = useState<ProductDefinition | null>(null);
  /** `{}` abre el alta de política en blanco; con `tipo`, preseleccionada para ese producto. */
  const [politica, setPolitica] = useState<{ tipo?: string } | null>(null);

  async function activate(p: ProductDefinition) {
    setBusy(p.id);
    try { await productsApi.activate(p.id); reload(); } finally { setBusy(null); }
  }
  async function retire(p: ProductDefinition) {
    setBusy(p.id);
    try { await productsApi.retire(p.id); reload(); } finally { setBusy(null); }
  }

  const columns: Array<Column<ProductDefinition>> = [
    { key: 'name', header: 'Producto', render: (p) => (
      <div><b>{p.name}</b><div style={{ fontSize: 11, color: 'var(--bo-text-muted)', fontFamily: 'var(--bo-mono)' }}>{p.productCode} · v{p.productVersion}</div></div>
    ) },
    { key: 'type', header: 'Tipo', render: (p) => PRODUCT_TYPE_LABELS[p.productType] },
    { key: 'behavior', header: 'Comportamiento', render: (p) => behaviorLabel(p.behavior) },
    { key: 'rate', header: 'Tasa nominal', align: 'right', render: (p) => rate(p.nominalRateAnnual) },
    { key: 'terms', header: 'Plazo / Línea', align: 'right', render: (p) => p.behavior === 'REVOLVING'
      ? `${money(p.minCreditLine ?? 0)}–${money(p.maxCreditLine ?? 0)}`
      : `${p.minTerm ?? '?'}–${p.maxTerm ?? '?'} m` },
    { key: 'status', header: 'Estatus', render: (p) => <Badge tone={productStatusTone(p.status)}>{PRODUCT_STATUS_LABELS[p.status]}</Badge> },
    { key: 'app', header: 'Visible en app', render: (p) => p.activeInApp ? <Badge tone="ok">Sí</Badge> : <Badge tone="muted">No</Badge> },
    { key: 'actions', header: '', render: (p) => (
      <RequireRole roles={['PRODUCT_MANAGER', 'ADMIN']}>
        {p.status === 'DRAFT' && <Button variant="primary" onClick={() => void activate(p)} disabled={busy === p.id}>Activar</Button>}
        {p.status === 'ACTIVE' && <Button onClick={() => void retire(p)} disabled={busy === p.id}>Retirar</Button>}
      </RequireRole>
    ) },
  ];

  return (
    <div>
      <PageHeader
        title={vista === 'politicas' ? 'Políticas de scoring' : 'Productos y tasas'}
        subtitle={vista === 'politicas'
          ? 'Una política por segmento × producto: bajo qué reglas se aprueba y en qué banda de score. Sin política, la solicitud se queda en evaluación.'
          : 'Tasas, plazos y líneas. Activar o retirar se refleja de inmediato en la app móvil, sin desplegar nada.'}
        actions={
          <RequireRole roles={['PRODUCT_MANAGER', 'ADMIN']}>
            {vista === 'politicas'
              ? <Button variant="primary" onClick={() => setPolitica({})}>+ Nueva política</Button>
              : <Button variant="primary" onClick={() => setCreating(true)}>+ Nueva versión</Button>}
          </RequireRole>
        }
      />

      <Tabs
        value={vista}
        onChange={setVista}
        tabs={[
          { value: 'catalogo', label: 'Productos y tasas', icon: '📦' },
          { value: 'politicas', label: 'Políticas de scoring', icon: '🎚️' },
        ]}
      />

      {vista === 'catalogo' ? (
        <>
          <Card style={{ marginBottom: 16, borderLeft: '3px solid var(--bo-primary)' }}>
            <span className="bo-page-sub">
              <b>Reflejo E2E:</b> un producto en estatus <b>ACTIVE</b> es exactamente lo que la app expone al cliente
              (<code>credit-product-service</code> → <code>channel-mobile-service GET /credit/products</code> → app), sin redeploy.
              {data && <> Hay <b>{count(data.filter((p) => p.activeInApp).length)}</b> productos visibles en la app.</>}
            </span>
          </Card>

          <CardTitled
            title={`Productos${data ? ` · ${count(data.length)}` : ''}`}
            action={<span className="bo-page-sub">Abre uno para ver bajo qué reglas se autoriza</span>}
          >
            {loading || !data ? <Spinner /> : (
              <DataTable columns={columns} rows={data} rowKey={(p) => p.id}
                         onRowClick={setAbierto} emptyMessage="Sin productos" />
            )}
          </CardTitled>

          <Footnote>
            Sólo quien tiene <b>products.manage</b> publica cambios de tasa, y cada publicación
            versiona el producto y queda en bitácora. Leer el catálogo lo puede cualquier empleado:
            cartera y clientes lo consultan para resolver nombres y tasas.
          </Footnote>
        </>
      ) : (
        <>
          {/* Las políticas en su propia pantalla y no escondidas dentro de cada producto: desde la
              ficha sólo se ve la de ese producto, y la pregunta de gobierno —cuáles existen y qué
              queda sin cubrir— no se puede contestar abriendo productos uno por uno. */}
          <PoliticasLista />

          <Footnote>
            Cambiar una banda no exige desplegar, pero sí una simulación previa: mover el umbral de
            aprobación automática cambia a quién se le presta, igual que cambiar la tasa. Un producto
            sin política se autoriza sólo contra su score mínimo, sin mirar el buró.
          </Footnote>
        </>
      )}

      {abierto && <ProductoModal producto={abierto} onClose={() => setAbierto(null)} />}
      {/* Al crear un producto se encadena el alta de su política, con el tipo ya elegido: un
          producto sin política se autoriza sólo contra su score mínimo, sin mirar el buró, y ese
          es un descuido que no se nota hasta que se aprueban solicitudes que no debían. */}
      {creating && (
        <CreateModal
          onClose={() => setCreating(false)}
          onCreated={(tipo) => { reload(); setPolitica({ tipo }); }}
        />
      )}
      {politica && (
        <PoliticaModal
          tipoProductoInicial={politica.tipo}
          onClose={() => setPolitica(null)}
          onCreada={() => { setPolitica(null); reload(); }}
        />
      )}
    </div>
  );
}

const TYPE_OPTS = Object.entries(PRODUCT_TYPE_LABELS).map(([value, label]) => ({ value, label }));

function CreateModal({ onClose, onCreated }: {
  onClose: () => void;
  /** Devuelve el tipo creado para encadenar el alta de su política de riesgo. */
  onCreated: (tipoProducto: string) => void;
}) {
  const [form, setForm] = useState({
    productCode: 'NEW-PROD',
    name: 'Nuevo producto',
    productType: 'PERSONAL_LOAN' as ProductType,
    behavior: 'INSTALLMENT' as ProductBehavior,
    audience: 'B2C',
    nominalRatePct: '36',
    moratoriumRatePct: '48',
    minTerm: '6',
    maxTerm: '36',
    defaultTerm: '24',
    minAmount: '5000',
    maxAmount: '150000',
    minLine: '5000',
    maxLine: '50000',
    defaultLine: '20000',
    openingFeePct: '2',
    minScore: '200',
    activateNow: true,
  });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));
  const revolving = form.behavior === 'REVOLVING';

  async function submit() {
    setBusy(true);
    try {
      const req: CreateProductVersionRequest = {
        productCode: form.productCode,
        productType: form.productType,
        behavior: form.behavior,
        name: form.name,
        description: `${form.name} — ${form.audience}`,
        targetAudience: form.audience as CreateProductVersionRequest['targetAudience'],
        nominalRateAnnual: Number(form.nominalRatePct) / 100,
        moratoriumRateAnnual: Number(form.moratoriumRatePct) / 100,
        minTerm: revolving ? null : Number(form.minTerm),
        maxTerm: revolving ? null : Number(form.maxTerm),
        defaultTerm: revolving ? null : Number(form.defaultTerm),
        minAmount: revolving ? null : Number(form.minAmount),
        maxAmount: revolving ? null : Number(form.maxAmount),
        minCreditLine: revolving ? Number(form.minLine) : null,
        maxCreditLine: revolving ? Number(form.maxLine) : null,
        defaultCreditLine: revolving ? Number(form.defaultLine) : null,
        amortizationType: revolving ? 'BULLET' : 'FRENCH',
        minApprovalScore: Number(form.minScore),
        defaultApprovalFlow: form.audience === 'B2C' ? 'AUTOMATIC' : 'COMMITTEE',
        openingFeeRate: Number(form.openingFeePct) / 100,
        prepaymentFeeRate: 0,
      };
      const created = await productsApi.createVersion(req);
      if (form.activateNow) await productsApi.activate(created.id);
      onCreated(form.productType);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Nueva versión de producto" subtitle="Crea en DRAFT y (opcional) activa para publicarla en la app" onClose={onClose}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Field label="Código"><TextInput value={form.productCode} onChange={(v) => set('productCode', v)} /></Field>
        <Field label="Nombre"><TextInput value={form.name} onChange={(v) => set('name', v)} /></Field>
        <Field label="Tipo"><Select value={form.productType} onChange={(v) => set('productType', v)} options={TYPE_OPTS} /></Field>
        <Field label="Comportamiento"><Select value={form.behavior} onChange={(v) => set('behavior', v)} options={[{ value: 'INSTALLMENT', label: 'Simple (amortizable)' }, { value: 'REVOLVING', label: 'Revolvente' }]} /></Field>
        <Field label="Audiencia"><Select value={form.audience} onChange={(v) => set('audience', v)} options={[{ value: 'B2C', label: 'B2C' }, { value: 'B2B', label: 'B2B' }, { value: 'B2B2C', label: 'B2B2C' }]} /></Field>
        {/* Lo numérico va alineado a la derecha y con la unidad dentro del campo: comparar «Tasa
            nominal» con «Tasa moratoria» es leerlas en columna, no buscar el paréntesis del
            rótulo. */}
        <Field label="Score mínimo"><NumberInput value={form.minScore} onChange={(v) => set('minScore', v)} /></Field>
        <Field label="Tasa nominal"><NumberInput value={form.nominalRatePct} onChange={(v) => set('nominalRatePct', v)} suffix="%" /></Field>
        <Field label="Tasa moratoria"><NumberInput value={form.moratoriumRatePct} onChange={(v) => set('moratoriumRatePct', v)} suffix="%" /></Field>
        <Field label="Comisión apertura"><NumberInput value={form.openingFeePct} onChange={(v) => set('openingFeePct', v)} suffix="%" /></Field>
        <div />
        {!revolving ? (
          <>
            <Field label="Plazo mínimo"><NumberInput value={form.minTerm} onChange={(v) => set('minTerm', v)} suffix="m" /></Field>
            <Field label="Plazo máximo"><NumberInput value={form.maxTerm} onChange={(v) => set('maxTerm', v)} suffix="m" /></Field>
            <Field label="Plazo por defecto"><NumberInput value={form.defaultTerm} onChange={(v) => set('defaultTerm', v)} suffix="m" /></Field>
            <div />
            <Field label="Monto mínimo"><NumberInput value={form.minAmount} onChange={(v) => set('minAmount', v)} suffix="MXN" /></Field>
            <Field label="Monto máximo"><NumberInput value={form.maxAmount} onChange={(v) => set('maxAmount', v)} suffix="MXN" /></Field>
          </>
        ) : (
          <>
            <Field label="Línea mínima"><NumberInput value={form.minLine} onChange={(v) => set('minLine', v)} suffix="MXN" /></Field>
            <Field label="Línea máxima"><NumberInput value={form.maxLine} onChange={(v) => set('maxLine', v)} suffix="MXN" /></Field>
            <Field label="Línea por defecto"><NumberInput value={form.defaultLine} onChange={(v) => set('defaultLine', v)} suffix="MXN" /></Field>
          </>
        )}
      </div>

      <div style={{ margin: '18px 0' }}>
        <Checkbox
          checked={form.activateNow}
          onChange={(v) => set('activateNow', v)}
          label="Activar de inmediato (publicar en la app)"
        />
      </div>

      <div style={{ display: 'flex', gap: 10 }}>
        <Button variant="primary" onClick={() => void submit()} disabled={busy}>
          {busy ? 'Guardando…' : form.activateNow ? 'Crear y activar' : 'Crear borrador'}
        </Button>
        <Button onClick={onClose}>Cancelar</Button>
      </div>
    </Modal>
  );
}

export default App;
