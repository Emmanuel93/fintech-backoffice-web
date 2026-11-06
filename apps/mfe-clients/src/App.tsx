import { useState } from 'react';
import { clientsApi, distributorsApi, executivesApi } from '@bo/api-client';
import { RequireRole, isExternalCollaborator } from '@bo/auth';
import {
  ensureThemeStyles, useAsync, useVista, PageHeader, CardTitled, DataTable, Modal, Tabs, Badge, Button,
  Chip, Defs, DefRow, Footnote, SearchInput, Select, Spinner, Toolbar,
  money, moneyCompact, dateTime, count, rate,
  type Column, type AsyncState,
} from '@bo/design-system';
import type { Page } from '@bo/shared-types';
import {
  PRODUCT_TYPE_LABELS, ACCOUNT_STATUS_LABELS, accountStatusTone,
  applicationStatusLabel, applicationStatusTone,
  type Client, type Distributor, type OriginatedCredit,
} from '@bo/shared-types';

import { StatementsSection } from './Statements';
import { ReceiptsSection } from './Receipts';
import { CreditProfileSection } from './CreditProfile';

ensureThemeStyles();

/**
 * Directorio en tres pestañas.
 *
 * Personas y negocios se separan porque no se buscan igual —una por CURP, el otro por RFC y razón
 * social— ni se leen igual. Los distribuidores son la tercera: no son un `partyType` distinto sino
 * una party con un rol adicional, pero la pregunta que se le hace a un distribuidor ("qué colocó,
 * cuánto comisionó") no se parece en nada a la que se le hace a un acreditado, y mezclarlos en una
 * sola tabla obligaba a que ninguna de las dos columnas fuera la correcta.
 */
type Segment = 'personas' | 'negocios' | 'distribuidores';
const SEGMENTOS: readonly Segment[] = ['personas', 'negocios', 'distribuidores'];

export function App({ vista }: { vista?: string } = {}) {
  const [segment, setSegment] = useVista<Segment>(vista, SEGMENTOS, 'personas');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedDist, setSelectedDist] = useState<string | null>(null);

  const partyType = segment === 'personas' ? 'INDIVIDUAL' : 'BUSINESS';
  const isDist = segment === 'distribuidores';

  const parties = useAsync(
    () => (isDist ? Promise.resolve(null) : clientsApi.list({ type: partyType, q, size: 100 })),
    [segment, q],
  );
  const distributors = useAsync(
    () => (isDist ? distributorsApi.list({ q, size: 100 }) : Promise.resolve(null)),
    [segment, q],
  );

  const total = isDist ? distributors.data?.totalElements : parties.data?.totalElements;

  return (
    <div>
      <PageHeader
        title={isDist ? 'Distribuidores' : 'Clientes'}
        subtitle={isDist
          ? 'Personas y negocios que colocan crédito a terceros con nuestra línea. La comisión se devenga contra el pago, no contra la colocación.'
          : 'Directorio de acreditados: estado del expediente KYC y ejecutivo asignado.'}
        actions={total != null ? <Badge tone="info">{count(total)} registros</Badge> : undefined}
      />

      <Tabs
        value={segment}
        onChange={(v) => { setSegment(v); setQ(''); }}
        tabs={[
          { value: 'personas', label: 'Personas', icon: '🧑' },
          { value: 'negocios', label: 'Negocios', icon: '🏢' },
          { value: 'distribuidores', label: 'Distribuidores', icon: '🤝' },
        ]}
      />

      <Toolbar>
        <SearchInput
          value={q}
          onChange={setQ}
          onClear={() => setQ('')}
          ariaLabel="Buscar en el directorio"
          placeholder={
            isDist ? 'Buscar por nombre o código (DIST-0042)…'
              : segment === 'negocios' ? 'Buscar razón social o RFC…'
                : 'Buscar nombre, CURP o RFC…'
          }
        />
      </Toolbar>

      {isDist
        ? <DistributorsTable data={distributors} onSelect={setSelectedDist} />
        : <PartiesTable segment={segment} data={parties} onSelect={setSelected} />}

      <Footnote>
        Un distribuidor no es un tercer tipo de parte: es una persona o un negocio <b>con un rol
        adicional</b>, y el mismo registro puede ser acreditado de su propio crédito y a la vez
        originar créditos de terceros. Un alta por interés propio entra sin ejecutivo asignado; la
        asignación se hace desde <b>Estructura comercial</b>, por zona geográfica y carga.
      </Footnote>

      {selected && <ClientModal id={selected} onClose={() => setSelected(null)} onChanged={parties.reload} />}
      {selectedDist && <DistributorModal id={selectedDist} onClose={() => setSelectedDist(null)} />}
    </div>
  );
}

/* ------------------------------- personas / negocios ------------------------------- */

function PartiesTable({
  segment, data, onSelect,
}: {
  segment: Segment; data: AsyncState<Page<Client> | null>; onSelect: (id: string) => void;
}) {
  const business = segment === 'negocios';
  // El colaborador externo no recibe estos campos del BFF; no se pinta una columna condenada a "—".
  const restricted = isExternalCollaborator();

  const columns: Array<Column<Client>> = [
    { key: 'name', header: business ? 'Razón social' : 'Nombre', render: (r) => <b>{r.fullName}</b> },
    ...(restricted ? [] : [{
      key: 'fiscal',
      header: business ? 'RFC' : 'CURP / RFC',
      render: (r: Client) => <span style={{ fontFamily: 'var(--bo-mono)', fontSize: 12 }}>{business ? (r.rfc ?? '—') : (r.curp ?? r.rfc ?? '—')}</span>,
    } as Column<Client>]),
    { key: 'score', header: 'Score', align: 'right', render: (r) => r.totalScore ?? '—' },
    { key: 'risk', header: 'Riesgo', render: (r) => <Badge tone={r.riskLevel === 'ALTO' ? 'bad' : r.riskLevel === 'MEDIO' ? 'warn' : 'ok'}>{r.riskLevel ?? '—'}</Badge> },
    { key: 'exe', header: 'Ejecutivo', render: (r) => r.assignedExecutiveName ?? <span style={{ color: 'var(--bo-text-muted)' }}>Sin asignar</span> },
    { key: 'status', header: 'Estatus', render: (r) => <Badge tone={r.status === 'ACTIVE' ? 'ok' : r.status === 'BLACKLISTED' ? 'bad' : 'muted'}>{r.status}</Badge> },
    { key: 'since', header: 'Alta', render: (r) => dateTime(r.createdAt) },
  ];

  return (
    <CardTitled title={business ? 'Negocios' : 'Personas'}>
      <DataTable
        columns={columns}
        rows={data.data?.content ?? []}
        rowKey={(r) => r.partyId}
        loading={data.loading}
        onRowClick={(r) => onSelect(r.partyId)}
        emptyMessage={business ? 'Sin negocios para el filtro' : 'Sin personas para el filtro'}
      />
    </CardTitled>
  );
}

function ClientModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { data, loading, reload } = useAsync(() => clientsApi.detail(id), [id]);
  const { data: executives } = useAsync(() => executivesApi.list(), []);
  const [assigning, setAssigning] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const restricted = isExternalCollaborator();

  async function assign() {
    if (!assigning) return;
    setBusy(true);
    setErr(null);
    try {
      await clientsApi.assignExecutive(id, assigning);
      reload();
      onChanged();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'No fue posible asignar');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      size="wide"
      title={data?.fullName ?? 'Cliente'}
      subtitle={data ? `${data.partyType === 'BUSINESS' ? 'Negocio' : 'Persona'} · ${data.partyId}` : undefined}
      onClose={onClose}
      actions={data && <Badge tone={data.status === 'ACTIVE' ? 'ok' : 'muted'}>{data.status}</Badge>}
    >
      {loading || !data ? <Spinner /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
          <Defs className="cols-3">
            {!restricted && <DefRow k="RFC" v={data.rfc ?? '—'} />}
            {!restricted && <DefRow k="CURP" v={data.curp ?? '—'} />}
            <DefRow k="Score" v={data.totalScore ?? '—'} />
            <DefRow k="Riesgo" v={data.riskLevel ?? '—'} />
            <DefRow k="Alta" v={dateTime(data.createdAt)} />
            <DefRow k="Ejecutivo" v={data.assignedExecutiveName ?? 'Sin asignar'} />
          </Defs>

          <RequireRole roles={['OPS_SUPERVISOR', 'ADMIN']}>
            <section className="bo-card"><div className="bo-card-pad">
              <div className="bo-field-label" style={{ marginBottom: 8 }}>Reasignar cartera a ejecutivo</div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <Select
                  value={assigning}
                  onChange={setAssigning}
                  options={[{ value: '', label: 'Selecciona…' }, ...(executives ?? []).map((e) => ({ value: e.id, label: e.name }))]}
                />
                <Button variant="primary" onClick={() => void assign()} disabled={!assigning || busy}>
                  {busy ? 'Asignando…' : 'Asignar'}
                </Button>
                {err && <span style={{ color: 'var(--bo-bad)', fontSize: 12.5 }}>{err}</span>}
              </div>
            </div></section>
          </RequireRole>

          <section>
            <div className="bo-field-label" style={{ marginBottom: 10 }}>Cartera ({data.accounts.length})</div>
            <DataTable
              columns={[
                { key: 'contract', header: 'Contrato', render: (a) => a.contractNumber },
                { key: 'product', header: 'Producto', render: (a) => PRODUCT_TYPE_LABELS[a.productType] },
                { key: 'status', header: 'Estatus', render: (a) => <Badge tone={accountStatusTone(a.status)}>{ACCOUNT_STATUS_LABELS[a.status]}</Badge> },
                { key: 'dpd', header: 'DPD', align: 'right', render: (a) => a.daysDelinquent },
                { key: 'principal', header: 'Capital', align: 'right', render: (a) => money(a.principalBalance) },
              ]}
              rows={data.accounts}
              rowKey={(a) => a.creditAccountId}
              emptyMessage="Sin cuentas"
            />
          </section>

          <StatementsSection partyId={id} />

          {/* A distributor's client: his type, the red list, and the receipts of his loans with each distributor. */}
          <CreditProfileSection partyId={id} />
          <ReceiptsSection partyId={id} emptyHint="Sin recibos: se generan cuando una distribuidora le coloca un préstamo" />

          <section>
            <div className="bo-field-label" style={{ marginBottom: 10 }}>Solicitudes ({data.applications.length})</div>
            <DataTable
              columns={[
                { key: 'product', header: 'Producto', render: (a) => PRODUCT_TYPE_LABELS[a.productType] },
                { key: 'amount', header: 'Monto', align: 'right', render: (a) => money(a.requestedAmount) },
                { key: 'status', header: 'Estatus', render: (a) => <Badge tone={applicationStatusTone(a.status)}>{applicationStatusLabel(a.status)}</Badge> },
                { key: 'rate', header: 'Tasa', align: 'right', render: (a) => a.nominalRate ? rate(a.nominalRate) : '—' },
                { key: 'created', header: 'Fecha', render: (a) => dateTime(a.createdAt) },
              ]}
              rows={data.applications}
              rowKey={(a) => a.applicationId}
              emptyMessage="Sin solicitudes"
            />
          </section>
        </div>
      )}
    </Modal>
  );
}

/* ------------------------------- distribuidores ------------------------------- */

function DistributorsTable({
  data, onSelect,
}: {
  data: AsyncState<Page<Distributor> | null>; onSelect: (id: string) => void;
}) {
  const columns: Array<Column<Distributor>> = [
    // El código es lo que se teclea al originar y lo que la gente recuerda: va en chip, no en un
    // gris de apoyo, porque en esta tabla es el identificador y no un dato secundario.
    { key: 'code', header: 'Código', render: (r) => (r.promoterCode ? <Chip tone="info">{r.promoterCode}</Chip> : <span className="bo-sub">sin código</span>) },
    { key: 'name', header: 'Nombre / Razón social', render: (r) => <b>{r.fullName}</b> },
    { key: 'type', header: 'Tipo', render: (r) => <Badge tone="muted">{r.partyType === 'BUSINESS' ? 'Negocio' : 'Persona'}</Badge> },
    { key: 'credits', header: 'Créditos colocados', align: 'right', render: (r) => count(r.originatedCredits) },
    { key: 'amount', header: 'Monto colocado', align: 'right', render: (r) => money(r.originatedAmount) },
    { key: 'line', header: 'Línea propia', align: 'right', render: (r) => r.creditLineLimit ? `${moneyCompact(r.creditLineAvailable ?? 0)} / ${moneyCompact(r.creditLineLimit)}` : '—' },
    { key: 'comm', header: 'Comisión devengada', align: 'right', render: (r) => money(r.commissionAccrued) },
    { key: 'status', header: 'Estatus', render: (r) => <Badge tone={r.active ? 'ok' : 'muted'}>{r.active ? 'Activo' : 'Inactivo'}</Badge> },
  ];

  return (
    <CardTitled
      title="Distribuidores"
      action={<span style={{ fontSize: 11.5, color: 'var(--bo-text-muted)' }}>La comisión se devenga contra el pago, no contra la colocación</span>}
    >
      <DataTable
        columns={columns}
        rows={data.data?.content ?? []}
        rowKey={(r) => r.partyId}
        loading={data.loading}
        onRowClick={(r) => onSelect(r.partyId)}
        emptyMessage="Sin distribuidores para el filtro"
      />
    </CardTitled>
  );
}

function DistributorModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, loading } = useAsync(() => distributorsApi.detail(id), [id]);

  const creditColumns: Array<Column<OriginatedCredit>> = [
    { key: 'contract', header: 'Contrato', render: (c) => <span style={{ fontFamily: 'var(--bo-mono)', fontSize: 12.5 }}>{c.contractNumber}</span> },
    { key: 'obligor', header: 'Acreditado', render: (c) => c.obligorName ?? '—' },
    { key: 'product', header: 'Producto', render: (c) => PRODUCT_TYPE_LABELS[c.productType] },
    { key: 'status', header: 'Estatus', render: (c) => <Badge tone={accountStatusTone(c.status)}>{ACCOUNT_STATUS_LABELS[c.status]}</Badge> },
    { key: 'dpd', header: 'DPD', align: 'right', render: (c) => <span style={{ color: c.daysDelinquent > 0 ? 'var(--bo-bad)' : undefined }}>{c.daysDelinquent}</span> },
    { key: 'principal', header: 'Capital', align: 'right', render: (c) => money(c.principalBalance) },
    { key: 'comm', header: 'Comisión', align: 'right', render: (c) => money(c.commissionAccrued) },
    { key: 'since', header: 'Originado', render: (c) => dateTime(c.originatedAt) },
  ];

  const mora = data?.credits.filter((c) => c.daysDelinquent > 0) ?? [];

  return (
    <Modal
      size="wide"
      title={data?.fullName ?? 'Distribuidor'}
      subtitle={data?.promoterCode ? `Código ${data.promoterCode}` : undefined}
      onClose={onClose}
      actions={data && <Badge tone={data.active ? 'ok' : 'muted'}>{data.active ? 'Activo' : 'Inactivo'}</Badge>}
    >
      {loading || !data ? <Spinner /> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
          <section>
            <div className="bo-field-label" style={{ marginBottom: 10 }}>Colocación y comisiones</div>
            <Defs className="cols-3">
              <DefRow k="Créditos colocados" v={count(data.originatedCredits)} />
              <DefRow k="Monto colocado" v={money(data.originatedAmount)} />
              <DefRow k="Créditos en mora" v={<span style={{ color: mora.length ? 'var(--bo-bad)' : undefined }}>{mora.length}</span>} />
              <DefRow k="Comisión devengada" v={money(data.commissionAccrued)} />
              <DefRow k="Comisión pagada" v={money(data.commissionPaid)} />
              <DefRow k="Comisión por liquidar" v={<b>{money(data.commissionAccrued - data.commissionPaid)}</b>} />
            </Defs>
          </section>

          <section>
            <div className="bo-field-label" style={{ marginBottom: 10 }}>Línea propia del distribuidor</div>
            {data.creditLineId ? (
              <Defs className="cols-3">
                <DefRow k="Cuenta" v={data.creditLineId} />
                <DefRow k="Límite" v={money(data.creditLineLimit ?? 0)} />
                <DefRow k="Disponible" v={money(data.creditLineAvailable ?? 0)} />
              </Defs>
            ) : (
              <div className="bo-page-sub">
                Este distribuidor origina crédito a terceros pero no tiene línea propia (DISTRIBUTOR_LINE) contratada.
              </div>
            )}
          </section>

          {/* The distributor's own statements: its line's (one per fortnightly cutoff, with the
              placements it billed) and, if it has one, its own-use credit's. Its clients' statements
              are in each client's file. */}
          <StatementsSection
            partyId={id}
            emptyHint="Este distribuidor aún no tiene estados de cuenta: se generan en cada corte de su línea"
          />

          {/* Her clients' payment receipts: one per client and statement of her line, without her discount. */}
          <ReceiptsSection
            partyId={id}
            emptyHint="Aún no hay recibos de sus clientes: se generan en cada corte de su línea"
          />

          <section>
            <div className="bo-field-label" style={{ marginBottom: 10 }}>Créditos originados ({data.credits.length})</div>
            <DataTable
              columns={creditColumns}
              rows={data.credits}
              rowKey={(c) => c.creditAccountId}
              emptyMessage="Este distribuidor todavía no ha originado créditos"
            />
          </section>
        </div>
      )}
    </Modal>
  );
}

export default App;
