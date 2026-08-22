import { useMemo, useState } from 'react';
import { dashboardApi, portfolioApi } from '@bo/api-client';
import {
  ensureThemeStyles, useAsync, PageHeader, Card, CardTitled, DataTable, Modal, Tabs, Badge,
  Defs, DefRow, Footnote, Meter, MeterList, SearchInput, Select, Spinner, StatCard, Stats, Toolbar,
  money, moneyCompact, rate, date, dateTime, count, percent,
  type Column,
} from '@bo/design-system';
import {
  ACCOUNT_STATUS_LABELS, accountStatusTone, STAGE_LABELS, stageTone,
  PRODUCT_TYPE_LABELS, behaviorLabel, paymentStatusLabel, paymentStatusTone,
  type CreditAccount, type AccountDetail,
} from '@bo/shared-types';

ensureThemeStyles();

const STATUS_OPTS = [
  { value: '', label: 'Todos los estatus' },
  ...Object.entries(ACCOUNT_STATUS_LABELS).map(([value, label]) => ({ value, label })),
];
const PRODUCT_OPTS = [
  { value: '', label: 'Todos los productos' },
  ...Object.entries(PRODUCT_TYPE_LABELS).map(([value, label]) => ({ value, label })),
];

/** Los tramos de atraso tal como los agrupa credit-portfolio, dichos en español. */
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

export function App() {
  const [status, setStatus] = useState('');
  const [productType, setProductType] = useState('');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const { data, loading } = useAsync(
    () => portfolioApi.list({ status, productType, q, size: 100 }),
    [status, productType, q],
  );

  /**
   * Cómo se reparte la cartera **entera** por tramo de atraso. Lo agrega la base de datos de
   * credit-portfolio, no esta pantalla: la lista de arriba trae 100 cuentas y sumar sobre ellas
   * daría un total que se lee como si fuera toda la cartera.
   */
  const tramos = useAsync(() => dashboardApi.stats('dpdBucket'), []);

  const reparto = useMemo(() => {
    const filas = tramos.data ?? [];
    const total = filas.reduce((s, b) => s + b.principal, 0);
    const conAtraso = filas.filter((b) => b.key !== 'CURRENT');
    const mayor = Math.max(1, ...filas.map((b) => b.principal));
    return {
      filas, mayor, total,
      atrasado: conAtraso.reduce((s, b) => s + b.principal, 0),
      cuentasAtrasadas: conAtraso.reduce((s, b) => s + b.count, 0),
      // Vencida oficial CNBV/IFRS-9: sólo a partir de los 90 días. Lo de 31 a 90 es atraso
      // temprano (SICR) y todavía no es cartera vencida; sumarlos daba dos moras distintas de la
      // misma cartera según la pantalla que se mirara.
      vencida: filas.filter((b) => b.key === '90+').reduce((s, b) => s + b.principal, 0),
    };
  }, [tramos.data]);

  const columns: Array<Column<CreditAccount>> = [
    { key: 'contract', header: 'Contrato', render: (r) => <span style={{ fontFamily: 'var(--bo-mono)', fontSize: 12.5 }}>{r.contractNumber}</span> },
    { key: 'client', header: 'Cliente', render: (r) => <b>{r.obligorName}</b> },
    { key: 'product', header: 'Producto', render: (r) => (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span>{PRODUCT_TYPE_LABELS[r.productType]}</span>
        <span style={{ fontSize: 11, color: 'var(--bo-text-muted)' }}>{behaviorLabel(r.productBehavior)}</span>
      </div>
    ) },
    { key: 'status', header: 'Estatus', render: (r) => <Badge tone={accountStatusTone(r.status)}>{ACCOUNT_STATUS_LABELS[r.status]}</Badge> },
    { key: 'avance', header: 'Avance', render: (r) => <Progress paid={r.paidInstallments} total={r.totalInstallments} /> },
    { key: 'dpd', header: 'DPD', align: 'right', render: (r) => <span style={{ color: r.daysDelinquent > 0 ? 'var(--bo-bad)' : 'var(--bo-text-muted)' }}>{r.daysDelinquent}</span> },
    { key: 'stage', header: 'IFRS-9', render: (r) => r.ifrs9Stage ? <Badge tone={stageTone(r.ifrs9Stage)}>{STAGE_LABELS[r.ifrs9Stage]}</Badge> : '—' },
    { key: 'principal', header: 'Capital', align: 'right', render: (r) => money(r.principalBalance) },
    { key: 'exe', header: 'Ejecutivo', render: (r) => r.assignedExecutiveName ?? '—' },
  ];

  return (
    <div>
      <PageHeader
        title="Cartera de crédito"
        subtitle="Cuentas activas, saldo, morosidad y salud IFRS-9 dentro de tu alcance. El comportamiento —simple o revolvente— cambia lo que significa cada saldo."
        actions={data ? <Badge tone="info">{count(data.totalElements)} cuentas</Badge> : undefined}
      />

      <Stats>
        <StatCard
          label="Capital colocado"
          value={tramos.loading ? '…' : moneyCompact(reparto.total)}
          sub="toda la cartera, no sólo esta página"
        />
        <StatCard
          label="Cartera vencida (90+)"
          value={tramos.loading ? '…' : moneyCompact(reparto.vencida)}
          tone={reparto.vencida > 0 ? 'bad' : undefined}
          sub={reparto.total > 0 ? `IMOR ${percent((reparto.vencida / reparto.total) * 100)}` : 'sin saldo'}
        />
        <StatCard
          label="Con algún atraso"
          value={tramos.loading ? '…' : moneyCompact(reparto.atrasado)}
          tone={reparto.atrasado > 0 ? 'warn' : undefined}
          sub={`${count(reparto.cuentasAtrasadas)} cuentas`}
        />
        <StatCard
          label="Cuentas del filtro"
          value={data ? count(data.totalElements) : '…'}
          sub={data && data.totalElements > (data.content?.length ?? 0)
            ? `se listan las primeras ${count(data.content.length)}`
            : 'con los filtros aplicados'}
        />
      </Stats>

      <Card style={{ marginBottom: 16 }}>
        <div className="bo-field-label" style={{ marginBottom: 12 }}>
          Reparto por tramo de atraso · toda la cartera
        </div>
        {tramos.error ? (
          // Lo publica `/dashboard/stats`, que el BFF gatea con `dashboard.view`. Quien entra a
          // este módulo lo hace con `portfolio.view` y puede no tener la otra: no es un fallo, es
          // alcance, y decirlo evita que se reporte como error de la consola.
          <span className="bo-page-sub">
            {/autoriz/i.test(tramos.error)
              ? <>El reparto lo publica <code>/dashboard/stats</code>, que exige la capacidad <b>dashboard.view</b>. La tabla de abajo funciona igual.</>
              : <>No se pudo cargar el reparto por tramo: {tramos.error}</>}
          </span>
        ) : reparto.filas.length === 0 ? (
          <span className="bo-page-sub">{tramos.loading ? 'Cargando…' : 'Sin cuentas que repartir.'}</span>
        ) : (
          <MeterList>
            {reparto.filas.map((b) => (
              <Meter
                key={b.key}
                label={TRAMO_LABEL[b.key] ?? b.key}
                value={`${money(b.principal)} · ${count(b.count)} ctas.`}
                pct={(b.principal / reparto.mayor) * 100}
                tone={TRAMO_TONO[b.key] ?? 'bad'}
              />
            ))}
          </MeterList>
        )}
      </Card>

      <Toolbar>
        <SearchInput
          value={q}
          onChange={setQ}
          onClear={() => setQ('')}
          placeholder="Buscar cliente o contrato…"
          ariaLabel="Buscar por nombre del acreditado o número de contrato"
        />
        <Select value={status} onChange={setStatus} options={STATUS_OPTS} ariaLabel="Estatus de la cuenta" />
        <Select value={productType} onChange={setProductType} options={PRODUCT_OPTS} ariaLabel="Producto" />
      </Toolbar>

      <CardTitled
        title="Cuentas"
        action={<span className="bo-page-sub">Abre una para ver saldos, calendario y pagos aplicados</span>}
      >
        <DataTable
          columns={columns}
          rows={data?.content ?? []}
          rowKey={(r) => r.creditAccountId}
          loading={loading}
          onRowClick={(r) => setSelected(r.creditAccountId)}
          emptyMessage="Sin cuentas para el filtro"
        />
      </CardTitled>

      <Footnote>
        <b>Stage 1</b> sana · <b>Stage 2</b> SICR (31 a 90 días) · <b>Stage 3</b> vencida (90+). La
        cartera vencida oficial CNBV/IFRS-9 es sólo la de Stage 3; el tramo de 31 a 90 es deterioro
        significativo y todavía no cuenta como vencida. Qué filas se ven lo acota el BFF según tu
        alcance: nacional, región, zona, sucursal o cartera propia.
      </Footnote>

      {selected && <AccountModal id={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

/** Mensualidades cubiertas sobre el total. En revolvente no hay plan, así que no se inventa uno. */
function Progress({ paid, total }: { paid?: number | null; total?: number | null }) {
  if (!total) return <span style={{ color: 'var(--bo-text-muted)' }}>—</span>;
  const done = paid ?? 0;
  const pct = Math.min(100, (done / total) * 100);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 110 }}>
      <div style={{ flex: 1, height: 6, borderRadius: 999, background: 'var(--bo-surface-2)', border: '1px solid var(--bo-border)', overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: pct >= 100 ? 'var(--bo-ok)' : 'var(--bo-primary)' }} />
      </div>
      <span style={{ fontSize: 11.5, color: 'var(--bo-text-muted)', fontVariantNumeric: 'tabular-nums' }}>{done}/{total}</span>
    </div>
  );
}

type DetailTab = 'resumen' | 'calendario' | 'pagos' | 'disposiciones';

/**
 * Ficha de la cuenta, centrada.
 *
 * Es la pantalla de trabajo del seguimiento —saldos, calendario completo y pagos aplicados—, no un
 * apunte al margen: centrada tiene el ancho para leer la tabla de amortización sin estrangularla
 * contra el borde, que es lo que pasaba en el cajón lateral.
 */
function AccountModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, loading } = useAsync(() => portfolioApi.detail(id), [id]);
  const [tab, setTab] = useState<DetailTab>('resumen');

  const payments = data?.payments ?? [];
  const applied = payments.filter((p) => p.status === 'CONFIRMED');

  return (
    <Modal
      size="wide"
      title={data?.obligorName ?? 'Cuenta'}
      subtitle={data?.contractNumber}
      onClose={onClose}
      actions={data && <Badge tone={accountStatusTone(data.status)}>{ACCOUNT_STATUS_LABELS[data.status]}</Badge>}
    >
      {loading || !data ? <Spinner /> : (
        <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
            <Badge tone="muted">{PRODUCT_TYPE_LABELS[data.productType]}</Badge>
            <Badge tone="muted">{behaviorLabel(data.productBehavior)}</Badge>
            {data.ifrs9Stage && <Badge tone={stageTone(data.ifrs9Stage)}>{STAGE_LABELS[data.ifrs9Stage]}</Badge>}
            {data.daysDelinquent > 0 && <Badge tone="bad">{data.daysDelinquent} días de atraso</Badge>}
          </div>

          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'resumen', label: 'Resumen' },
              { value: 'calendario', label: 'Calendario', count: data.schedule.length || undefined },
              { value: 'pagos', label: 'Pagos', count: payments.length || undefined },
              { value: 'disposiciones', label: 'Disposiciones', count: data.dispositions.length || undefined },
            ]}
          />

          {tab === 'resumen' && <SummaryTab data={data} appliedCount={applied.length} />}

          {tab === 'calendario' && (
            data.schedule.length === 0
              ? <Empty msg="Esta cuenta no tiene plan de pagos (línea revolvente)." />
              : (
                <DataTable
                  columns={[
                    { key: 'n', header: '#', render: (i) => i.installmentNumber },
                    { key: 'due', header: 'Vence', render: (i) => date(i.dueDate) },
                    { key: 'cap', header: 'Capital', align: 'right', render: (i) => money(i.principalAmount) },
                    { key: 'int', header: 'Interés', align: 'right', render: (i) => money(i.interestAmount) },
                    // El IVA va en su propia columna porque no es ingreso de la institución: es del
                    // SAT. Sumado dentro del interés, el plan diría que se gana más de lo que se
                    // gana; omitido, el «Pago» no cuadraría contra capital + interés y la
                    // diferencia parecería un redondeo repartido por todo el calendario.
                    { key: 'iva', header: 'IVA', align: 'right',
                      render: (i) => i.taxAmount > 0
                        ? money(i.taxAmount)
                        : <span className="bo-sub">exento</span> },
                    { key: 'tot', header: 'Pago', align: 'right', render: (i) => <b>{money(i.totalAmount)}</b> },
                    { key: 'st', header: 'Estatus', render: (i) => (
                      <Badge tone={i.status === 'PAID' ? 'ok' : i.status === 'OVERDUE' ? 'bad' : i.status === 'PARTIAL' ? 'warn' : 'muted'}>
                        {i.status === 'PAID' ? 'Pagada' : i.status === 'OVERDUE' ? 'Vencida' : i.status === 'PARTIAL' ? 'Parcial' : 'Pendiente'}
                      </Badge>
                    ) },
                  ]}
                  rows={data.schedule}
                  rowKey={(i) => String(i.installmentNumber)}
                />
              )
          )}

          {tab === 'pagos' && (
            payments.length === 0
              ? <Empty msg="Todavía no se registran pagos para esta cuenta." />
              : (
                <>
                  <div style={{ marginBottom: 12, fontSize: 12.5, color: 'var(--bo-text-muted)' }}>
                    {applied.length} de {payments.length} aplicados ·{' '}
                    <b style={{ color: 'var(--bo-ok)' }}>{money(applied.reduce((s, p) => s + (p.amount ?? 0), 0))}</b> cobrados
                  </div>
                  <DataTable
                    columns={[
                      { key: 'date', header: 'Registrado', render: (p) => dateTime(p.createdAt) },
                      { key: 'applied', header: 'Aplicado', render: (p) => dateTime(p.appliedAt) },
                      { key: 'amount', header: 'Monto', align: 'right', render: (p) => <b>{money(p.amount)}</b> },
                      { key: 'method', header: 'Método', render: (p) => p.paymentMethod ?? '—' },
                      { key: 'ref', header: 'Referencia', render: (p) => <span style={{ fontFamily: 'var(--bo-mono)', fontSize: 12 }}>{p.externalRef ?? '—'}</span> },
                      { key: 'st', header: 'Estatus', render: (p) => (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                          <Badge tone={paymentStatusTone(p.status)}>{paymentStatusLabel(p.status)}</Badge>
                          {p.rejectionReason && <span style={{ fontSize: 11, color: 'var(--bo-text-muted)' }}>{p.rejectionReason}</span>}
                        </div>
                      ) },
                    ]}
                    rows={payments}
                    rowKey={(p) => p.paymentOrderId}
                  />
                </>
              )
          )}

          {tab === 'disposiciones' && (
            data.dispositions.length === 0
              ? <Empty msg="Sin disposiciones registradas." />
              : (
                <DataTable
                  columns={[
                    { key: 'date', header: 'Fecha', render: (d) => dateTime(d.createdAt) },
                    { key: 'type', header: 'Tipo', render: (d) => d.type === 'SELF_USE' ? 'Uso propio' : d.type === 'THIRD_PARTY_CREDIT' ? 'Crédito a tercero' : 'Nómina' },
                    { key: 'amount', header: 'Monto', align: 'right', render: (d) => money(d.amount) },
                    { key: 'st', header: 'Estatus', render: (d) => <Badge tone={d.status === 'COMPLETED' ? 'ok' : d.status === 'FAILED' || d.status === 'REVERSED' ? 'bad' : 'info'}>{d.status}</Badge> },
                  ]}
                  rows={data.dispositions}
                  rowKey={(d) => d.dispositionId}
                />
              )
          )}
        </>
      )}
    </Modal>
  );
}

function SummaryTab({ data, appliedCount }: { data: AccountDetail; appliedCount: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
      <section>
        <div className="bo-field-label" style={{ marginBottom: 10 }}>Saldos</div>
        <Defs className="cols-3">
          <DefRow k="Capital" v={money(data.principalBalance)} />
          <DefRow k="Interés devengado" v={money(data.accruedInterestBalance)} />
          <DefRow k="IVA por cobrar" v={money(data.ivaBalance ?? 0)} />
          <DefRow k="Penalización" v={money(data.penaltyBalance)} />
          <DefRow k="Deuda total" v={<b>{money(data.totalDebt)}</b>} />
          <DefRow k="Capital pagado" v={money(data.principalPaid ?? 0)} />
          <DefRow k="Monto vencido" v={<span style={{ color: (data.overdueAmount ?? 0) > 0 ? 'var(--bo-bad)' : undefined }}>{money(data.overdueAmount ?? 0)}</span>} />
          {data.productBehavior === 'REVOLVING' && <DefRow k="Límite de línea" v={money(data.creditLimit ?? 0)} />}
          {data.productBehavior === 'REVOLVING' && <DefRow k="Disponible" v={money(data.availableCredit ?? 0)} />}
        </Defs>
      </section>

      <section>
        <div className="bo-field-label" style={{ marginBottom: 10 }}>Seguimiento del plan</div>
        <Defs className="cols-3">
          <DefRow k="Mensualidades cubiertas" v={data.totalInstallments ? `${data.paidInstallments ?? 0} de ${data.totalInstallments}` : 'Revolvente'} />
          <DefRow k="Siguiente mensualidad" v={data.nextInstallmentNumber ? `#${data.nextInstallmentNumber}` : '—'} />
          <DefRow k="Próximo vencimiento" v={date(data.paymentDueDate)} />
          <DefRow k="Pago mínimo" v={money(data.minimumPayment ?? 0)} />
          <DefRow k="Mensualidades vencidas" v={data.overdueInstallments ?? 0} />
          <DefRow k="Pagos aplicados" v={appliedCount} />
        </Defs>
      </section>

      <section>
        <div className="bo-field-label" style={{ marginBottom: 10 }}>Términos y riesgo</div>
        <Defs className="cols-3">
          <DefRow k="Tasa nominal" v={rate(data.nominalRate)} />
          <DefRow k={data.productBehavior === 'REVOLVING' ? 'Tipo' : 'Plazo'} v={data.assignedTerm ? `${data.assignedTerm} meses` : 'Revolvente'} />
          <DefRow k="Días de mora (DPD)" v={data.daysDelinquent} />
          <DefRow k="Nivel de riesgo" v={data.riskTier ?? '—'} />
          <DefRow k="Pérdida esperada" v={percent((data.expectedLossRate ?? 0) * 100)} />
          <DefRow k="Provisión" v={money(data.provisionAmount ?? 0)} />
          <DefRow k="CLABE" v={data.clabeAccount ? `•••• ${data.clabeAccount.slice(-4)}` : '—'} />
          <DefRow k="Activada" v={dateTime(data.activatedAt)} />
          <DefRow k="Producto" v={data.productCode} />
        </Defs>
      </section>
    </div>
  );
}

function Empty({ msg }: { msg: string }) {
  return <div className="bo-table-empty">{msg}</div>;
}

export default App;
