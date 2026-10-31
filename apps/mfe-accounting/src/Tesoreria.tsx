import { useEffect, useMemo, useState } from 'react';
import {
  treasuryApi,
  type BankAccount, type Disbursement, type PayoutRoute,
} from '@bo/api-client';
import {
  useAsync, PageHeader, CardTitled, DataTable, Badge, Block, Button, Chip, Footnote,
  SearchInput, StatCard, Stats, Toolbar,
  count, date, money, type Column,
} from '@bo/design-system';
import {
  DISPERSION_TERMINAL, ESTADO_CUENTA_BANCARIA, VIA_PAGO,
  estadoDispersion, periodoLabel,
} from './lenguaje';
import { DispersionModal } from './DispersionModal';

/** Cuántas dispersiones se leen para las cifras de arriba. Ver `resumen` sobre por qué no es todo. */
const MUESTRA = 200;

/** `YYYYMM` del instante, en el huso de quien mira: es el mes que la persona tiene en la cabeza. */
function periodoDe(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const mono = { fontFamily: 'var(--bo-mono)', fontSize: 12 } as const;

/**
 * Las celdas de texto largo se dejan partir en dos renglones. La tabla no parte por defecto, y una
 * razón social completa empujaba el estatus —la columna que se viene a leer— fuera de la pantalla.
 */
const parte = (max: number) => ({ whiteSpace: 'normal', maxWidth: max }) as const;

/** La hora sola, para el segundo renglón de la fecha. */
function hora(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false });
}

/**
 * Bancos y tesorería: por dónde sale el dinero y qué pasó con cada SPEI.
 *
 * <p>La pregunta que trae a alguien aquí casi nunca es contable. Es «¿ya le llegó su dinero?», y
 * llega por teléfono con un nombre o una clave de rastreo en la mano. Por eso la búsqueda acepta
 * las dos y la tabla enseña la clave completa: es lo que se le dicta al banco receptor.
 *
 * <p>Las cuentas van primero porque son el puente con contabilidad: cada una dice a qué cuenta del
 * mayor pega. Un SPEI que sale por una cuenta sin cuenta contable es dinero que el mayor no ve.
 *
 * <p>Vive en el módulo de contabilidad y no en uno propio porque se concilia contra él: la póliza
 * de egreso dice que salieron $45,000; esta pantalla dice si de verdad salieron, por dónde y si el
 * banco ya lo reporta. Tenerlas en módulos distintos obligaría a llevar la cifra de uno a otro.
 */
export function Tesoreria({ periodo }: { periodo?: string }) {
  const cuentas = useAsync(() => treasuryApi.bankAccounts(), []);
  const rutas = useAsync(() => treasuryApi.payoutRoutes(), []);

  const [texto, setTexto] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [abierta, setAbierta] = useState<Disbursement | null>(null);

  // La búsqueda va al servidor; mandarla por tecla sería una petición por letra de un nombre.
  useEffect(() => {
    const t = setTimeout(() => { setQ(texto.trim()); setPage(0); }, 350);
    return () => clearTimeout(t);
  }, [texto]);

  const state = useAsync(
    () => treasuryApi.disbursements({ q: q || undefined, page, size: 20 }),
    [q, page],
  );

  // Las cifras salen de una lectura aparte y sin búsqueda: si siguieran al buscador, al buscar a
  // una persona dirían que el mes dispersó lo que le tocó a ella. Se acota a las más recientes
  // porque el BFF no publica un agregado de tesorería; cuando la muestra no alcanza, se dice.
  const universo = useAsync(() => treasuryApi.disbursements({ size: MUESTRA }), []);

  // El mes es el del período contable abierto cuando lo hay —el mismo que mira el resto del
  // módulo— y si no, el del calendario: operación ve tesorería sin ver el mayor.
  const mes = periodo || periodoDe(new Date().toISOString());

  const resumen = useMemo(() => {
    const filas = universo.data?.content ?? [];
    const delMes = filas.filter((d) => periodoDe(d.createdAt) === mes);
    const liquidadas = delMes.filter((d) => d.status === 'SETTLED');
    const enVuelo = filas.filter((d) => !DISPERSION_TERMINAL.has(String(d.status)));
    return {
      delMes: delMes.length,
      monto: liquidadas.reduce((s, d) => s + d.amount, 0),
      liquidadas: liquidadas.length,
      pendientes: enVuelo.length,
      montoPendiente: enVuelo.reduce((s, d) => s + d.amount, 0),
      parcial: (universo.data?.totalElements ?? 0) > filas.length,
    };
  }, [universo.data, mes]);

  // Ordenante es la cuenta por la que **puede salir** un pago: activa y con proveedor que lo
  // ejecute. Una concentradora activa recibe cobranza, pero no dispersa.
  const ordenantes = (cuentas.data ?? []).filter((c) => c.status === 'ACTIVE' && c.provider);
  const muestra = resumen.parcial ? ` · en las ${MUESTRA} más recientes` : '';

  const columnasCuenta: Array<Column<BankAccount>> = [
    {
      key: 'banco', header: 'Banco',
      render: (c) => (
        <div>
          <b>{c.bankName}</b>
          <div className="bo-sub">
            {c.provider && c.status === 'ACTIVE' ? 'Cuenta ordenante' : c.provider ? 'Ordenante fuera de ruteo' : 'Sólo recibe'}
            {c.bankCode ? ` · clave ${c.bankCode}` : ''}
          </div>
        </div>
      ),
    },
    { key: 'clabe', header: 'CLABE', render: (c) => <span style={mono}>{c.clabeMasked ?? '—'}</span> },
    { key: 'titular', header: 'Titular', render: (c) => <div style={{ ...parte(220), fontSize: 12.5 }}>{c.holderName ?? '—'}</div> },
    {
      key: 'mayor', header: 'Cuenta contable',
      // Es la columna que une las dos pantallas: lo que sale por esta cuenta es lo que la póliza
      // abona a esta cuenta del mayor. Sin ella, cuadrar tesorería contra la balanza es de memoria.
      render: (c) => c.ledgerAccountCode
        ? <span><b style={mono}>{c.ledgerAccountCode}</b> · {c.ledgerAccountName ?? ''}</span>
        : <span style={{ color: 'var(--bo-bad)' }}>Sin cuenta contable</span>,
    },
    {
      key: 'proveedor', header: 'Proveedor',
      render: (c) => c.provider ?? <span className="bo-sub">no dispersa</span>,
    },
    {
      key: 'estatus', header: 'Estatus',
      render: (c) => {
        const e = ESTADO_CUENTA_BANCARIA[String(c.status)] ?? { texto: String(c.status), tono: 'muted' as const };
        return <Chip tone={e.tono}>{e.texto}</Chip>;
      },
    },
  ];

  const columnasRuta: Array<Column<PayoutRoute>> = [
    { key: 'via', header: 'Vía', render: (r) => <b>{VIA_PAGO[String(r.rail)] ?? r.rail}</b> },
    { key: 'proveedor', header: 'Proveedor', render: (r) => r.provider },
    {
      key: 'rango', header: 'Rango por pago', align: 'right',
      render: (r) => (
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>
          {money(r.minAmount ?? 0, true)} – {r.maxAmount == null ? 'sin tope' : money(r.maxAmount, true)}
        </span>
      ),
    },
    {
      key: 'prioridad', header: 'Prioridad', align: 'right',
      render: (r) => <span title="Entre las rutas que admiten el monto, gana la de número menor">{r.priority}</span>,
    },
    {
      key: 'estatus', header: 'Estatus',
      render: (r) => <Chip tone={r.active ? 'ok' : 'muted'}>{r.active ? 'Activa' : 'Inactiva'}</Chip>,
    },
  ];

  const columnasDispersion: Array<Column<Disbursement>> = [
    {
      key: 'fecha', header: 'Fecha',
      render: (d) => (
        <div>
          <span style={{ fontSize: 12.5 }}>{date(d.createdAt)}</span>
          <div className="bo-sub">{hora(d.createdAt)}</div>
        </div>
      ),
    },
    {
      key: 'beneficiario', header: 'Beneficiario',
      render: (d) => (
        <div style={parte(230)}>
          <b>{d.beneficiaryName ?? 'Sin nombre'}</b>
          <div className="bo-sub">{VIA_PAGO[String(d.rail)] ?? d.rail}{d.provider ? ` · ${d.provider}` : ''}</div>
        </div>
      ),
    },
    {
      key: 'clabe', header: 'CLABE destino',
      // Enmascarada desde el servicio: es dato de alguien que muchas veces no es cliente de la casa.
      render: (d) => <span style={mono}>{d.beneficiaryClabeMasked ?? '—'}</span>,
    },
    { key: 'monto', header: 'Monto', align: 'right', render: (d) => <b>{money(d.amount, true)}</b> },
    {
      key: 'clave', header: 'Clave de rastreo',
      // Completa y en monoespaciada: es lo que se le dicta al banco receptor, letra por letra.
      render: (d) => d.trackingKey
        ? <span style={mono}>{d.trackingKey}</span>
        : <span className="bo-sub">{DISPERSION_TERMINAL.has(String(d.status)) ? 'no registrada' : 'sin clave todavía'}</span>,
    },
    {
      key: 'estatus', header: 'Estatus',
      render: (d) => {
        const e = estadoDispersion(d.status);
        return (
          <div>
            <Badge tone={e.tono}>{e.texto}</Badge>
            {d.status === 'ACCEPTED' && <div className="bo-sub">falta el abono</div>}
            {d.settledAt && d.status === 'SETTLED' && <div className="bo-sub">{hora(d.settledAt)}</div>}
          </div>
        );
      },
    },
  ];

  const datos = state.data;

  return (
    <div>
      <PageHeader
        title="Bancos y tesorería"
        subtitle="Por dónde sale el dinero: las cuentas propias y la cuenta del mayor que las refleja, las rutas de pago y cada SPEI con su clave de rastreo, de la disposición a la póliza."
      />

      <Stats>
        <StatCard
          label="Cuentas ordenantes activas"
          value={cuentas.data ? count(ordenantes.length) : '…'}
          sub={cuentas.data
            ? `de ${count(cuentas.data.length)} cuentas propias · por donde puede salir un pago`
            : 'cargando cuentas'}
          tone={cuentas.data && ordenantes.length === 0 ? 'bad' : undefined}
        />
        <StatCard
          label="Dispersiones del periodo"
          value={universo.data ? count(resumen.delMes) : '…'}
          sub={`${periodoLabel(mes)}${muestra}`}
        />
        <StatCard
          label="Monto dispersado"
          value={universo.data ? money(resumen.monto) : '…'}
          sub={`${count(resumen.liquidadas)} liquidadas en ${periodoLabel(mes)} · sólo lo que el banco abonó`}
        />
        <StatCard
          label="Pendientes de liquidar"
          value={universo.data ? count(resumen.pendientes) : '…'}
          tone={resumen.pendientes > 0 ? 'warn' : undefined}
          sub={resumen.pendientes > 0
            ? `${money(resumen.montoPendiente)} en vuelo · aceptada no es depositada`
            : 'todo lo enviado ya se liquidó o terminó'}
        />
      </Stats>

      <CardTitled
        title="Cuentas bancarias"
        action={<span className="bo-page-sub">Cada cuenta propia y la cuenta del mayor a la que pega</span>}
      >
        <Block state={cuentas} emptyLabel="No hay cuentas bancarias dadas de alta." isEmpty={(d) => d.length === 0}>
          {(filas) => (
            <DataTable
              columns={columnasCuenta}
              rows={filas}
              rowKey={(c) => c.bankAccountId}
            />
          )}
        </Block>
      </CardTitled>

      <div style={{ marginTop: 16 }}>
        <CardTitled
          title="Rutas de pago"
          action={<span className="bo-page-sub">Por qué vía sale un pago según su monto</span>}
        >
          <Block state={rutas} emptyLabel="No hay rutas de pago configuradas: ningún pago puede salir." isEmpty={(d) => d.length === 0}>
            {(filas) => (
              <DataTable
                columns={columnasRuta}
                rows={[...filas].sort((a, b) => a.priority - b.priority)}
                rowKey={(r) => r.routeId}
              />
            )}
          </Block>
        </CardTitled>
      </div>

      <div style={{ marginTop: 16 }}>
        <CardTitled
          title={`Dispersiones SPEI${datos ? ` · ${count(datos.totalElements)}` : ''}`}
          action={<span className="bo-page-sub">Abre una para ver su recorrido, la orden en STP y su póliza</span>}
        >
          <div className="bo-card-pad" style={{ paddingBottom: 0 }}>
            <Toolbar>
              <SearchInput
                value={texto}
                onChange={setTexto}
                onClear={() => setTexto('')}
                placeholder="Beneficiario o clave de rastreo"
                ariaLabel="Buscar dispersión por beneficiario o clave de rastreo"
              />
            </Toolbar>
          </div>
          <Block state={state} emptyLabel="Todavía no sale ningún SPEI.">
            {(p) => (
              <>
                <DataTable
                  columns={columnasDispersion}
                  rows={p.content}
                  rowKey={(d) => d.disbursementId}
                  onRowClick={setAbierta}
                  emptyMessage={q ? 'Ninguna dispersión coincide con esa búsqueda.' : 'Todavía no sale ningún SPEI.'}
                />
                {p.totalPages > 1 && (
                  <div className="bo-card-pad" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <Button disabled={page <= 0} onClick={() => setPage(page - 1)}>Anterior</Button>
                    <span className="bo-sub">Página {page + 1} de {p.totalPages}</span>
                    <Button disabled={page + 1 >= p.totalPages} onClick={() => setPage(page + 1)}>
                      Siguiente
                    </Button>
                  </div>
                )}
              </>
            )}
          </Block>
        </CardTitled>
      </div>

      <Footnote>
        Las cuentas y las rutas las publica <b>banking-service</b>; cada SPEI, <b>disbursement-service</b>,
        y su orden con la clave de rastreo y el CEP, <b>stp-service</b>. <b>Aceptada no es
        liquidada</b>: STP acepta la orden en segundos, y sólo «Liquidada» afirma que el banco
        receptor abonó. El monto dispersado suma sólo lo liquidado. Las CLABE llegan enmascaradas del
        servicio y la consola no puede recomponerlas.
      </Footnote>

      {abierta && (
        <DispersionModal
          key={abierta.disbursementId}
          fila={abierta}
          cuentas={cuentas.data ?? []}
          onClose={() => setAbierta(null)}
        />
      )}
    </div>
  );
}
