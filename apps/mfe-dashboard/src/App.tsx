import { dashboardApi, salesOrgApi, type CommercialDashboard } from '@bo/api-client';
import { ArbolCartera } from '@bo/commercial';
import {
  ensureThemeStyles, useAsync, PageHeader, KpiCard, CardTitled,
  DonutChart, StackedBar, Footnote, Meter, MeterList, Spinner, Block,
  money, moneyCompact, count, percent,
} from '@bo/design-system';
import {
  PRODUCT_TYPE_LABELS, applicationStatusLabel, type ProductMix,
} from '@bo/shared-types';

ensureThemeStyles();

/**
 * Serie categórica de la dona de colocación. Arranca en el azul de marca y sigue con el verde del
 * isotipo: el producto más grande se pinta del color de la casa. Los demás se separan en tono para
 * que las rebanadas chicas todavía se distingan entre sí.
 */
const PRODUCT_COLORS = ['#0d47a1', '#00b894', '#4d8df7', '#f59e0b', '#7b61ff', '#ec4899'];

/**
 * Cómo va el cobro del periodo, dicho en palabras.
 *
 * Un porcentaje solo no dice si es bueno: 78% puede ser normal a mitad de mes y malo el día 30.
 * Poner el juicio al lado evita que cada quien invente el suyo.
 */
function cumplimientoTexto(pct: number): string {
  if (pct >= 100) return 'periodo cubierto';
  if (pct >= 90) return 'en línea';
  if (pct >= 70) return 'por debajo de lo esperado';
  return 'muy por debajo — revisar cobranza';
}

export function App() {
  const { data, loading } = useAsync(() => dashboardApi.summary(), []);
  if (loading || !data) return <Spinner />;

  const productDonut = data.byProduct.map((p: ProductMix, i) => ({
    label: PRODUCT_TYPE_LABELS[p.productType],
    value: p.capital,
    color: PRODUCT_COLORS[i % PRODUCT_COLORS.length],
  }));

  return (
    <div>
      <PageHeader
        title="Panorama de cartera"
        subtitle="Colocación, salud crediticia (IFRS-9) y seguimiento por ejecutivo"
      />

      {/* Los indicadores oficiales, con el mismo criterio que la vista de red: la cartera vencida
          es la de 90+ días (CNBV/IFRS-9) y el tramo 31-90 va por separado. Iban sumados, y por eso
          esta pantalla y estructura comercial daban dos moras distintas de la misma cartera. */}
      <div className="bo-kpis" style={{ marginBottom: 16 }}>
        <KpiCard label="Capital colocado" value={money(data.capitalColocado)} icon="💵" accent="var(--bo-primary-soft)"
          delta={`${count(data.activeAccounts)} cuentas activas`} deltaTone="muted" />
        <KpiCard label="Cartera vencida (90+)" value={money(data.carteraVencida)} icon="⚠️" accent="var(--bo-bad-soft)"
          delta={`IMOR ${percent(data.delinquencyRate)}`} deltaTone={data.delinquencyRate > 8 ? 'bad' : 'warn'} />
        <KpiCard label="Atraso temprano (31-90)" value={money(data.carteraAtrasoTemprano ?? 0)} icon="🕒" accent="var(--bo-warn-soft)"
          delta="SICR — todavía no es cartera vencida" deltaTone={(data.carteraAtrasoTemprano ?? 0) > 0 ? 'warn' : 'muted'} />
        <KpiCard label="Provisión IFRS-9" value={money(data.provisionTotal)} icon="🛡️" accent="var(--bo-warn-soft)"
          delta={`EAD ${moneyCompact(data.ead)}`} deltaTone="muted" />
      </div>

      {/* Cobranza del periodo: qué toca cobrar y cuánto de lo esperado ya entró. Es la pregunta
          diaria de operación y no estaba en ningún lado; el tablero sólo contaba saldos. */}
      <div className="bo-kpis" style={{ marginBottom: 16 }}>
        <KpiCard label="A cobrar próximo periodo" value={money(data.aCobrarProximoPeriodo ?? 0)} icon="📅" accent="var(--bo-info-soft)"
          delta="parcialidades con vencimiento el mes que entra" deltaTone="muted" />
        <KpiCard label="Esperado del periodo" value={money(data.aCobrarPeriodoActual ?? 0)} icon="🎯" accent="var(--bo-primary-soft)"
          delta={`cobrado ${money(data.cobradoPeriodoActual ?? 0)}`} deltaTone="muted" />
        <KpiCard label="Pago del periodo" value={percent(data.porcentajePagoPeriodo ?? 0)} icon="📈" accent="var(--bo-ok-soft)"
          delta={cumplimientoTexto(data.porcentajePagoPeriodo ?? 0)}
          deltaTone={(data.porcentajePagoPeriodo ?? 0) >= 90 ? 'ok'
            : (data.porcentajePagoPeriodo ?? 0) >= 70 ? 'warn' : 'bad'} />
        <KpiCard label="Clientes / negocios" value={`${count(data.activeClients)} / ${count(data.activeBusinesses)}`} icon="👥" accent="var(--bo-info-soft)"
          delta={`Desembolsado (mes) ${moneyCompact(data.disbursedThisMonth)}`} deltaTone="ok" />
      </div>

      <div className="bo-cols-2" style={{ marginBottom: 16 }}>
        <CardTitled title="Salud de la cartera (IFRS-9)">
          <div className="bo-card-pad">
            <StackedBar segments={[
              { label: 'Sana (Stage 1)', value: data.health.stage1, color: 'var(--bo-ok)' },
              { label: 'SICR (Stage 2)', value: data.health.stage2, color: 'var(--bo-warn)' },
              { label: 'Vencida (Stage 3)', value: data.health.stage3, color: 'var(--bo-bad)' },
            ]} />
            <div style={{ marginTop: 18, display: 'flex', gap: 24, flexWrap: 'wrap' }}>
              <div><div className="bo-def-k">Sana</div><div className="bo-def-v" style={{ color: 'var(--bo-ok)' }}>{money(data.health.stage1)}</div></div>
              <div><div className="bo-def-k">SICR</div><div className="bo-def-v" style={{ color: 'var(--bo-warn)' }}>{money(data.health.stage2)}</div></div>
              <div><div className="bo-def-k">Vencida</div><div className="bo-def-v" style={{ color: 'var(--bo-bad)' }}>{money(data.health.stage3)}</div></div>
            </div>
          </div>
        </CardTitled>

        <CardTitled title="Colocación por producto">
          <div className="bo-card-pad">
            <DonutChart data={productDonut} centerValue={moneyCompact(data.capitalColocado)} centerLabel="capital" />
          </div>
        </CardTitled>
      </div>

      <div className="bo-cols-2" style={{ marginBottom: 16 }}>
        <CardTitled title="Producto — capital y cuentas">
          <div className="bo-card-pad">
            <MeterList>
              {(() => {
                // La barra es proporción del producto más grande, no del total: con un producto que
                // se lleva el 70% del capital, contra el total los otros cinco quedan en dos
                // pixeles indistinguibles y la comparación —que es para lo que está el panel— se
                // pierde.
                const mayor = Math.max(1, ...data.byProduct.map((p) => p.capital));
                return data.byProduct.map((p) => (
                  <Meter
                    key={p.productType}
                    label={PRODUCT_TYPE_LABELS[p.productType]}
                    value={`${moneyCompact(p.capital)} · ${count(p.accounts)} ctas.`}
                    pct={(p.capital / mayor) * 100}
                    // Se marca en rojo el producto cuya cartera vencida pesa más de un décimo de
                    // su capital: es el corte a partir del cual el producto, y no el cliente, es
                    // lo que hay que revisar.
                    tone={p.capital > 0 && p.vencida / p.capital > 0.1 ? 'bad' : undefined}
                    title={p.vencida > 0 ? `${moneyCompact(p.vencida)} con atraso` : 'Sin atraso'}
                  />
                ));
              })()}
            </MeterList>
          </div>
        </CardTitled>

        <CardTitled title="Pipeline de solicitudes">
          <div className="bo-card-pad">
            {(data.pipeline ?? []).length === 0 ? (
              <span className="bo-page-sub">
                El BFF todavía no publica el embudo por estatus en el resumen. El detalle vive en
                Originación, que lo calcula sobre la bandeja.
              </span>
            ) : (
              <MeterList>
                {(() => {
                  const etapas = data.pipeline ?? [];
                  const mayor = Math.max(1, ...etapas.map((p) => p.count));
                  return etapas.map((p) => (
                    <Meter
                      key={p.status}
                      label={applicationStatusLabel(p.status as never)}
                      value={count(p.count)}
                      pct={(p.count / mayor) * 100}
                      tone="info"
                    />
                  ));
                })()}
              </MeterList>
            )}
          </div>
        </CardTitled>
      </div>

      <CarteraPorEjecutivo />

      <Footnote>
        La salud (sana / SICR / vencida) proviene de <b>risk-service</b> (IFRS-9); el capital, de
        <b> credit-portfolio-service</b>; el cobro del período, de su calendario de pagos; la
        asignación por ejecutivo, de <b>party-service</b> y <b>sales-org-service</b>. El BFF
        <b> channel-backoffice-service</b> agrega estos indicadores: si una cifra no cuadra, se
        compara contra su servicio, no contra otra pantalla.
      </Footnote>
    </div>
  );
}

export default App;

/**
 * La cartera de la red, con el mismo recorrido que Estructura comercial.
 *
 * La misma tabla y el mismo alcance: quien entra ve su unidad y baja por regiones, zonas,
 * sucursales y ejecutivos hasta los clientes. La diferencia es que aquí sólo se mira —reasignar
 * es una operación de estructura, y vive donde se reorganiza la red—.
 *
 * La raíz sale de `my-scope`, que contesta directamente dónde está parado quien mira. Antes se
 * averiguaba pidiendo la cartera sin unidad y cayéndose al `catch` cuando el BFF respondía 400:
 * funcionaba, pero usaba un error como vía normal, y eso esconde los errores de verdad —cualquier
 * fallo de red acababa mostrando la raíz como si fuera el alcance de esa persona.
 */
function CarteraPorEjecutivo() {
  const state = useAsync(async () => {
    const [niveles, unidades, alcance] = await Promise.all([
      salesOrgApi.levels(), salesOrgApi.units(), salesOrgApi.myScope(),
    ]);
    const datos: CommercialDashboard | null = alcance.unitId
      ? await salesOrgApi.commercial(alcance.unitId)
      : null;
    return { niveles, unidades, datos };
  }, []);

  return (
    <CardTitled
      title="Cartera de la red"
      action={<span className="bo-page-sub">Abre una rama para bajar hasta el ejecutivo y sus clientes</span>}
    >
      <Block
        state={state}
        emptyLabel="No estás adscrito a ninguna unidad comercial, así que no hay red que mostrar."
        isEmpty={(d) => !d?.datos}
      >
        {({ niveles, unidades, datos }) => (
          // Sin `alcance`: aquí sólo se mira. Reasignar es una operación de estructura y vive
          // donde se reorganiza la red, no en el tablero.
          <ArbolCartera datos={datos!} unidades={unidades} niveles={niveles} />
        )}
      </Block>
    </CardTitled>
  );
}
