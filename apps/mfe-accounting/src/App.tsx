import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  accountingApi, isMock,
  type AccountingPeriod, type Invoice, type InvoicesQuery, type InvoiceStatus,
  type LoanMovement,
  type TrialBalanceRow, type UnitAccounting, type Voucher,
} from '@bo/api-client';
import { useCapabilities } from '@bo/auth';
import {
  ensureThemeStyles, useAsync, useVista, PageHeader, Card, CardTitled, DataTable, Badge, Button,
  Field, Select, TextInput, EmptyState, Tabs, KpiCard, BarList,
  Collapsible, money, count, date, type Column,
} from '@bo/design-system';
import {
  ESTADO_FACTURA, ESTADO_PERIODO, NATURALEZA, TIPO_POLIZA,
  folioCompleto, hechoLabel, periodoLabel, plural, responsableLabel, saldoPresentado,
  sucursalLabel, tonoFactura, tonoTipo,
} from './lenguaje';
import { Reconciliacion } from './Reconciliacion';
import { PolizaModal } from './PolizaModal';
import { FacturaModal } from './FacturaModal';
import { PrestamoModal } from './PrestamoModal';
import { Tesoreria } from './Tesoreria';

ensureThemeStyles();

type Vista = 'resumen' | 'polizas' | 'facturas' | 'balanza' | 'tesoreria';
const VISTAS: readonly Vista[] = ['resumen', 'polizas', 'facturas', 'balanza', 'tesoreria'];

/** Lo que el usuario tiene abierto encima de la tabla. Uno a la vez, y se apilan al navegar. */
type Detalle =
  | { tipo: 'poliza'; id: string }
  | { tipo: 'factura'; id: string }
  | { tipo: 'prestamo'; id: string };

/**
 * Contabilidad: pólizas, balanza y facturas, con la sucursal y el préstamo como ejes.
 *
 * <p>El período manda sobre todo lo demás y por eso vive aquí arriba, fuera de las pestañas: si
 * cada vista llevara el suyo, comparar el resumen contra la balanza obligaría a acordarse de mover
 * dos selectores, y la primera vez que se olvide uno la conclusión será que la contabilidad no
 * cuadra.
 *
 * <p>La navegación es circular a propósito —póliza → préstamo → póliza, factura → préstamo →
 * factura—, porque conciliar es justamente ir y volver entre esas tres cosas. Cerrar el detalle
 * devuelve a la tabla, no al principio.
 *
 * <p>Cada vista tiene su propia ruta (`/contabilidad/balanza`) para poder mandarle a alguien el
 * enlace de lo que se está mirando. El período **no** viaja en la ruta: es el eje del módulo
 * entero, y el shell mantiene el remote vivo al cambiar de pantalla justamente para que ir de
 * pólizas a balanza no devuelva al mes por defecto a media conciliación.
 */
export function App({ vista: vistaRuta }: { vista?: string } = {}) {
  const [vista, setVista] = useVista<Vista>(vistaRuta, VISTAS, 'resumen');
  const [periodo, setPeriodo] = useState<string>('');
  const [detalle, setDetalle] = useState<Detalle | null>(null);
  const [operando, setOperando] = useState<string | null>(null);
  const [reconciliando, setReconciliando] = useState(false);
  const [aviso, setAviso] = useState<{ tono: 'ok' | 'bad'; texto: string } | null>(null);

  // Cerrar y reabrir mueven el corte contable: el BFF los exige con `accounting.close`, que un
  // auditor no tiene a propósito —auditar no puede implicar poder mover el corte de lo que se
  // está auditando—. Se comprueba aquí sólo para no ofrecer un botón que va a contestar 403.
  const { can } = useCapabilities();
  const puedeCerrar = can('accounting.close');
  const puedeVerMayor = can('accounting.view');

  // Tesorería se abre con `treasury.view`, que operación tiene sin tener el mayor. Pedirle los
  // períodos a quien no puede leerlos sería un 403 seguro, y cada 403 queda en la bitácora como un
  // intento denegado que nadie hizo a propósito.
  const periodos = useAsync(
    () => (puedeVerMayor ? accountingApi.periods() : Promise.resolve([] as AccountingPeriod[])),
    [puedeVerMayor],
  );

  // El período abierto es el que se está trabajando; es el que hay que ver al entrar. Arrancar en
  // el más reciente cerrado mostraría un mes que ya nadie toca.
  useEffect(() => {
    if (periodo || !periodos.data?.length) return;
    setPeriodo(periodos.data.find((p) => p.status === 'OPEN')?.period ?? periodos.data[0].period);
  }, [periodos.data, periodo]);

  const actual: AccountingPeriod | undefined =
    periodos.data?.find((p) => p.period === periodo);

  const abrirPrestamo = useCallback((id: string) => setDetalle({ tipo: 'prestamo', id }), []);
  const abrirPoliza = useCallback((id: string) => setDetalle({ tipo: 'poliza', id }), []);
  const abrirFactura = useCallback((id: string) => setDetalle({ tipo: 'factura', id }), []);

  /**
   * Las operaciones que mueven el período: cerrarlo, reabrirlo y disparar la corrida de timbrado.
   *
   * Todas recargan la lista de períodos al terminar, porque las tres cambian lo que la pantalla
   * afirma —el estado del corte o cuántas facturas quedan por timbrar— y dejar el encabezado
   * diciendo «Abierto» después de cerrarlo invita a cerrarlo dos veces.
   */
  const operar = useCallback(async (
    clave: string,
    fn: () => Promise<unknown>,
    exito: (r: never) => string,
  ) => {
    setOperando(clave);
    setAviso(null);
    try {
      const r = await fn();
      setAviso({ tono: 'ok', texto: exito(r as never) });
      periodos.reload();
    } catch (e) {
      setAviso({ tono: 'bad', texto: e instanceof Error ? e.message : 'No se pudo completar' });
    } finally {
      setOperando(null);
    }
  }, [periodos]);

  const cerrado = actual?.status === 'CLOSED';

  // Tesorería es otra pantalla, con su propio encabezado y sin el selector de período: el dinero
  // que sale no espera al cierre. Se resuelve aquí, después de todos los hooks, para que el módulo
  // siga vivo —y con su período— al ir y volver entre tesorería y pólizas.
  if (vista === 'tesoreria') {
    return <Tesoreria periodo={periodos.data?.find((p) => p.status === 'OPEN')?.period} />;
  }

  return (
    <div>
      <PageHeader
        title="Contabilidad"
        subtitle="Pólizas del ciclo de vida del préstamo, por sucursal y por crédito. La sucursal se sella al activar el préstamo y no cambia aunque la cartera se reasigne."
        actions={
          <>
            <Field label="Período contable">
              <Select
                value={periodo}
                onChange={setPeriodo}
                disabled={!periodos.data?.length}
                ariaLabel="Período contable"
                options={(periodos.data ?? []).map((p) => ({
                  value: p.period,
                  label: `${periodoLabel(p.period)} · ${ESTADO_PERIODO[p.status]}`,
                }))}
              />
            </Field>
            {/* El timbrado corre solo al cierre de cada día; esto lo adelanta para el período que
                se está mirando. Va junto a Facturas porque es donde se ve qué queda pendiente. */}
            {puedeCerrar && periodo && vista === 'facturas' && !cerrado && (
              <Button
                disabled={operando != null}
                title="Pide a invoicing-service que timbre lo que quede pendiente de este período"
                onClick={() => void operar('timbrado',
                  () => accountingApi.runBilling(periodo),
                  (r: { invoicesRequested: number }) =>
                    `Se solicitaron ${count(r.invoicesRequested)} timbrados. El resultado tarda: vuelve a consultar en unos minutos.`)}
              >
                {operando === 'timbrado' ? 'Solicitando…' : 'Timbrar pendientes'}
              </Button>
            )}
            {puedeCerrar && periodo && (cerrado ? (
              <Button
                disabled={operando != null}
                title="Vuelve a admitir asientos en este mes. Queda en bitácora."
                onClick={() => void operar('reabrir',
                  () => accountingApi.reopenPeriod(periodo),
                  () => `${periodoLabel(periodo)} vuelve a estar abierto.`)}
              >
                {operando === 'reabrir' ? 'Reabriendo…' : 'Reabrir período'}
              </Button>
            ) : (
              <Button
                variant="primary"
                disabled={operando != null}
                title="Publica los números del mes. Lo que llegue después se asienta en el primer período abierto, marcado como extemporáneo."
                onClick={() => void operar('cerrar',
                  () => accountingApi.closePeriod(periodo),
                  () => `${periodoLabel(periodo)} queda cerrado.`)}
              >
                {operando === 'cerrar' ? 'Cerrando…' : 'Cerrar período'}
              </Button>
            ))}
          </>
        }
      />

      {aviso && (
        <div
          className="bo-alert"
          style={aviso.tono === 'ok'
            ? { background: 'var(--bo-ok-soft)', color: 'var(--bo-ok)' }
            : undefined}
        >
          {aviso.texto}
        </div>
      )}

      {cerrado && (
        <div className="bo-alert bo-huerfanos">
          <b>Período cerrado.</b> Lo que se ve aquí ya no cambia. Un hecho de este mes que llegue
          tarde se asienta en el primer período abierto y queda marcado como extemporáneo, con el
          mes al que pertenecía a la vista.
        </div>
      )}

      <Tabs
        value={vista}
        onChange={setVista}
        tabs={[
          // Los mismos nombres que en el menú: una pestaña que se llama distinto que el enlace
          // que lleva a ella hace dudar de si son la misma pantalla.
          { value: 'resumen', label: 'Resumen general', icon: '📊' },
          { value: 'polizas', label: 'Pólizas', icon: '📒' },
          { value: 'facturas', label: 'Facturas', icon: '🧾' },
          { value: 'balanza', label: 'Balanza', icon: '⚖️' },
        ]}
      />

      {!periodo ? (
        <div style={{ marginTop: 16 }}>
          <Card>
            <EmptyState
              message={periodos.error
                ? `No se pudieron cargar los períodos contables: ${periodos.error}`
                : 'Cargando períodos contables…'}
            />
          </Card>
        </div>
      ) : (
        <>
          {vista === 'resumen' && <Resumen periodo={periodo} />}
          {vista === 'polizas' && (
            <Polizas
              periodo={periodo}
              onAbrir={abrirPoliza}
              onAbrirFactura={abrirFactura}
              onAbrirPrestamo={abrirPrestamo}
            />
          )}
          {vista === 'facturas' && (
            <Facturas periodo={periodo} onAbrir={abrirFactura} />
          )}
          {vista === 'balanza' && <Balanza periodo={periodo} />}
        </>
      )}

      {/* Se ofrece con `accounting.close` y no con `accounting.view`: escribe, y reatribuir de qué
          sucursal es un ingreso no es algo que deba poder hacer quien sólo audita. El BFF hoy la
          deja pasar con `view` —cae en el matcher genérico de `/accounting/**`—, así que esto es
          una cortesía de la consola y no la puerta. */}
      <AvisoDeAlcance onReconciliar={puedeCerrar ? () => setReconciliando(true) : undefined} />

      {reconciliando && (
        <Reconciliacion
          onCerrar={() => setReconciliando(false)}
          onAplicado={() => { periodos.reload(); }}
        />
      )}

      {detalle?.tipo === 'poliza' && (
        <PolizaModal
          voucherId={detalle.id}
          onClose={() => setDetalle(null)}
          onAbrirPrestamo={abrirPrestamo}
        />
      )}
      {detalle?.tipo === 'factura' && (
        <FacturaModal
          invoiceId={detalle.id}
          onClose={() => setDetalle(null)}
          onAbrirPrestamo={abrirPrestamo}
        />
      )}
      {detalle?.tipo === 'prestamo' && (
        <PrestamoModal
          creditAccountId={detalle.id}
          onClose={() => setDetalle(null)}
          onAbrirPoliza={abrirPoliza}
          onAbrirFactura={abrirFactura}
        />
      )}
    </div>
  );
}

/**
 * De dónde salen estos números.
 *
 * En vivo los contesta el BFF contra `accounting-service` e `invoicing-service`; en mock, un dataset
 * que deriva la balanza y el resumen de las mismas pólizas. Decir cuál de los dos se está viendo
 * evita la confusión más cara de este módulo: tomar cifras de demostración por cifras de la
 * institución.
 */
function AvisoDeAlcance({ onReconciliar }: { onReconciliar?: () => void }) {
  if (!isMock()) {
    return (
      <p className="bo-sub" style={{ marginTop: 18 }}>
        Los créditos anteriores al sellado de la sucursal aparecen bajo «Sin sucursal» hasta que se
        corra la reconciliación
        {onReconciliar && (
          <>
            {' — '}
            {/* La nota lo decía desde hace tiempo y no había forma de corregirlo desde la consola:
                había que pedirle a alguien que llamara al endpoint a mano. */}
            <button
              type="button"
              className="bo-crumb"
              style={{ color: 'var(--bo-primary)', textDecoration: 'underline' }}
              onClick={onReconciliar}
            >
              correrla ahora
            </button>
          </>
        )}
        . El timbrado de este entorno es simulado: los folios fiscales no son válidos ante el SAT.
      </p>
    );
  }
  return (
    <p className="bo-sub" style={{ marginTop: 18 }}>
      Datos de demostración: el dataset deriva la balanza y el resumen de las mismas pólizas, así
      que lo que cuadra aquí cuadra por construcción y no por transcripción.
    </p>
  );
}

// ── Resumen general ────────────────────────────────────────────────────────

/**
 * El panorama del período y su desglose por sucursal.
 *
 * <p>El cuadre va primero y en grande porque es la única pregunta que puede invalidar todo lo
 * demás: una balanza descuadrada no es un número peor, es que ningún número de esta pantalla se
 * puede usar. Ponerlo al final, entre otras seis cifras, lo convierte en un detalle.
 */
function Resumen({ periodo }: { periodo: string }) {
  const state = useAsync(() => accountingApi.summary(periodo), [periodo]);
  const s = state.data;

  const columns: Array<Column<UnitAccounting>> = [
    {
      key: 'sucursal',
      header: 'Sucursal',
      render: (u) => (
        <div>
          <b>{sucursalLabel(u.orgUnitName)}</b>
          <div className="bo-sub">{responsableLabel(u.orgUnitManager)}</div>
        </div>
      ),
    },
    { key: 'polizas', header: 'Pólizas', align: 'right', render: (u) => count(u.vouchers) },
    { key: 'creditos', header: 'Créditos', align: 'right', render: (u) => count(u.loans) },
    { key: 'cargos', header: 'Cargos', align: 'right', render: (u) => money(u.totalDebit, true) },
    { key: 'abonos', header: 'Abonos', align: 'right', render: (u) => money(u.totalCredit, true) },
    {
      key: 'devengo',
      header: 'Devengado',
      align: 'right',
      render: (u) => (
        <div>
          {money(u.accruedInterest, true)}
          {u.moratoriumInterest > 0 && (
            <div className="bo-sub">+ {money(u.moratoriumInterest, true)} moratorio</div>
          )}
        </div>
      ),
    },
    {
      key: 'provision',
      header: 'Estimación',
      align: 'right',
      render: (u) => u.provision === 0
        ? <span className="bo-sub">—</span>
        : <span style={{ color: u.provision > 0 ? 'var(--bo-bad)' : 'var(--bo-ok)' }}>
            {money(u.provision, true)}
          </span>,
    },
  ];

  const barras = useMemo(
    () => (s?.byUnit ?? [])
      .filter((u) => u.accruedInterest + u.moratoriumInterest + u.fees > 0)
      .map((u) => ({
        label: u.orgUnitName,
        value: u.accruedInterest + u.moratoriumInterest + u.fees,
        sub: plural(u.loans, 'crédito', 'créditos'),
      })),
    [s?.byUnit],
  );

  if (state.error) {
    return (
      <div style={{ marginTop: 16 }}>
        <Card><EmptyState message={`No se pudo cargar el resumen: ${state.error}`} /></Card>
      </div>
    );
  }
  if (!s) {
    return (
      <div style={{ marginTop: 16 }}>
        <Card><EmptyState message="Cargando el resumen del período…" /></Card>
      </div>
    );
  }

  return (
    <>
      <div className="bo-kpis" style={{ marginTop: 16 }}>
        <KpiCard
          label="Cuadre del período"
          value={s.balanced ? 'Cuadra' : 'No cuadra'}
          delta={s.balanced
            ? `${money(s.totalDebit, true)} en cargos y en abonos`
            : `Diferencia de ${money(Math.abs(s.totalDebit - s.totalCredit), true)}`}
          deltaTone={s.balanced ? 'ok' : 'bad'}
          icon="⚖️"
        />
        <KpiCard
          label="Pólizas del período"
          value={count(s.vouchers)}
          delta={plural(s.loansRegistered, 'alta de préstamo', 'altas de préstamo')}
        />
        <KpiCard
          label="Devengado"
          value={money(s.accruedInterest + s.moratoriumInterest)}
          delta={s.moratoriumInterest > 0
            ? `${money(s.moratoriumInterest)} de moratorios`
            : 'sin moratorios en el período'}
          deltaTone={s.moratoriumInterest > 0 ? 'warn' : 'muted'}
          icon="📈"
        />
        <KpiCard
          label="Comisiones"
          value={money(s.fees)}
          delta="apertura, administración y prepago"
        />
        <KpiCard
          // Movimiento neto: se constituye reserva y se consume al quebrantar. Negativo no es un
          // error, es que el quebranto del mes consumió más reserva de la que se constituyó — y
          // mostrarlo en valor absoluto escondería justo eso.
          label="Estimación preventiva"
          value={money(s.provision)}
          delta={s.provision < 0
            ? `neto: se consumió más de lo constituido${s.writeOff > 0 ? ` · ${money(s.writeOff)} de quebranto a resultados` : ''}`
            : s.writeOff > 0 ? `${money(s.writeOff)} de quebranto a resultados` : 'constituida en el período'}
          deltaTone={s.writeOff > 0 ? 'bad' : 'muted'}
          icon="🛡️"
        />
        <KpiCard
          // El cuadre de arriba dice que la partida doble está bien; éste dice si lo que se
          // devengó acabó facturado, que es la otra pregunta que se le hace al mes y la que
          // detecta una corrida de facturación que no se hizo.
          label="Conciliación de facturación"
          value={s.billingReconciled ? 'Concilia' : 'No concilia'}
          delta={s.billingReconciled
            ? `${money(s.invoiced, true)} facturado en ${count(s.invoiceCount)} CFDI`
            : s.billingDifference > 0
              ? `${money(s.billingDifference)} devengado sin facturar`
              : `${money(Math.abs(s.billingDifference))} facturado de más`}
          deltaTone={s.billingReconciled ? 'ok' : 'bad'}
          icon="🧾"
        />
      </div>

      {/* La conciliación del período, desglosada. Son dos preguntas distintas y las dos importan:
          el cuadre dice que la partida doble está bien; esto dice que lo devengado acabó cobrable.
          Un mes puede cuadrar perfecto y no haber facturado nada. */}
      <div style={{ marginTop: 16 }}>
        <CardTitled title={`Conciliación de facturación · ${periodoLabel(periodo)}`}>
          <div className="bo-card-pad">
            <div className="bo-totales-grid" style={{ maxWidth: 680 }}>
              <div className="bo-totales-fila">
                <span>Interés devengado</span><b>{money(s.accruedInterest, true)}</b>
              </div>
              {s.moratoriumInterest > 0 && (
                <div className="bo-totales-fila">
                  <span>Interés moratorio</span><b>{money(s.moratoriumInterest, true)}</b>
                </div>
              )}
              <div className="bo-totales-fila">
                <span>Comisiones</span><b>{money(s.fees, true)}</b>
              </div>
              <div className="bo-totales-fila">
                <span>IVA trasladado<span className="bo-sub"> · no es ingreso, es del SAT</span></span>
                <b>{money(s.ivaAccrued, true)}</b>
              </div>
              <div className="bo-totales-fila bo-totales-suma">
                <span><b>Facturable del período</b></span><b>{money(s.billable, true)}</b>
              </div>
              <div className="bo-totales-fila">
                <span>Facturado<span className="bo-sub"> · {plural(s.invoiceCount, 'CFDI', 'CFDI')}</span></span>
                <b>{money(s.invoiced, true)}</b>
              </div>
              <div className="bo-totales-fila">
                <span style={{ color: s.billingReconciled ? 'var(--bo-ok)' : 'var(--bo-bad)' }}>
                  {s.billingReconciled
                    ? '✓ Todo lo devengado está facturado'
                    : s.billingDifference > 0
                      ? 'Devengado sin facturar'
                      : 'Facturado de más'}
                </span>
                {!s.billingReconciled && (
                  <b style={{ color: 'var(--bo-bad)' }}>{money(s.billingDifference, true)}</b>
                )}
              </div>
            </div>
            {!s.billingReconciled && s.billingDifference > 0 && (
              <p className="bo-sub" style={{ marginTop: 12 }}>
                Lo devengado se acumula solo con cada cargo; convertirlo en CFDI exige correr la
                facturación del período. Una diferencia positiva casi siempre significa que esa
                corrida no se ha hecho, no que falte un asiento.
              </p>
            )}
          </div>
        </CardTitled>
      </div>

      {!s.balanced && (
        <div className="bo-alert" style={{ marginTop: 16 }}>
          <b>La balanza no cuadra.</b> Ningún número de este período es utilizable hasta que la
          diferencia se explique. No es un problema de presentación: es una póliza asentada sin su
          contrapartida.
        </div>
      )}

      {s.orderAccounts > 0 && (
        <p className="bo-sub" style={{ marginTop: 14 }}>
          Además, {money(s.orderAccounts)} en <b>cuentas de orden</b> — líneas de crédito autorizadas
          que todavía no se disponen. Cuadran entre sí y no forman parte del balance, por eso no
          entran en el cargo/abono de arriba.
        </p>
      )}

      <div style={{ marginTop: 16 }}>
        <CardTitled title="Movimiento por sucursal">
          <DataTable
            columns={columns}
            rows={s.byUnit}
            rowKey={(u) => u.orgUnitCode ?? 'sin-sucursal'}
            loading={state.loading}
            emptyMessage="Este período no tiene movimiento en ninguna sucursal."
          />
        </CardTitled>
      </div>

      {barras.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <CardTitled title="Ingreso devengado por sucursal">
            <div className="bo-card-pad">
              <BarList data={barras} format={(v) => money(v, true)} />
            </div>
          </CardTitled>
        </div>
      )}

      {s.byUnit.some((u) => u.orgUnitCode == null) && (
        <div className="bo-alert bo-huerfanos" style={{ marginTop: 16 }}>
          <b>Hay movimiento sin sucursal.</b> Son préstamos anteriores al sellado de la unidad de
          origen. Se cuentan aparte y no se reparten entre las demás: prorratearlos haría que las
          sumas cerraran a costa de atribuir ingreso a quien no lo colocó.
        </div>
      )}
    </>
  );
}

// ── Pólizas ────────────────────────────────────────────────────────────────

/**
 * Los hechos que sólo mueven cuentas de orden.
 *
 * <p>Se distinguen por su `triggerEvent` y no por sus renglones porque la lista de pólizas no los
 * trae: pedirlos obligaría a una llamada por póliza para pintar una tabla.
 */
const ORDEN_TRIGGERS = new Set(['ACCOUNT_ACTIVATED', 'WRITE_OFF_CONTROL']);

/**
 * Los hechos que acaban en un CFDI.
 *
 * <p>Es la misma regla que aplica el dominio al acumular conceptos facturables: todo cargo al
 * acreditado —interés, moratorio, comisiones, IVA— salvo los que lo deshacen. La disposición del
 * capital NO entra: mover dinero al cliente no es cobrarle nada, y sumarla haría que el mes en que
 * nace un préstamo parezca descuadrado contra su factura por el importe entero del crédito.
 */
function esFacturable(trigger: string): boolean {
  return trigger.startsWith('CHARGE_')
    && trigger !== 'CHARGE_REVERSED'
    && trigger !== 'CHARGE_WAIVED';
}

/** Un cliente del período, con sus préstamos. Se arma sobre filas que ya vienen sumadas. */
interface ClienteDelPeriodo {
  obligorPartyId: string;
  obligorName: string;
  prestamos: LoanMovement[];
  polizas: number;
  cargos: number;
  orden: number;
}

/**
 * Junta los préstamos del período por cliente.
 *
 * <p>Cada préstamo llega ya sumado por el servidor sobre el período completo, así que sumarlos por
 * cliente es exacto. Lo que no se puede hacer —y por eso el agregado vive en SQL— es agrupar las
 * pólizas sueltas: con devengo diario son miles al mes.
 */
function agrupar(prestamos: LoanMovement[]): ClienteDelPeriodo[] {
  const clientes = new Map<string, ClienteDelPeriodo>();

  for (const p of prestamos) {
    const partyId = p.obligorPartyId ?? 'sin-cliente';
    let c = clientes.get(partyId);
    if (!c) {
      c = {
        obligorPartyId: partyId,
        obligorName: p.obligorName ?? 'Sin cliente identificado',
        prestamos: [], polizas: 0, cargos: 0, orden: 0,
      };
      clientes.set(partyId, c);
    }
    if (p.obligorName) c.obligorName = p.obligorName;
    c.prestamos.push(p);
    c.polizas += p.vouchers;
    c.cargos += p.totalDebit;
    c.orden += p.orderAccounts;
  }

  for (const c of clientes.values()) c.prestamos.sort((a, b) => b.totalDebit - a.totalDebit);
  return [...clientes.values()].sort((a, b) => b.cargos - a.cargos);
}

/**
 * El período visto como se concilia: **cliente → préstamo → pólizas y facturas**.
 *
 * <p>Un listado plano de pólizas no contesta la pregunta que se le hace. Un crédito produce en un
 * mes su alta, su disposición, la comisión, el IVA, el devengo y —si acaba mal— el quebranto con su
 * registro en cuentas de orden: media docena de renglones que quedan repartidos entre los de otros
 * cuatrocientos créditos, ordenados por fecha. Averiguar «qué pasó con este préstamo» obligaba a
 * rastrear el mismo contrato por varias páginas y sumarlo a mano.
 *
 * <p>Las facturas viven **dentro del préstamo**, junto a sus pólizas, porque es ahí donde se
 * cotejan: lo devengado en las pólizas es lo que debería acabar facturado. En una pestaña aparte,
 * cuadrar una contra otra obliga a recordar cifras entre pantallas.
 */
function Polizas({ periodo, onAbrir, onAbrirFactura, onAbrirPrestamo }: {
  periodo: string;
  onAbrir: (id: string) => void;
  onAbrirFactura: (id: string) => void;
  onAbrirPrestamo: (id: string) => void;
}) {
  const [unidad, setUnidad] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [clienteAbierto, setClienteAbierto] = useState<string | null>(null);

  const unidades = useAsync(() => accountingApi.units(periodo), [periodo]);

  const state = useAsync(
    () => accountingApi.allLoans({ period: periodo, unitCode: unidad || undefined }),
    [periodo, unidad],
  );

  useEffect(() => { setClienteAbierto(null); }, [periodo, unidad]);

  const clientes = useMemo(
    () => agrupar(state.data?.content ?? []),
    [state.data],
  );

  // Se busca por cliente o por contrato, porque son las dos cosas que se tienen a la mano al
  // conciliar. Un cliente entra si él casa o si casa alguno de sus créditos.
  const rows = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return clientes;
    return clientes.filter((c) =>
      c.obligorName.toLowerCase().includes(q)
      || c.prestamos.some((p) => (p.contractNumber ?? '').toLowerCase().includes(q)));
  }, [clientes, busqueda]);

  const columns: Array<Column<ClienteDelPeriodo>> = [
    {
      key: 'cliente',
      header: 'Cliente',
      render: (c) => (
        <div>
          <b>{c.obligorName}</b>
          <div className="bo-sub">
            {plural(c.prestamos.length, 'crédito', 'créditos')}
          </div>
        </div>
      ),
    },
    {
      key: 'contratos',
      header: 'Contratos',
      render: (c) => (
        <div className="bo-mono-sm">
          {c.prestamos.slice(0, 2).map((p) => (
            <div key={p.creditAccountId}>{p.contractNumber ?? p.creditAccountId.slice(0, 8)}</div>
          ))}
          {c.prestamos.length > 2 && (
            <div className="bo-sub">y {c.prestamos.length - 2} más</div>
          )}
        </div>
      ),
    },
    { key: 'polizas', header: 'Pólizas', align: 'right', render: (c) => count(c.polizas) },
    {
      key: 'cargos',
      header: 'Movimiento',
      align: 'right',
      render: (c) => <b>{money(c.cargos, true)}</b>,
    },
    {
      key: 'abrir',
      header: '',
      align: 'right',
      render: (c) => (
        <span
          className="bo-row-abrir"
          title={clienteAbierto === c.obligorPartyId ? 'Cerrar' : 'Ver los créditos de este cliente'}
          style={{
            display: 'inline-block',
            transition: 'transform .15s ease, opacity .12s ease',
            transform: clienteAbierto === c.obligorPartyId ? 'rotate(90deg)' : 'none',
          }}
        >
          ›
        </span>
      ),
    },
  ];

  return (
    <>
      <Card>
        <div className="bo-card-pad" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Field label="Sucursal">
            <Select
              value={unidad}
              onChange={setUnidad}
              options={[
                { value: '', label: 'Todas las sucursales' },
                ...(unidades.data ?? []).map((u) => ({
                  value: u.orgUnitCode ?? 'SIN_SUCURSAL',
                  label: `${u.orgUnitName} · ${plural(u.loans, 'crédito', 'créditos')}`,
                })),
              ]}
            />
          </Field>
          <Field label="Cliente o contrato">
            <TextInput value={busqueda} onChange={setBusqueda} placeholder="Nombre o CTR-…" />
          </Field>
          <Button onClick={() => { setUnidad(''); setBusqueda(''); }}>Limpiar</Button>
        </div>
      </Card>

      <div style={{ marginTop: 16 }}>
        <CardTitled
          title={`Clientes con movimiento en ${periodoLabel(periodo)}`}
          action={<span className="bo-sub">Cliente → crédito → sus pólizas y sus facturas</span>}
        >
          {state.error ? (
            <EmptyState message={`No se pudo cargar el período: ${state.error}`} />
          ) : (
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(c) => c.obligorPartyId}
              onRowClick={(c) => setClienteAbierto(
                clienteAbierto === c.obligorPartyId ? null : c.obligorPartyId,
              )}
              expandedKey={clienteAbierto}
              renderExpanded={(c) => (
                <CreditosDelCliente
                  cliente={c}
                  periodo={periodo}
                  onAbrir={onAbrir}
                  onAbrirFactura={onAbrirFactura}
                  onAbrirPrestamo={onAbrirPrestamo}
                />
              )}
              loading={state.loading}
              emptyMessage={busqueda.trim()
                ? 'Ningún cliente coincide con esa búsqueda.'
                : 'Ningún cliente tuvo movimiento contable en este período.'}
            />
          )}
        </CardTitled>
      </div>

      {state.data?.truncated && (
        <div className="bo-alert" style={{ marginTop: 16 }}>
          <b>El período tiene más créditos de los que caben en una carga.</b> Lo que se ve está
          agrupado sobre los primeros que llegaron, así que los totales por cliente no son los del
          período completo. Acota por sucursal para verlo entero.
        </div>
      )}

      <p className="bo-sub" style={{ marginTop: 8 }}>
        Los importes son del <b>período seleccionado</b>, no el acumulado del crédito. El movimiento
        excluye las cuentas de orden — la línea autorizada es un compromiso, no capital colocado.
      </p>
    </>
  );
}

/**
 * Los créditos de un cliente, cada uno desplegable hacia sus pólizas y sus facturas.
 *
 * <p>Es el segundo nivel. Se pinta con lo que ya se trajo —los totales por préstamo del período—
 * así que abrir un cliente no cuesta ninguna llamada; sólo abrir un crédito la cuesta, y sólo para
 * traer sus pólizas y sus facturas.
 */
function CreditosDelCliente({ cliente, periodo, onAbrir, onAbrirFactura, onAbrirPrestamo }: {
  cliente: ClienteDelPeriodo;
  periodo: string;
  onAbrir: (id: string) => void;
  onAbrirFactura: (id: string) => void;
  onAbrirPrestamo: (id: string) => void;
}) {
  const [abierto, setAbierto] = useState<string | null>(
    // Con un solo crédito no hay nada que elegir: abrirlo de una evita un clic que no decide nada.
    cliente.prestamos.length === 1 ? cliente.prestamos[0].creditAccountId : null,
  );

  const columns: Array<Column<LoanMovement>> = [
    {
      key: 'contrato',
      header: 'Crédito',
      render: (p) => (
        <div>
          <b className="bo-mono-sm">{p.contractNumber ?? p.creditAccountId.slice(0, 8)}</b>
          <div className="bo-sub">
            {sucursalLabel(p.orgUnitName)} · {responsableLabel(p.orgUnitManager)}
          </div>
        </div>
      ),
    },
    {
      key: 'periodo',
      header: 'Actividad',
      render: (p) => (
        <div className="bo-sub">
          {!p.firstVoucherDate || !p.lastVoucherDate ? '—'
            : p.firstVoucherDate.slice(0, 10) === p.lastVoucherDate.slice(0, 10)
              ? date(p.firstVoucherDate)
              : `${date(p.firstVoucherDate)} → ${date(p.lastVoucherDate)}`}
        </div>
      ),
    },
    { key: 'polizas', header: 'Pólizas', align: 'right', render: (p) => count(p.vouchers) },
    {
      key: 'colocado',
      header: 'Colocado',
      align: 'right',
      render: (p) => p.disbursed > 0
        ? money(p.disbursed, true)
        : <span className="bo-sub">—</span>,
    },
    {
      key: 'devengo',
      header: 'Devengado',
      align: 'right',
      render: (p) => {
        const total = p.accruedInterest + p.moratoriumInterest + p.fees;
        if (total === 0) return <span className="bo-sub">—</span>;
        return (
          <div>
            {money(total, true)}
            {p.moratoriumInterest > 0 && (
              <div className="bo-sub">incl. {money(p.moratoriumInterest, true)} moratorio</div>
            )}
          </div>
        );
      },
    },
    {
      key: 'quebranto',
      header: 'Quebranto',
      align: 'right',
      render: (p) => p.writeOff > 0
        ? <span style={{ color: 'var(--bo-bad)' }}>{money(p.writeOff, true)}</span>
        : <span className="bo-sub">—</span>,
    },
    {
      key: 'cargos',
      header: 'Movimiento',
      align: 'right',
      render: (p) => <b>{money(p.totalDebit, true)}</b>,
    },
    {
      key: 'abrir',
      header: '',
      align: 'right',
      render: (p) => (
        <span
          className="bo-row-abrir"
          title={abierto === p.creditAccountId ? 'Cerrar' : 'Ver pólizas y facturas'}
          style={{
            display: 'inline-block',
            transition: 'transform .15s ease, opacity .12s ease',
            transform: abierto === p.creditAccountId ? 'rotate(90deg)' : 'none',
          }}
        >
          ›
        </span>
      ),
    },
  ];

  return (
    <div className="bo-detalle-pad">
      <h4 style={{ margin: '12px 0 8px', fontSize: 12.5, fontWeight: 600 }}>
        Créditos de {cliente.obligorName}
      </h4>
      <DataTable
        columns={columns}
        rows={cliente.prestamos}
        rowKey={(p) => p.creditAccountId}
        onRowClick={(p) => setAbierto(abierto === p.creditAccountId ? null : p.creditAccountId)}
        expandedKey={abierto}
        renderExpanded={(p) => (
          <DetalleDelPrestamo
            prestamo={p}
            periodo={periodo}
            onAbrir={onAbrir}
            onAbrirFactura={onAbrirFactura}
            onAbrirPrestamo={onAbrirPrestamo}
          />
        )}
        emptyMessage="Este cliente no tiene créditos con movimiento."
      />
    </div>
  );
}

/**
 * El cuadre del bloque: qué sumó cada hecho económico y contra qué se coteja.
 *
 * <p>Sesenta y dos renglones de veintisiete pesos no se suman a ojo, y la pregunta que se le hace a
 * esta tabla no es «qué pasó el 14 de julio» sino «cuánto devengó este crédito en julio y por qué».
 * Sin el total hay que exportar a una hoja de cálculo para contestarla, que es exactamente el
 * trabajo manual del que se sale.
 *
 * <p>El desglose va por hecho económico y no por cuenta porque es el eje en el que la gente piensa
 * —interés, IVA, comisión— y porque un mismo hecho puede tocar dos cuentas.
 *
 * <p>Las cuentas de orden se suman aparte: registran la línea autorizada, no capital colocado, y
 * mezclarlas haría que el total del bloque no case con el «Movimiento» de la fila de arriba.
 */
function TotalesDelBloque({ polizas, facturado, periodo }: {
  polizas: Voucher[];
  facturado: number | null;
  periodo: string;
}) {
  const resumen = useMemo(() => {
    const porHecho = new Map<string, { n: number; total: number }>();
    let patrimonial = 0;
    let orden = 0;
    let facturable = 0;

    for (const v of polizas) {
      const clave = v.triggerEvent;
      const e = porHecho.get(clave) ?? { n: 0, total: 0 };
      e.n += 1;
      e.total += v.totalDebit;
      porHecho.set(clave, e);
      if (ORDEN_TRIGGERS.has(clave)) orden += v.totalDebit;
      else patrimonial += v.totalDebit;
      if (esFacturable(clave)) facturable += v.totalDebit;
    }

    return {
      filas: [...porHecho.entries()]
        .map(([hecho, e]) => ({
          hecho, ...e,
          esOrden: ORDEN_TRIGGERS.has(hecho),
          esFacturable: esFacturable(hecho),
        }))
        .sort((a, b) => b.total - a.total),
      patrimonial,
      orden,
      facturable,
    };
  }, [polizas]);

  // Se coteja contra lo **facturable**, no contra el movimiento total.
  //
  // El movimiento incluye la disposición del capital, que no es ingreso ni se factura: un crédito
  // que dispuso $45,000 en el mes movería seis cifras contra un CFDI de $739. Comparar esas dos
  // cifras produciría una diferencia enorme y falsa justo en el mes en que nace el préstamo, que
  // es cuando más se mira. La regla es la misma que aplica el dominio al acumular conceptos.
  const diferencia = facturado == null ? null : resumen.facturable - facturado;

  const concilia = diferencia != null && Math.abs(diferencia) < 0.01;

  return (
    <div className="bo-totales">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
        <b style={{ fontSize: 13 }}>Conciliación de {periodoLabel(periodo)}</b>
        {facturado == null
          ? <span className="bo-sub">sin factura propia que cotejar en este período</span>
          : <Badge tone={concilia ? 'ok' : 'bad'}>{concilia ? 'Concilia' : 'No concilia'}</Badge>}
      </div>
      <div className="bo-totales-grid">
        {resumen.filas.map((f) => (
          <div key={f.hecho} className="bo-totales-fila">
            <span>
              {hechoLabel(f.hecho)}
              <span className="bo-sub"> · {plural(f.n, 'póliza', 'pólizas')}</span>
              {f.esOrden && <span className="bo-sub"> · cuentas de orden</span>}
            </span>
            <b className={f.esOrden ? 'bo-sub' : undefined}>{money(f.total, true)}</b>
          </div>
        ))}

        <div className="bo-totales-fila bo-totales-suma">
          <span><b>Total del período</b></span>
          <b>{money(resumen.patrimonial, true)}</b>
        </div>

        {/* Sólo se separa cuando hay algo que no se factura —típicamente la disposición del
            capital—; si todo el movimiento es facturable, repetir la cifra sería ruido. */}
        {Math.abs(resumen.facturable - resumen.patrimonial) > 0.01 && (
          <div className="bo-totales-fila">
            <span>De eso, facturable al cliente<span className="bo-sub"> · el resto es capital colocado</span></span>
            <b>{money(resumen.facturable, true)}</b>
          </div>
        )}

        {resumen.orden > 0 && (
          <div className="bo-totales-fila">
            <span className="bo-sub">Además, en cuentas de orden (fuera del balance)</span>
            <span className="bo-sub">{money(resumen.orden, true)}</span>
          </div>
        )}

        {facturado != null && (
          <>
            <div className="bo-totales-fila">
              <span>Facturado en {periodoLabel(periodo)}</span>
              <b>{money(facturado, true)}</b>
            </div>
            <div className="bo-totales-fila">
              <span style={{ color: Math.abs(diferencia ?? 0) < 0.01 ? 'var(--bo-ok)' : 'var(--bo-bad)' }}>
                {Math.abs(diferencia ?? 0) < 0.01
                  ? '✓ Lo facturable coincide con lo facturado'
                  : 'Diferencia entre lo facturable y lo facturado'}
              </span>
              {Math.abs(diferencia ?? 0) >= 0.01 && (
                <b style={{ color: 'var(--bo-bad)' }}>{money(diferencia ?? 0, true)}</b>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * El tercer nivel: las **pólizas** y las **facturas** de un préstamo, juntas.
 *
 * <p>Van juntas porque es donde se cotejan. Lo que las pólizas devengaron —interés, comisiones,
 * IVA— es lo que debería aparecer facturado; tenerlas en pantallas distintas obliga a memorizar
 * cifras para compararlas, que es justo el trabajo manual que causa los descuadres.
 *
 * <p>Las facturas se piden al abrir, filtradas por este crédito. Un CFDI puede cubrir varios
 * préstamos del mismo cliente, así que su total no tiene por qué coincidir con lo devengado aquí —
 * y la pantalla lo dice en vez de dejar que parezca un descuadre.
 */
function DetalleDelPrestamo({ prestamo, periodo, onAbrir, onAbrirFactura, onAbrirPrestamo }: {
  prestamo: LoanMovement;
  periodo: string;
  onAbrir: (id: string) => void;
  onAbrirFactura: (id: string) => void;
  onAbrirPrestamo: (id: string) => void;
}) {
  // Las pólizas se piden al abrir y acotadas a este crédito y este período. Con devengo diario un
  // préstamo puede llevar más de cien pólizas al mes; traerlas para los veinticinco créditos de la
  // página por adelantado sería una respuesta enorme de la que se usa la de uno solo.
  const polizasState = useAsync(
    () => accountingApi.vouchers({
      period: periodo,
      creditAccountId: prestamo.creditAccountId,
      size: 200,
    }),
    [periodo, prestamo.creditAccountId],
  );

  const facturas = useAsync(
    () => accountingApi.invoices({ creditAccountId: prestamo.creditAccountId, size: 50 }),
    [prestamo.creditAccountId],
  );

  // Cronológico ascendente: aquí se lee la vida del préstamo dentro del mes —nace, dispone,
  // devenga, cobra, quiebra— y esa historia sólo se entiende hacia adelante. En el libro general
  // manda lo más reciente porque la pregunta es otra.
  const filasPoliza = useMemo(
    () => [...(polizasState.data?.content ?? [])]
      .sort((a, b) => a.voucherDate.localeCompare(b.voucherDate)),
    [polizasState.data],
  );

  const polizas: Array<Column<Voucher>> = [
    {
      key: 'folio',
      header: 'Póliza',
      render: (v) => (
        <div>
          <b className="bo-mono-sm">{folioCompleto(v.voucherType, v.folio, v.orgUnitCode)}</b>
          <div className="bo-sub">{date(v.voucherDate)}</div>
        </div>
      ),
    },
    {
      key: 'tipo',
      header: 'Tipo',
      render: (v) => (
        <div>
          <Badge tone={tonoTipo(v.voucherType)}>{TIPO_POLIZA[v.voucherType]}</Badge>
          {v.isLatePosting && (
            <div className="bo-sub" title={`Pertenece a ${periodoLabel(v.originalPeriod ?? '')}`}>
              extemporánea
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'hecho',
      header: 'Hecho económico',
      render: (v) => (
        <div>
          <b>{hechoLabel(v.triggerEvent)}</b>
          <div className="bo-sub">{v.concept}</div>
        </div>
      ),
    },
    {
      key: 'importe',
      header: 'Importe',
      align: 'right',
      render: (v) => (
        <div>
          {money(v.totalDebit, true)}
          {ORDEN_TRIGGERS.has(v.triggerEvent) && (
            // Se marca porque no entra en el «Movimiento» de la fila de arriba: las cuentas de
            // orden registran el compromiso de una línea, no capital colocado. Sin la nota, la
            // suma de las pólizas no cuadra contra el total del crédito y parece un error.
            <div className="bo-sub">cuentas de orden</div>
          )}
        </div>
      ),
    },
    {
      key: 'abrir',
      header: '',
      align: 'right',
      // La póliza es la unidad de trabajo: lo que se audita son sus renglones, no el total de la
      // fila. Sin una señal de que cada renglón abre, la tabla se lee como un reporte cerrado.
      render: (v) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          {v.status === 'CANCELLED' && <Badge tone="bad">Cancelada</Badge>}
          <span className="bo-row-abrir" title="Ver los renglones de esta póliza">›</span>
        </span>
      ),
    },
  ];

  const columnasFactura: Array<Column<Invoice>> = [
    {
      key: 'folio',
      header: 'Factura',
      render: (i) => (
        <div>
          <b className="bo-mono-sm">{i.serie && i.folio ? `${i.serie}-${i.folio}` : 'Sin folio'}</b>
          <div className="bo-sub">{date(i.createdAt)}</div>
        </div>
      ),
    },
    { key: 'periodo', header: 'Período', render: (i) => periodoLabel(i.period) },
    {
      key: 'alcance',
      header: 'Alcance',
      // Una factura compartida no se puede conciliar contra este crédito solo, y quien la lea
      // desde aquí tiene que saberlo antes de comparar importes.
      render: (i) => i.loanCount > 1
        ? <span className="bo-sub">compartida con {plural(i.loanCount - 1, 'crédito más', 'créditos más')}</span>
        : <span className="bo-sub">sólo este crédito</span>,
    },
    { key: 'subtotal', header: 'Subtotal', align: 'right', render: (i) => money(i.subtotal, true) },
    { key: 'iva', header: 'IVA', align: 'right', render: (i) => money(i.iva, true) },
    { key: 'total', header: 'Total del CFDI', align: 'right', render: (i) => <b>{money(i.total, true)}</b> },
    {
      key: 'estado',
      header: 'Estado',
      render: (i) => <Badge tone={tonoFactura(i.status)}>{ESTADO_FACTURA[i.status]}</Badge>,
    },
  ];

  const filasFactura = facturas.data?.content ?? [];

  /**
   * Lo facturado a este crédito **en este período**, para cotejarlo contra lo devengado.
   *
   * Sólo cuentan las facturas del mismo período y no compartidas: el total de un CFDI que cubre
   * tres créditos no se puede comparar contra lo devengado por uno, y presentarlo como si se
   * pudiera inventaría un descuadre que no existe. Si la hay, no se coteja y se dice por qué.
   */
  const facturadoDelPeriodo = useMemo(() => {
    if (facturas.loading || facturas.error) return null;
    const delPeriodo = filasFactura.filter(
      (i) => i.period === periodo && i.status !== 'CANCELLED',
    );
    if (delPeriodo.length === 0) return null;
    if (delPeriodo.some((i) => i.loanCount > 1)) return null;
    return delPeriodo.reduce((s, i) => s + i.total, 0);
  }, [filasFactura, periodo, facturas.loading, facturas.error]);

  return (
    <div className="bo-detalle-pad">
      <div style={{
        display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap', margin: '12px 0 8px',
      }}>
        <b style={{ fontSize: 12.5 }}>
          {prestamo.contractNumber ?? prestamo.creditAccountId.slice(0, 8)} ·{' '}
          {plural(prestamo.vouchers, 'póliza', 'pólizas')} en {periodoLabel(periodo)}
        </b>
        <span style={{ marginLeft: 'auto' }}>
          <Button onClick={() => onAbrirPrestamo(prestamo.creditAccountId)}>
            Ficha contable completa
          </Button>
        </span>
      </div>

      {polizasState.error ? (
        <EmptyState message={`No se pudieron cargar las pólizas: ${polizasState.error}`} />
      ) : (
        <>
          {/* La conciliación va **antes** del detalle: es la respuesta, y las pólizas son la
              evidencia. Al final obligaba a recorrer sesenta renglones para llegar a la cifra que
              se venía a buscar, y a hacer scroll de vuelta para entenderla. */}
          {!polizasState.loading && filasPoliza.length > 0 && (
            <TotalesDelBloque
              polizas={filasPoliza}
              facturado={facturadoDelPeriodo}
              periodo={periodo}
            />
          )}
          <div style={{ marginTop: 14 }}>
            <Collapsible
              title="Pólizas del período"
              count={prestamo.vouchers}
              subtitle="el detalle que produce las cifras de arriba"
            >
              <DataTable
                columns={polizas}
                rows={filasPoliza}
                rowKey={(v) => v.voucherId}
                onRowClick={(v) => onAbrir(v.voucherId)}
                loading={polizasState.loading}
                emptyMessage="Este crédito no tiene pólizas en el período."
              />
              {filasPoliza.length < prestamo.vouchers && !polizasState.loading && (
                <p className="bo-sub" style={{ marginTop: 8 }}>
                  Se muestran {count(filasPoliza.length)} de {count(prestamo.vouchers)} pólizas del
                  período. El resto está en la ficha contable completa.
                </p>
              )}
            </Collapsible>
          </div>
        </>
      )}

      <Collapsible
        title="Facturas que incluyen este crédito"
        count={facturas.loading ? undefined : filasFactura.length}
        subtitle="de todos los períodos, no sólo del seleccionado"
      >
        {facturas.error ? (
          <EmptyState message={`No se pudieron cargar las facturas: ${facturas.error}`} />
        ) : (
          <>
            <DataTable
              columns={columnasFactura}
              rows={filasFactura}
              rowKey={(i) => i.invoiceId}
              onRowClick={(i) => onAbrirFactura(i.invoiceId)}
              loading={facturas.loading}
              emptyMessage="Ninguna factura incluye conceptos de este crédito todavía."
            />
            {!facturas.loading && filasFactura.length === 0 && (
              <p className="bo-sub" style={{ marginTop: 8 }}>
                Lo devengado se acumula como concepto facturable y se convierte en CFDI cuando corre
                la facturación del período. Si nunca ha corrido, aquí no aparecerá nada aunque el
                crédito haya devengado.
              </p>
            )}
          </>
        )}
      </Collapsible>
    </div>
  );
}

// ── Facturas ───────────────────────────────────────────────────────────────

/**
 * Las facturas del período, consultables por cliente o por crédito.
 *
 * <p><b>Por qué el filtro es de texto y se aplica del lado del cliente.</b> El CFDI se emite por
 * <em>party</em>, así que el servidor filtra por {@code partyId} o {@code creditAccountId} —dos
 * identificadores internos que no aparecen en ningún papel—. Quien concilia tiene a la mano el
 * número de contrato o el nombre, no un UUID, y obligarlo a buscar el id primero es pedirle que
 * haga de índice.
 *
 * <p>El alcance del filtro es la <b>página cargada</b>, y se dice. Filtrar de verdad por contrato
 * en el servidor exige que invoicing resuelva contratos —hoy sólo guarda ids— y que el BFF los
 * traduzca antes de consultar; mientras tanto, decir el alcance es más honesto que dar una lista
 * que parece completa y no lo es.
 *
 * <p>El camino con trazabilidad total sigue siendo entrar por el crédito: ahí la factura se ve
 * junto a las pólizas que la originaron y se puede cotejar el importe contra lo devengado.
 */
function Facturas({ periodo, onAbrir }: {
  periodo: string;
  onAbrir: (id: string) => void;
}) {
  const [estado, setEstado] = useState<InvoiceStatus | ''>('');
  const [busqueda, setBusqueda] = useState('');
  const [page, setPage] = useState(0);

  const query: InvoicesQuery = useMemo(
    () => ({ period: periodo, status: estado || undefined, page, size: 25 }),
    [periodo, estado, page],
  );
  const state = useAsync(() => accountingApi.invoices(query), [JSON.stringify(query)]);

  useEffect(() => { setPage(0); }, [periodo, estado]);

  const data = state.data;
  const todas = data?.content ?? [];

  // Se busca por receptor, RFC o folio. El contrato no viaja en el listado —está en las líneas del
  // CFDI, dentro del detalle— así que buscar por contrato desde aquí devolvería vacío sin explicar
  // por qué; para eso está la vista por crédito, que entra por el otro lado.
  const rows = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return todas;
    return todas.filter((i) =>
      i.receptorName.toLowerCase().includes(q)
      || i.receptorRfc.toLowerCase().includes(q)
      || `${i.serie ?? ''}-${i.folio ?? ''}`.toLowerCase().includes(q));
  }, [todas, busqueda]);

  const totales = useMemo(() => {
    const vivas = rows.filter((i) => i.status !== 'CANCELLED');
    return {
      total: vivas.reduce((s, i) => s + i.total, 0),
      iva: vivas.reduce((s, i) => s + i.iva, 0),
      canceladas: rows.length - vivas.length,
    };
  }, [rows]);

  const columns: Array<Column<Invoice>> = [
    {
      key: 'folio',
      header: 'Factura',
      render: (i) => (
        <div>
          <b className="bo-mono-sm">{i.serie && i.folio ? `${i.serie}-${i.folio}` : 'Sin folio'}</b>
          <div className="bo-sub">{date(i.createdAt)}</div>
        </div>
      ),
    },
    {
      key: 'receptor',
      header: 'Receptor',
      render: (i) => (
        <div>
          <b>{i.receptorName}</b>
          <div className="bo-sub bo-mono-sm">{i.receptorRfc}</div>
        </div>
      ),
    },
    {
      key: 'creditos',
      header: 'Créditos',
      align: 'right',
      // Una factura de dos créditos no se puede cuadrar contra un solo contrato, y ése es
      // justamente el caso que confunde a quien concilia. Mejor decirlo en la lista.
      render: (i) => i.loanCount > 1
        ? <Badge tone="info">{count(i.loanCount)}</Badge>
        : count(i.loanCount),
    },
    { key: 'subtotal', header: 'Subtotal', align: 'right', render: (i) => money(i.subtotal, true) },
    { key: 'iva', header: 'IVA', align: 'right', render: (i) => money(i.iva, true) },
    { key: 'total', header: 'Total', align: 'right', render: (i) => <b>{money(i.total, true)}</b> },
    {
      key: 'estado',
      header: 'Estado',
      render: (i) => <Badge tone={tonoFactura(i.status)}>{ESTADO_FACTURA[i.status]}</Badge>,
    },
  ];

  return (
    <>
      <Card>
        <div className="bo-card-pad" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Field label="Estado">
            <Select
              value={estado}
              onChange={(v) => setEstado(v as InvoiceStatus | '')}
              options={[
                { value: '', label: 'Todos' },
                ...(Object.keys(ESTADO_FACTURA) as InvoiceStatus[])
                  .map((s) => ({ value: s, label: ESTADO_FACTURA[s] })),
              ]}
            />
          </Field>
          <Field label="Cliente, RFC o folio">
            <TextInput value={busqueda} onChange={setBusqueda} placeholder="Nombre, RFC o A-1041…" />
          </Field>
          <Button onClick={() => { setEstado(''); setBusqueda(''); }}>Limpiar</Button>
        </div>
      </Card>

      {rows.length > 0 && (
        <div className="bo-kpis" style={{ marginTop: 16 }}>
          <KpiCard label="Facturado en la página" value={money(totales.total)}
                   delta={plural(rows.length, 'factura', 'facturas')} />
          <KpiCard label="IVA trasladado" value={money(totales.iva)}
                   delta="el interés a persona física va exento" />
          <KpiCard label="Canceladas" value={count(totales.canceladas)}
                   delta={totales.canceladas > 0 ? 'no suman al total' : 'ninguna'}
                   deltaTone={totales.canceladas > 0 ? 'warn' : 'muted'} />
        </div>
      )}

      <div style={{ marginTop: 16 }}>
        <CardTitled title={`Facturas de ${periodoLabel(periodo)}`}>
          {state.error ? (
            <EmptyState message={`No se pudieron cargar las facturas: ${state.error}`} />
          ) : (
            <>
              <DataTable
                columns={columns}
                rows={rows}
                rowKey={(i) => i.invoiceId}
                onRowClick={(i) => onAbrir(i.invoiceId)}
                loading={state.loading}
                emptyMessage="No hay facturas en este período."
              />
              {data && data.totalPages > 1 && (
                <div className="bo-card-pad" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <Button disabled={page <= 0} onClick={() => setPage(page - 1)}>Anterior</Button>
                  <span className="bo-sub">Página {page + 1} de {data.totalPages}</span>
                  <Button disabled={page + 1 >= data.totalPages} onClick={() => setPage(page + 1)}>
                    Siguiente
                  </Button>
                </div>
              )}
            </>
          )}
        </CardTitled>
      </div>

      <p className="bo-sub" style={{ marginTop: 8 }}>
        Un CFDI agrupa todos los conceptos de un cliente en el período, aunque tenga varios créditos;
        el desglose por préstamo está dentro de la factura. Para <b>cotejar una factura contra lo
        devengado</b>, entra por «Por cliente y crédito»: ahí la factura aparece junto a las pólizas
        que la originaron y con la diferencia calculada.
        {busqueda.trim() && ' La búsqueda se aplica sobre la página cargada, no sobre el período completo.'}
        {' '}El timbrado de este entorno es simulado: los folios fiscales no son válidos ante el SAT.
      </p>
    </>
  );
}

// ── Balanza ────────────────────────────────────────────────────────────────

/**
 * La balanza de comprobación, separando patrimoniales de cuentas de orden.
 *
 * <p>Van separadas porque cuadran por separado: las de orden registran el compromiso de una línea
 * autorizada y se cancelan entre sí. Sumadas a la balanza patrimonial inflan el activo con dinero
 * que nunca salió, y el total deja de ser el total de nada.
 */
function Balanza({ periodo }: { periodo: string }) {
  const [unidad, setUnidad] = useState('');
  const unidades = useAsync(() => accountingApi.units(periodo), [periodo]);
  const state = useAsync(
    () => accountingApi.trialBalance(periodo, unidad || undefined),
    [periodo, unidad],
  );

  const rows = state.data ?? [];
  const patrimoniales = rows.filter((r) => r.accountType !== 'ORDER');
  const orden = rows.filter((r) => r.accountType === 'ORDER');

  const suma = (rs: TrialBalanceRow[]) => ({
    debit: rs.reduce((s, r) => s + r.totalDebit, 0),
    credit: rs.reduce((s, r) => s + r.totalCredit, 0),
  });
  const totalPat = suma(patrimoniales);
  const cuadra = Math.abs(totalPat.debit - totalPat.credit) < 0.01;

  const columns: Array<Column<TrialBalanceRow>> = [
    {
      key: 'cuenta',
      header: 'Cuenta',
      render: (r) => (
        <div>
          <b className="bo-mono-sm">{r.accountCode}</b> {r.accountName}
          <div className="bo-sub">{NATURALEZA[r.accountType]}</div>
        </div>
      ),
    },
    { key: 'cargos', header: 'Cargos', align: 'right', render: (r) => money(r.totalDebit, true) },
    { key: 'abonos', header: 'Abonos', align: 'right', render: (r) => money(r.totalCredit, true) },
    {
      key: 'saldo',
      header: 'Saldo',
      align: 'right',
      // Presentado con la naturaleza de la cuenta: un pasivo con saldo sano no se muestra negativo.
      render: (r) => <b>{money(saldoPresentado(r.balance, r.accountType), true)}</b>,
    },
  ];

  return (
    <>
      <Card>
        <div className="bo-card-pad" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <Field label="Sucursal">
            <Select
              value={unidad}
              onChange={setUnidad}
              options={[
                { value: '', label: 'Toda la institución' },
                ...(unidades.data ?? []).map((u) => ({
                  value: u.orgUnitCode ?? 'SIN_SUCURSAL',
                  label: u.orgUnitName,
                })),
              ]}
            />
          </Field>
          <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
            <div className="bo-sub">Cargos y abonos, {periodoLabel(periodo)}</div>
            <div style={{ fontSize: 20, fontWeight: 750, fontVariantNumeric: 'tabular-nums' }}>
              {money(totalPat.debit, true)} · {money(totalPat.credit, true)}
            </div>
            <Badge tone={cuadra ? 'ok' : 'bad'}>{cuadra ? 'Cuadra' : 'No cuadra'}</Badge>
          </div>
        </div>
      </Card>

      <div style={{ marginTop: 16 }}>
        <CardTitled title="Cuentas de balance y resultados">
          {state.error ? (
            <EmptyState message={`No se pudo cargar la balanza: ${state.error}`} />
          ) : (
            <DataTable
              columns={columns}
              rows={patrimoniales}
              rowKey={(r) => r.accountCode}
              loading={state.loading}
              emptyMessage="Ninguna cuenta tuvo movimiento con estos filtros."
            />
          )}
        </CardTitled>
      </div>

      {orden.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <CardTitled title="Cuentas de orden">
            <DataTable
              columns={columns}
              rows={orden}
              rowKey={(r) => r.accountCode}
              emptyMessage="Sin movimiento en cuentas de orden."
            />
            <div className="bo-card-pad bo-sub">
              Registran las líneas de crédito autorizadas. Cuadran entre sí y no forman parte del
              balance: son el compromiso de la institución, no capital colocado.
            </div>
          </CardTitled>
        </div>
      )}

      <p className="bo-sub" style={{ marginTop: 8 }}>
        Es la balanza <b>del período</b>, no el acumulado del ejercicio: los cargos y abonos son los
        movimientos de {periodoLabel(periodo)} y no arrastran saldo inicial. Filtrar por sucursal
        acota el movimiento a los préstamos sellados con esa unidad de origen.
      </p>
    </>
  );
}

// Module Federation carga el expuesto por su default: `lazyProvider` lee `mod.default`.
// Sin esta línea el remote se sirve, resuelve a `undefined` y React falla con «Lazy element
// type must resolve to a class or function» — un error que no menciona la federación.
export default App;
