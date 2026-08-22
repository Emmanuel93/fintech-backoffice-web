import { useMemo, useState } from 'react';
import { ArbolCartera, ReasignarCliente, type ClienteEnCartera } from '@bo/commercial';
import { ReasignarPersona, ReasignarUnidad } from './Reasignar';
import { ConfigRed } from './ConfigRed';
import { PorOrigen } from './PorOrigen';
import {
  salesOrgApi,
  type AlcanceComercial, type CommercialDashboard, type Monto, type SalesLevel, type SalesUnit,
} from '@bo/api-client';
import {
  ensureThemeStyles, useAsync, useVista, Block, PageHeader, Button, Card, CardTitled, KpiCard,
  Badge, EmptyState, Footnote, Tabs, money, moneyCompact, count, percent,
  type AsyncState,
} from '@bo/design-system';

/** Las dos atribuciones de la misma red: por quién la lleva hoy, y por quién la colocó. */
type Vista = 'arbol' | 'origen';
const VISTAS: readonly Vista[] = ['arbol', 'origen'];

ensureThemeStyles();

/**
 * Estructura comercial: quién vende, colgado de quién, y qué trae cada rama.
 *
 * La pantalla eran dos paneles —la jerarquía a la izquierda, la cartera de lo seleccionado a la
 * derecha— y esa forma obligaba a hacer dos lecturas para una sola pregunta. Para saber de qué se
 * componía el número de una región había que elegirla en el árbol, leer el total en el otro panel,
 * elegir una zona, volver a leer, y sumar de cabeza; y como cada panel mostraba cifras distintas
 * del mismo nodo, no se sabía si discrepaban o si eran dos preguntas diferentes.
 *
 * Ahora es **una tabla** que se abre hacia abajo. Cada renglón lleva lo suyo y lo de todo lo que
 * cuelga de él, así que abrir un nivel siempre explica el de arriba y los totales de un padre se
 * pueden comprobar contra sus hijos a simple vista. Eso es lo que hace que la cifra se crea.
 *
 * El alcance se pide una vez y encuadra las dos cosas: hasta dónde se ve y hasta dónde se puede
 * reorganizar. No es lo mismo —un auditor ve la red entera y no mueve nada— y la pantalla tiene
 * que decir cuál de las dos está mirando.
 */
export function App({ vista: vistaRuta }: { vista?: string } = {}) {
  const [vista, setVista] = useVista<Vista>(vistaRuta, VISTAS, 'arbol');
  const alcance = useAsync(() => salesOrgApi.myScope(), []);
  const [configurando, setConfigurando] = useState(false);

  const tree = useAsync(async () => {
    const [levels, units] = await Promise.all([salesOrgApi.levels(), salesOrgApi.units()]);
    return { levels, units };
  }, []);

  /**
   * La cartera del subárbol que gobierna quien mira.
   *
   * La raíz es su unidad, no la del país: un gerente de zona abre su zona y nada más. Se pide con
   * el `unitId` explícito —y no sin parámetro— porque un rol transversal no tiene unidad propia y
   * recibiría un 400; `my-scope` ya resolvió cuál es la raíz de cada quien.
   */
  const raizId = alcance.data?.unitId ?? null;
  const cartera = useAsync(
    () => (raizId ? salesOrgApi.commercial(raizId) : Promise.resolve(null)),
    [raizId],
  );

  return (
    <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'minmax(0, 1fr)' }}>
      <PageHeader
        title="Estructura comercial"
        subtitle="La red entera en una tabla: cada rama con su cartera, su gente y de dónde salió su colocación."
        actions={alcance.data?.canManage
          ? (
            // Configurar la escalera y el IVA no es operar la red: se hace una vez al año, no
            // decenas de veces al mes. Por eso vive detrás de un botón y no en la tabla.
            <Button onClick={() => setConfigurando(true)}>Configurar la red</Button>
          )
          : undefined}
      />

      <Tabs
        value={vista}
        onChange={setVista}
        tabs={[
          { value: 'arbol', label: 'Por ejecutivo actual', icon: '🌳' },
          { value: 'origen', label: 'Por unidad de origen', icon: '🏷️' },
        ]}
      />

      <Block state={alcance} emptyLabel="No se pudo resolver tu alcance comercial.">
        {(sc) => (sc.unitId
          ? (
            <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'minmax(0, 1fr)' }}>
              <AvisoAlcance alcance={sc} unidades={tree.data?.units ?? []} />
              {vista === 'origen' ? <PorOrigen unitId={sc.unitId} /> : <Cuerpo
                alcance={sc}
                cartera={cartera}
                levels={tree.data?.levels ?? []}
                units={tree.data?.units ?? []}
                onCambio={() => { cartera.reload(); tree.reload(); }}
              />}
            </div>
          )
          : (
            <Card>
              <EmptyState message="No estás adscrito a ninguna unidad comercial, así que no hay una red que mostrarte. Pídele a un administrador que te asigne a una unidad." />
            </Card>
          ))}
      </Block>

      <Footnote>
        El nivel no lo da el rol sino el <b>nodo</b> al que la persona está adscrita: quien entra ve
        su unidad y baja por regiones, zonas, sucursales y ejecutivos hasta los clientes, y sólo
        puede reasignar dentro de su propio alcance. El histórico de asignaciones no se borra —mover
        a alguien cierra la vigente y abre otra—, así que «dónde estaba en marzo» se puede
        contestar. El IVA se hereda hacia abajo: fijarlo en una región lo aplica a sus sucursales.
      </Footnote>

      {configurando && tree.data && (
        <ConfigRed
          niveles={tree.data.levels}
          unidades={alcance.data?.orgWide
            ? tree.data.units
            : tree.data.units.filter((u) => alcance.data?.unitIds.includes(u.unitId))}
          onCerrar={() => setConfigurando(false)}
          onCambio={() => { tree.reload(); cartera.reload(); }}
        />
      )}
    </div>
  );
}

/**
 * Qué parte de la red gobierna quien mira, dicho antes de la tabla.
 *
 * Sin esto una tabla con doce sucursales y una con ochenta y siete se ven igual y no hay forma de
 * saber si falta información o si eso es todo lo que le toca. Y separa ver de mandar, que es la
 * distinción que la pantalla tiene que hacer explícita: un auditor ve la red completa y no puede
 * mover una sola unidad.
 */
function AvisoAlcance({ alcance, unidades }: { alcance: AlcanceComercial; unidades: SalesUnit[] }) {
  const nombre = alcance.unitName
    ?? unidades.find((u) => u.unitId === alcance.unitId)?.name
    ?? 'tu unidad';
  return (
    <div className="bo-scope">
      <Badge tone={alcance.canManage ? 'ok' : 'muted'}>
        {alcance.canManage ? 'Puedes reorganizar' : 'Sólo lectura'}
      </Badge>
      <span>
        {alcance.orgWide
          ? <>Alcance <b>completo</b>: la red entera.</>
          : <>Tu alcance: <b>{nombre}</b> y todo lo que cuelga de ella.</>}
        {' '}
        <span className="bo-page-sub" style={{ display: 'inline' }}>
          {count(alcance.unitIds.length)} unidades
          {alcance.canManage
            ? ' — puedes mover, asignar y reasignar dentro de ahí, y nada fuera.'
            : ' — puedes consultarlas; reorganizar requiere la capacidad salesorg.manage.'}
        </span>
      </span>
    </div>
  );
}

function Cuerpo({ alcance, cartera, levels, units, onCambio }: {
  alcance: AlcanceComercial;
  cartera: AsyncState<CommercialDashboard | null>;
  levels: SalesLevel[];
  units: SalesUnit[];
  onCambio: () => void;
}) {
  const [moviendo, setMoviendo] = useState<SalesUnit | null>(null);
  const [reasignandoPersona, setReasignandoPersona] = useState<Record<string, unknown> | null>(null);
  const [reasignandoCliente, setReasignandoCliente] = useState<ClienteEnCartera | null>(null);

  /** Las unidades que quien mira puede tocar. Los diálogos ofrecen sólo éstas como destino. */
  const dentroDelAlcance = useMemo(
    () => (alcance.orgWide ? units : units.filter((u) => alcance.unitIds.includes(u.unitId))),
    [units, alcance],
  );

  return (
    <>
      <Block
        state={cartera}
        emptyLabel="Esta unidad todavía no tiene cartera."
        isEmpty={(x) => x == null}
      >
        {(dato) => {
          const d = dato as CommercialDashboard;
          const t: Monto = d.portfolio ?? {
            accounts: 0, delinquentAccounts: 0, principal: 0, overdue: 0, delinquencyRate: 0,
          };
          const asignados = (d.assignees ?? []) as Array<Record<string, unknown>>;
          const conCartera = asignados.filter(
            (a) => Number((a['portfolio'] as Monto | undefined)?.accounts ?? 0) > 0,
          ).length;
          const devengado = t.accruedInterest ?? 0;
          const moratorios = t.penalty ?? 0;
          const terceros = t.distributorShare ?? 0;

          return (
            <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'minmax(0, 1fr)' }}>
              {/* Las seis cifras con las que se dirige una red: cuánto se colocó, cuánto está en
                  riesgo, cuánto se ganó sin cobrar, cuánto se debe, quién lo trae y por qué canal
                  entró. La tabla de abajo es el desglose de exactamente estas seis. */}
              <div className="bo-kpis">
                <KpiCard label="Capital colocado" value={money(t.principal)}
                         delta={`${count(t.accounts)} cuentas · ticket ${moneyCompact(t.averageTicket ?? 0)}`} />
                {/* Vencida oficial CNBV/IFRS-9 (90+) y el atraso temprano aparte. Iban sumados y
                    por eso la mora de esta pantalla no coincidía con la del panorama. */}
                <KpiCard label="Cartera vencida (90+)" value={money(t.overdue)}
                         delta={`IMOR ${percent(t.delinquencyRate)} · ${count(t.delinquentAccounts)} cuentas`}
                         deltaTone={t.overdue > 0 ? 'bad' : 'muted'} />
                <KpiCard label="Atraso temprano (31-90)" value={money(t.earlyArrears ?? 0)}
                         delta="SICR — todavía no es cartera vencida"
                         deltaTone={(t.earlyArrears ?? 0) > 0 ? 'warn' : 'muted'} />
                <KpiCard label="A cobrar del periodo" value={money(t.dueThisPeriod ?? 0)}
                         delta={(t.pastDueAmount ?? 0) > 0
                           ? `${money(t.pastDueAmount ?? 0)} ya vencido`
                           : 'nada exigible vencido'}
                         deltaTone={(t.pastDueAmount ?? 0) > 0 ? 'bad' : 'ok'} />
                <KpiCard label="Devengado sin cobrar" value={money(devengado)}
                         delta={moratorios > 0 ? `+ ${money(moratorios)} moratorios` : 'sin moratorios'}
                         deltaTone={moratorios > 0 ? 'bad' : 'muted'} />
                <KpiCard label="Adeudo total" value={money(t.totalDebt ?? t.principal + devengado + moratorios)}
                         delta="capital + devengado + moratorios" />
                <KpiCard label="Ejecutivos" value={count(d.executiveCount ?? 0)}
                         delta={`${count(conCartera)} con cartera`}
                         deltaTone={conCartera < (d.executiveCount ?? 0) ? 'warn' : 'muted'} />
                <KpiCard label="Colocación por terceros" value={percent(terceros, 0)}
                         delta={terceros > 0
                           ? `${money(t.distributorPrincipal ?? 0)} de ${count(t.distributorAccounts ?? 0)} cuentas`
                           : 'toda la colocación es propia'} />
              </div>

              {/* La cartera que no cuelga de nadie, dicha aquí y no escondida.
                  Esta pantalla y el panorama de cartera daban cifras distintas del mismo negocio
                  —$2.9M contra $4.7M— y no había nada que explicara la diferencia, así que
                  parecía que una de las dos estaba mal. Ninguna lo estaba: son créditos vivos sin
                  ejecutivo asignado. No aparecen en la meta de ninguna sucursal, nadie los visita
                  y nadie cobra por ellos, que es exactamente por lo que hay que verlos. */}
              {d.unassigned && d.unassigned.accounts > 0 && (
                <div className="bo-alert bo-huerfanos">
                  <b>{money(d.unassigned.principal)}</b> en {count(d.unassigned.accounts)} cuentas
                  vivas <b>no cuelgan de ninguna rama</b>: su cliente no tiene ejecutivo asignado.
                  No entran en los números de arriba ni en la meta de ninguna sucursal.
                  <span className="bo-page-sub" style={{ display: 'block', marginTop: 4 }}>
                    Con ellas, la red suma {money(d.unassigned.networkPrincipal)} en{' '}
                    {count(d.unassigned.networkAccounts)} cuentas — que es la cifra del panorama de
                    cartera. Se asignan desde <b>Clientes</b>, eligiendo ejecutivo.
                  </span>
                </div>
              )}

              <CardTitled
                title="Red comercial"
                action={
                  <span className="bo-page-sub">
                    Abre una rama para ver de qué se compone — hasta el cliente
                  </span>
                }
              >
                <ArbolCartera
                  datos={d}
                  unidades={units}
                  niveles={levels}
                  alcance={alcance}
                  onMoverUnidad={setMoviendo}
                  onMoverPersona={setReasignandoPersona}
                  onReasignarCliente={setReasignandoCliente}
                />
              </CardTitled>
            </div>
          );
        }}
      </Block>

      {moviendo && (
        <ReasignarUnidad
          unidad={moviendo}
          unidades={dentroDelAlcance}
          niveles={levels}
          onCerrar={() => setMoviendo(null)}
          onListo={() => { setMoviendo(null); onCambio(); }}
        />
      )}
      {reasignandoPersona && (
        <ReasignarPersona
          persona={reasignandoPersona}
          unidades={dentroDelAlcance}
          niveles={levels}
          onCerrar={() => setReasignandoPersona(null)}
          onListo={() => { setReasignandoPersona(null); onCambio(); }}
        />
      )}
      {reasignandoCliente && cartera.data && (
        <ReasignarCliente
          cliente={reasignandoCliente}
          datos={cartera.data}
          unidades={dentroDelAlcance}
          niveles={levels}
          onCerrar={() => setReasignandoCliente(null)}
          onListo={() => { setReasignandoCliente(null); onCambio(); }}
        />
      )}
    </>
  );
}

export default App;
