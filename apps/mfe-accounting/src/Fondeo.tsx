import { useState } from 'react';
import {
  treasuryApi,
  type BankAccount, type FundingMovement, type FundingMovementInput, type FundingSource,
} from '@bo/api-client';
import { useCapabilities } from '@bo/auth';
import {
  useAsync, Badge, Button, CardTitled, DataTable, EmptyState, Field, Footnote, Modal, Select, StatCard, Stats,
  TextInput, date, money, type Column,
} from '@bo/design-system';

/**
 * Funding: where the money the institution lends comes from.
 *
 * A SOFOM ENR does not take deposits from the public (LIC arts. 2 and 103): it lends its capital and what financial
 * institutions or other entities lend it under a private contract. Each source names its counterparty with its RFC and
 * the document behind it, so the origin of the resources is identified. Recording a movement books it: a contribution
 * is equity (3101), a drawdown a liability (2201) whose interest accrues every day (5201 / 2202).
 */
const TIPO_MOVIMIENTO: Record<string, string> = {
  CONTRIBUTION: 'Aportación',
  DRAWDOWN: 'Disposición',
  OPENING_FEE: 'Comisión de apertura',
  INTEREST_ACCRUAL: 'Devengo de intereses',
  INTEREST_PAYMENT: 'Pago de intereses',
  PRINCIPAL_REPAYMENT: 'Pago de capital',
};

const CONTRAPARTE: Record<string, string> = {
  SHAREHOLDER: 'Accionista',
  BANK: 'Banco',
  DEVELOPMENT_BANK: 'Banca de desarrollo',
  OTHER_ENTITY: 'Otra entidad',
};

const pct = (r: number | null) => (r == null ? '—' : `${(r * 100).toFixed(2)} %`);
const hoy = () => new Date().toISOString().slice(0, 10);

export function Fondeo({ cuentas }: { cuentas: BankAccount[] }) {
  const { can } = useCapabilities();
  const puedeRegistrar = can('treasury.funding');
  const [version, setVersion] = useState(0);
  const fuentes = useAsync(() => treasuryApi.funding(), [version]);
  const [abierta, setAbierta] = useState<FundingSource | null>(null);
  const [alta, setAlta] = useState<'CAPITAL' | 'CREDIT_LINE' | null>(null);

  const rows = fuentes.data ?? [];
  const capital = rows.filter((f) => f.kind === 'CAPITAL').reduce((s, f) => s + f.contributed, 0);
  const dispuesto = rows.filter((f) => f.kind === 'CREDIT_LINE').reduce((s, f) => s + f.principal, 0);
  const intereses = rows.reduce((s, f) => s + f.interestPayable, 0);
  const disponible = rows.filter((f) => f.kind === 'CREDIT_LINE' && f.status === 'ACTIVE')
    .reduce((s, f) => s + f.available, 0);

  const columns: Array<Column<FundingSource>> = [
    {
      key: 'fuente', header: 'Fuente', render: (f) => (
        <div>
          <Badge tone={f.kind === 'CAPITAL' ? 'ok' : 'info'}>{f.kind === 'CAPITAL' ? 'Capital' : 'Línea de fondeo'}</Badge>
          <div className="bo-sub">{f.contractReference}</div>
        </div>
      ),
    },
    {
      key: 'contraparte', header: 'Contraparte', render: (f) => (
        <div>
          <b>{f.counterpartyName}</b>
          <div className="bo-sub">{CONTRAPARTE[f.counterpartyType] ?? f.counterpartyType} · RFC {f.counterpartyRfc}</div>
        </div>
      ),
    },
    { key: 'autorizado', header: 'Acordado / autorizado', align: 'right', render: (f) => money(f.authorizedAmount, true) },
    {
      key: 'saldo', header: 'Aportado / dispuesto', align: 'right',
      render: (f) => <b>{money(f.kind === 'CAPITAL' ? f.contributed : f.principal, true)}</b>,
    },
    {
      key: 'tasa', header: 'Tasa · intereses por pagar', align: 'right',
      render: (f) => (f.kind === 'CAPITAL' ? '—' : (
        <div>
          {pct(f.annualRate)} · {money(f.interestPayable, true)}
          <div className="bo-sub">{f.accruedThrough ? `devengado al ${date(f.accruedThrough)}` : 'sin devengo'}</div>
        </div>
      )),
    },
    {
      key: 'estado', header: 'Estado',
      render: (f) => <Badge tone={f.status === 'ACTIVE' ? 'ok' : 'muted'}>{f.status === 'ACTIVE' ? 'Vigente' : 'Cerrada'}</Badge>,
    },
  ];

  return (
    <>
      <CardTitled
        title="Fondeo"
        action={puedeRegistrar ? (
          <div style={{ display: 'flex', gap: 8 }}>
            <Button onClick={() => setAlta('CAPITAL')}>Registrar aportación de capital</Button>
            <Button onClick={() => setAlta('CREDIT_LINE')}>Registrar línea de fondeo</Button>
          </div>
        ) : undefined}
      >
        <div className="bo-card-pad">
          <Stats>
            <StatCard label="Capital aportado" value={money(capital, true)} sub="3101 Capital social pagado" />
            <StatCard label="Líneas dispuestas" value={money(dispuesto, true)} sub="2201 Préstamos de fondeo" />
            <StatCard label="Intereses por pagar" value={money(intereses, true)} sub="2202" />
            <StatCard label="Disponible en líneas" value={money(disponible, true)} />
          </Stats>
        </div>
        {fuentes.error ? (
          <EmptyState message={`No se pudo leer el fondeo: ${fuentes.error}`} />
        ) : (
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(f) => f.fundingSourceId}
            loading={fuentes.loading}
            onRowClick={(f) => setAbierta(f)}
            emptyMessage="No hay fondeo registrado: el dinero que se presta no tiene origen en los libros."
          />
        )}
        <div className="bo-card-pad">
          <Footnote>
            Una SOFOM ENR no capta del público: presta su capital y lo que le prestan instituciones financieras u otras
            entidades por contrato. Cada fuente lleva el RFC de su contraparte y su documento (acta de asamblea o
            contrato), y cada movimiento se asienta: la aportación en capital (3101), la disposición como pasivo (2201) y
            sus intereses como gasto de cada día (5201 / 2202).
          </Footnote>
        </div>
      </CardTitled>

      {abierta && (
        <Movimientos fuente={abierta} puedeRegistrar={puedeRegistrar} onClose={() => setAbierta(null)}
          onChange={() => setVersion((v) => v + 1)} />
      )}
      {alta && (
        <AltaFuente tipo={alta} cuentas={cuentas} onClose={() => setAlta(null)}
          onDone={() => { setAlta(null); setVersion((v) => v + 1); }} />
      )}
    </>
  );
}

function Movimientos({ fuente, puedeRegistrar, onClose, onChange }: {
  fuente: FundingSource; puedeRegistrar: boolean; onClose: () => void; onChange: () => void;
}) {
  const [version, setVersion] = useState(0);
  const movs = useAsync(() => treasuryApi.fundingMovements(fuente.fundingSourceId), [fuente.fundingSourceId, version]);
  const tipos: Array<FundingMovementInput['type']> = fuente.kind === 'CAPITAL'
    ? ['CONTRIBUTION']
    : ['DRAWDOWN', 'INTEREST_PAYMENT', 'PRINCIPAL_REPAYMENT', ...(fuente.openingFeePaid || !fuente.openingFee ? [] : ['OPENING_FEE' as const])];
  const [tipo, setTipo] = useState<FundingMovementInput['type']>(tipos[0]);
  const [monto, setMonto] = useState('');
  const [fecha, setFecha] = useState(hoy());
  const [referencia, setReferencia] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const registrar = async () => {
    setError(null);
    setGuardando(true);
    try {
      await treasuryApi.recordFunding(fuente.fundingSourceId, {
        type: tipo, valueDate: fecha, reference: referencia.trim(),
        amount: tipo === 'OPENING_FEE' ? undefined : Number(monto),
      });
      setMonto('');
      setReferencia('');
      setVersion((v) => v + 1);
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo registrar');
    } finally {
      setGuardando(false);
    }
  };

  const columns: Array<Column<FundingMovement>> = [
    { key: 'fecha', header: 'Fecha valor', render: (m) => date(m.valueDate) },
    {
      key: 'tipo', header: 'Movimiento', render: (m) => (
        <div>
          {TIPO_MOVIMIENTO[m.type] ?? m.type}
          <div className="bo-sub">
            {m.type === 'INTEREST_ACCRUAL' && m.accruedFrom ? `del ${date(m.accruedFrom)} al ${date(m.accruedThrough ?? m.valueDate)}` : m.reference}
          </div>
        </div>
      ),
    },
    { key: 'importe', header: 'Importe', align: 'right', render: (m) => money(m.amount, true) },
    {
      key: 'saldo', header: fuente.kind === 'CAPITAL' ? 'Aportado' : 'Capital · intereses', align: 'right',
      render: (m) => (fuente.kind === 'CAPITAL' ? money(m.contributedAfter, true)
        : `${money(m.principalAfter, true)} · ${money(m.interestPayableAfter, true)}`),
    },
  ];

  return (
    <Modal
      size="wide"
      title={fuente.counterpartyName}
      subtitle={`${fuente.kind === 'CAPITAL' ? 'Aportación de capital' : 'Línea de fondeo'} · ${fuente.contractReference}`}
      onClose={onClose}
    >
      {puedeRegistrar && fuente.status === 'ACTIVE' && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 16 }}>
          <Field label="Movimiento">
            <Select value={tipo} onChange={(v) => setTipo(v as FundingMovementInput['type'])}
              options={tipos.map((t) => ({ value: t, label: TIPO_MOVIMIENTO[t] }))} ariaLabel="Movimiento" />
          </Field>
          {tipo !== 'OPENING_FEE' && (
            <Field label="Importe"><TextInput value={monto} onChange={setMonto} type="number" placeholder="0.00" /></Field>
          )}
          <Field label="Fecha valor"><TextInput value={fecha} onChange={setFecha} type="date" /></Field>
          <Field label="Referencia (clave de rastreo o folio)">
            <TextInput value={referencia} onChange={setReferencia} placeholder="SPEI-…" />
          </Field>
          <Button variant="primary" disabled={guardando || !referencia.trim() || (tipo !== 'OPENING_FEE' && !(Number(monto) > 0))}
            onClick={() => void registrar()}>
            {guardando ? 'Registrando…' : 'Registrar'}
          </Button>
        </div>
      )}
      {error && <div className="bo-alert">{error}</div>}
      <DataTable columns={columns} rows={movs.data ?? []} rowKey={(m) => m.fundingMovementId} loading={movs.loading}
        emptyMessage="Sin movimientos todavía." />
    </Modal>
  );
}

function AltaFuente({ tipo, cuentas, onClose, onDone }: {
  tipo: 'CAPITAL' | 'CREDIT_LINE'; cuentas: BankAccount[]; onClose: () => void; onDone: () => void;
}) {
  const [nombre, setNombre] = useState('');
  const [rfc, setRfc] = useState('');
  const [documento, setDocumento] = useState('');
  const [cuenta, setCuenta] = useState(cuentas[0]?.bankAccountId ?? '');
  const [monto, setMonto] = useState('');
  const [inicio, setInicio] = useState(hoy());
  const [tasa, setTasa] = useState('');
  const [comision, setComision] = useState('0');
  const [vence, setVence] = useState('');
  const [contraparte, setContraparte] = useState<'BANK' | 'DEVELOPMENT_BANK' | 'OTHER_ENTITY' | 'SHAREHOLDER'>('BANK');
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const guardar = async () => {
    setError(null);
    setGuardando(true);
    try {
      if (tipo === 'CAPITAL') {
        await treasuryApi.registerCapital({ shareholderName: nombre, rfc, minutesReference: documento,
          bankAccountId: cuenta, subscribedAmount: Number(monto), agreedOn: inicio });
      } else {
        await treasuryApi.registerCreditLine({ lenderType: contraparte, lenderName: nombre, rfc,
          agreementReference: documento, bankAccountId: cuenta, authorizedAmount: Number(monto),
          annualRate: Number(tasa) / 100, openingFee: Number(comision || 0), startDate: inicio, maturityDate: vence });
      }
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo registrar');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal
      title={tipo === 'CAPITAL' ? 'Registrar aportación de capital' : 'Registrar línea de fondeo'}
      subtitle={tipo === 'CAPITAL' ? 'Lo que la asamblea de accionistas acordó aportar' : 'Lo que el contrato de crédito autoriza'}
      onClose={onClose}
      actions={<Button variant="primary" disabled={guardando} onClick={() => void guardar()}>{guardando ? 'Registrando…' : 'Registrar'}</Button>}
    >
      <div style={{ display: 'grid', gap: 12 }}>
        {tipo === 'CREDIT_LINE' && (
          <Field label="Tipo de acreditante">
            <Select value={contraparte} onChange={(v) => setContraparte(v as typeof contraparte)} ariaLabel="Tipo de acreditante"
              options={['BANK', 'DEVELOPMENT_BANK', 'OTHER_ENTITY', 'SHAREHOLDER'].map((c) => ({ value: c, label: CONTRAPARTE[c] }))} />
          </Field>
        )}
        <Field label={tipo === 'CAPITAL' ? 'Accionista(s)' : 'Acreditante'} required><TextInput value={nombre} onChange={setNombre} /></Field>
        <Field label="RFC de la contraparte" required hint="Identifica el origen de los recursos (PLD)"><TextInput value={rfc} onChange={setRfc} /></Field>
        <Field label={tipo === 'CAPITAL' ? 'Acta de asamblea' : 'Contrato de crédito'} required><TextInput value={documento} onChange={setDocumento} /></Field>
        <Field label="Cuenta propia que recibe">
          <Select value={cuenta} onChange={setCuenta} ariaLabel="Cuenta propia"
            options={cuentas.map((c) => ({ value: c.bankAccountId, label: `${c.bankName} · ${c.clabeMasked ?? ""}` }))} />
        </Field>
        <Field label={tipo === 'CAPITAL' ? 'Capital acordado' : 'Monto autorizado'} required>
          <TextInput value={monto} onChange={setMonto} type="number" />
        </Field>
        <Field label={tipo === 'CAPITAL' ? 'Fecha del acuerdo' : 'Fecha del contrato'} required>
          <TextInput value={inicio} onChange={setInicio} type="date" />
        </Field>
        {tipo === 'CREDIT_LINE' && (
          <>
            <Field label="Tasa anual (%)" required><TextInput value={tasa} onChange={setTasa} type="number" /></Field>
            <Field label="Comisión de apertura" hint="Costo de la transacción: se amortiza en la vida de la línea">
              <TextInput value={comision} onChange={setComision} type="number" />
            </Field>
            <Field label="Vencimiento" required><TextInput value={vence} onChange={setVence} type="date" /></Field>
          </>
        )}
        {error && <div className="bo-alert">{error}</div>}
      </div>
    </Modal>
  );
}
