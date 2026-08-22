import { useCallback, useMemo, useState } from 'react';
import {
  clientsApi, salesOrgApi,
  type AlcanceComercial, type CommercialDashboard, type Monto,
  type SalesLevel, type SalesUnit,
} from '@bo/api-client';
import { Badge, Spinner, count, money, moneyCompact, percent } from '@bo/design-system';
import type { Client } from '@bo/shared-types';

/**
 * La red comercial entera en una sola tabla que se abre hacia abajo.
 *
 * Antes esto eran dos cosas: un árbol en un panel lateral y una tabla en otro. La jerarquía se
 * leía a la izquierda y los números a la derecha, y para saber de qué se componía una cifra había
 * que seleccionar una rama, leer un total, cambiar de panel y sumar de cabeza. Peor: los dos
 * paneles decían cosas distintas del mismo nodo —el lateral, capital; la tabla, otra cosa— y no
 * había forma de saber si discrepaban o si eran dos preguntas diferentes.
 *
 * Aquí hay una lectura sola: cada renglón lleva **lo suyo y lo de todo lo que cuelga de él**, así
 * que abrir un nivel siempre explica el renglón de arriba. Nacional → región → zona → sucursal →
 * ejecutivo → cliente, bajando por donde se colocó el crédito. Los totales de un padre son la
 * suma de sus hijos y eso se puede comprobar a ojo, que es lo que hace que el número se crea.
 *
 * El ejecutivo es un nodo del árbol *y* una persona: en la estructura su unidad lleva su propio
 * nombre. Se pintan como un solo renglón —no la unidad y debajo la persona repitiendo el nombre—
 * porque son lo mismo visto desde dos servicios.
 */
export function ArbolCartera({
  datos, unidades, niveles, alcance, onReasignarCliente, onMoverUnidad, onMoverPersona,
}: {
  datos: CommercialDashboard;
  unidades: SalesUnit[];
  niveles: SalesLevel[];
  /**
   * Hasta dónde puede operar quien mira. Sin esto la tabla ofrece todas las acciones y el backend
   * rechaza la mitad: la regla se aprende a base de 403.
   */
  alcance?: AlcanceComercial | null;
  onReasignarCliente?: (cliente: ClienteEnCartera) => void;
  onMoverUnidad?: (unidad: SalesUnit) => void;
  onMoverPersona?: (persona: Record<string, unknown>) => void;
}) {
  const [abiertos, setAbiertos] = useState<Record<string, boolean>>({});
  const [clientesDe, setClientesDe] = useState<Record<string, ClienteEnCartera[] | 'cargando'>>({});

  const montoDe = datos.byUnit ?? {};
  const asignados = useMemo(
    () => (datos.assignees ?? []) as Array<Record<string, unknown>>,
    [datos.assignees],
  );

  const nivelDe = useMemo(() => new Map(niveles.map((l) => [l.levelId, l])), [niveles]);

  /**
   * El escalón más bajo que **de verdad existe**, no el más bajo del catálogo.
   *
   * La diferencia importa: hay niveles dados de alta sin una sola unidad —hoy, «Distribuidor»—, y
   * medir contra el catálogo corría la hoja un escalón hacia abajo. El efecto era que el ejecutivo
   * dejaba de reconocerse como persona y se pintaba como una unidad más, con su código de unidad
   * donde debía ir su correo, y su titular colgando aparte repitiendo el mismo nombre.
   */
  const profundidadHoja = useMemo(() => {
    const conUnidades = new Set(unidades.map((u) => u.levelId));
    const usados = niveles.filter((l) => conUnidades.has(l.levelId)).map((l) => l.depth);
    return usados.length ? Math.max(...usados) : 0;
  }, [niveles, unidades]);

  const hijosDe = useMemo(() => {
    const m = new Map<string, SalesUnit[]>();
    unidades.forEach((u) => {
      const k = u.parentUnitId ?? '';
      m.set(k, [...(m.get(k) ?? []), u]);
    });
    // Dentro de cada rama, primero lo que más pesa. Un directivo recorre la red de arriba abajo
    // buscando dónde está el problema, y el orden alfabético lo obliga a leerla entera.
    m.forEach((lista) => lista.sort(
      (a, b) => (montoDe[b.unitId]?.principal ?? 0) - (montoDe[a.unitId]?.principal ?? 0)
             || a.name.localeCompare(b.name),
    ));
    return m;
  }, [unidades, montoDe]);

  /** Las personas asignadas *directamente* a una unidad. */
  const personasDe = useMemo(() => {
    const m = new Map<string, Array<Record<string, unknown>>>();
    asignados.forEach((a) => {
      const k = String(a['unitId'] ?? '');
      m.set(k, [...(m.get(k) ?? []), a]);
    });
    return m;
  }, [asignados]);

  /**
   * Quién responde por cada nodo.
   *
   * Una red comercial se dirige hablando con personas, no con códigos de unidad. «Región Norte
   * está en 28% de mora» no es accionable hasta saber que quien responde por ella es Paulina; y
   * el nombre vivía en un renglón aparte que sólo aparecía al expandir, así que para saberlo
   * había que abrir cada rama una por una. Va en el mismo renglón, bajo el nombre de la unidad.
   *
   * Si hay más de un asignado —puede haberlo durante un relevo— manda el primero y el resto
   * sigue apareciendo al expandir con su propia cartera.
   */
  const responsableDe = useCallback((unitId: string): string | null => {
    const gente = personasDe.get(unitId) ?? [];
    if (gente.length === 0) return null;
    const n = gente[0]['name'];
    return n ? String(n) : null;
  }, [personasDe]);

  /**
   * Cuánta gente hay bajo cada rama, y cuánta trae cartera.
   *
   * Es la cifra que convierte la tabla en una herramienta de dirección: una sucursal con ocho
   * ejecutivos de los que dos colocan no tiene un problema de mercado, tiene uno de equipo, y sin
   * la comparación entre las dos columnas eso no se ve en ningún lado.
   */
  const plantillaDe = useMemo(() => {
    const propio = new Map<string, { total: number; conCartera: number }>();
    asignados.forEach((a) => {
      const k = String(a['unitId'] ?? '');
      const cuentas = Number((a['portfolio'] as Monto | undefined)?.accounts ?? 0);
      const acc = propio.get(k) ?? { total: 0, conCartera: 0 };
      propio.set(k, { total: acc.total + 1, conCartera: acc.conCartera + (cuentas > 0 ? 1 : 0) });
    });
    // Se sube por el árbol una vez, de la hoja a la raíz, en vez de recorrer el subárbol por nodo:
    // con ochenta y siete unidades lo segundo es recorrer el árbol ochenta y siete veces.
    const padreDe = new Map(unidades.map((u) => [u.unitId, u.parentUnitId]));
    const acumulado = new Map<string, { total: number; conCartera: number }>();
    propio.forEach((v, unitId) => {
      let cur: string | null | undefined = unitId;
      let guarda = 0;
      while (cur && guarda++ < 20) {
        const acc = acumulado.get(cur) ?? { total: 0, conCartera: 0 };
        acumulado.set(cur, { total: acc.total + v.total, conCartera: acc.conCartera + v.conCartera });
        cur = padreDe.get(cur) ?? null;
      }
    });
    return acumulado;
  }, [asignados, unidades]);

  const alternar = useCallback(async (clave: string, ejecutivoId?: string) => {
    const abierto = abiertos[clave];
    setAbiertos((o) => ({ ...o, [clave]: !abierto }));
    if (abierto || !ejecutivoId || clientesDe[ejecutivoId]) return;

    // Los clientes se piden al abrir a esa persona, no al pintar la tabla: son cincuenta y dos
    // ejecutivos y nadie abre más de dos o tres.
    setClientesDe((c) => ({ ...c, [ejecutivoId]: 'cargando' }));
    try {
      const page = await clientsApi.list({ executiveId: ejecutivoId, size: 100 });
      setClientesDe((c) => ({ ...c, [ejecutivoId]: page.content.map(aCliente) }));
    } catch {
      setClientesDe((c) => ({ ...c, [ejecutivoId]: [] }));
    }
  }, [abiertos, clientesDe]);

  /** Si quien mira puede reorganizar lo que cuelga de esta unidad. La autoridad es el backend. */
  const puedeTocar = useCallback((unitId: string) => {
    if (!alcance?.canManage) return false;
    if (alcance.orgWide) return true;
    return alcance.unitIds.includes(unitId);
  }, [alcance]);

  /**
   * Si quien mira puede cambiar de padre a esta unidad.
   *
   * Es más estrecho que `puedeTocar` por un caso: la raíz del propio alcance. Colgarla de otro
   * padre exige alcance sobre ese padre, que por definición está por encima —un gerente de zona
   * no puede mover su zona a otra región—. Ofrecer el botón ahí es prometer una acción que el
   * backend rechaza, y la pantalla existe justamente para no aprender la regla a base de 403.
   */
  const puedeMover = useCallback((u: SalesUnit) => {
    if (!puedeTocar(u.unitId) || !u.parentUnitId) return false;
    return alcance?.orgWide === true || u.unitId !== alcance?.unitId;
  }, [puedeTocar, alcance]);

  /**
   * El botón de mover, rotulado con el escalón al que va.
   *
   * «Mover» a secas obliga a abrir el diálogo para descubrir a dónde puede ir el nodo. Decir
   * «Mover a otra zona» contesta la pregunta antes de abrirlo, y de paso enseña la regla del
   * árbol: cada nodo cuelga del escalón inmediatamente superior y de ninguno más.
   */
  const botonMover = (u: SalesUnit) => {
    if (!puedeMover(u) || !onMoverUnidad) return null;
    const mio = nivelDe.get(u.levelId);
    // El escalón superior *que existe*, no `depth - 1`: los niveles se numeran con huecos para
    // poder insertar uno intermedio sin renumerar el árbol, y restar uno cae en el hueco.
    const arriba = niveles
      .filter((l) => l.depth < (mio?.depth ?? 0))
      .sort((a, b) => b.depth - a.depth)[0];
    if (!arriba) return null;

    // Sin otro destino posible no hay botón. Una región cuelga del nacional y nacional hay uno
    // solo: ofrecer «mover» ahí abre un diálogo que sólo puede decir que no hay a dónde ir, y un
    // botón que siempre lleva a un callejón enseña a desconfiar de los demás.
    const hayDestino = unidades.some(
      (c) => nivelDe.get(c.levelId)?.depth === arriba.depth && c.unitId !== u.parentUnitId,
    );
    if (!hayDestino) return null;

    return (
      <button
        type="button"
        className="bo-crumb"
        onClick={(e) => { e.stopPropagation(); onMoverUnidad(u); }}
      >
        Mover a otra {arriba.name.toLowerCase()}
      </button>
    );
  };

  const raiz = unidades.find((u) => u.unitId === datos.unitId);
  if (!raiz) return null;

  const columnas = 10;
  const filas: React.ReactNode[] = [];

  const pintaUnidad = (u: SalesUnit, prof: number, padre?: Monto) => {
    const nivel = nivelDe.get(u.levelId);
    const esHoja = (nivel?.depth ?? 0) >= profundidadHoja;
    const personas = personasDe.get(u.unitId) ?? [];

    // La unidad hoja *es* el ejecutivo: lleva su nombre y su cartera cuelga de él. Pintarla como
    // unidad y debajo a la persona repetiría el nombre dos veces y sugeriría dos niveles donde
    // hay uno.
    if (esHoja) {
      pintaEjecutivo(u, personas[0], prof, padre);
      return;
    }

    const clave = `u:${u.unitId}`;
    const abierto = !!abiertos[clave];
    const monto = montoDe[u.unitId];
    const hijos = hijosDe.get(u.unitId) ?? [];
    const conCartera = personas.filter(
      (p) => Number((p['portfolio'] as Monto | undefined)?.accounts ?? 0) > 0,
    );
    const expandible = hijos.length > 0 || conCartera.length > 0;
    const plantilla = plantillaDe.get(u.unitId);

    filas.push(
      // El renglón entero abre y cierra, no sólo el triángulo. Bajar cuatro escalones —país,
      // región, zona, sucursal— es el recorrido normal de esta pantalla, no la excepción, y
      // obligar a apuntarle a un triángulo de dieciocho píxeles cuatro veces hace que la tabla
      // parezca que no se abre.
      <tr
        key={clave}
        className={`bo-fila-arbol${abierto ? ' bo-fila-abierta' : ''}${expandible ? ' abrible' : ''}`}
        onClick={expandible ? () => void alternar(clave) : undefined}
      >
        <td>
          <div className="bo-arbol-celda" style={{ paddingLeft: prof * 18 }}>
            <span className="bo-tree-caret" aria-hidden="true">
              {!expandible ? '·' : abierto ? '▾' : '▸'}
            </span>
            <span className="bo-arbol-nombre">
              <b>{u.name}</b>
              <span className="bo-tree-code"> {nivel?.name ?? ''} · {u.code}</span>
              {/* Quién responde por esta rama, en el mismo renglón. Sin esto el nombre sólo
                  aparecía al expandir, y saber a quién llamar exigía abrir rama por rama. */}
              <span className="bo-responsable">
                {responsableDe(u.unitId) ?? <i>sin responsable asignado</i>}
              </span>
            </span>
            {!u.active && <Badge tone="warn">Inactiva</Badge>}
          </div>
        </td>
        <td className="num">{celdaPlantilla(plantilla)}</td>
        {celdasMonto(monto, padre)}
        <td className="num">{celdaOrigen(monto)}</td>
        <td className="num">{botonMover(u)}</td>
      </tr>,
    );

    if (!abierto) return;
    // Primero las ramas y después las personas sueltas: el árbol se lee de arriba abajo y un
    // gerente de sucursal metido entre dos zonas rompe esa lectura.
    hijos.forEach((h) => pintaUnidad(h, prof + 1, monto));
    // El responsable ya sale con su nombre en el renglón de la unidad, así que sólo se le da
    // renglón propio si trae cartera: ahí el renglón no repite un nombre, abre sus clientes.
    personas
      .filter((p) => Number((p['portfolio'] as Monto | undefined)?.accounts ?? 0) > 0)
      .forEach((p) => pintaPersona(p, prof + 1, monto));
  };

  /** Una unidad hoja y quien la ocupa, en un solo renglón. */
  const pintaEjecutivo = (u: SalesUnit, p: Record<string, unknown> | undefined,
                          prof: number, padre?: Monto) => {
    const id = p ? String(p['assigneeId']) : null;
    const clave = `e:${u.unitId}`;
    const abierto = !!abiertos[clave];
    const monto = (p?.['portfolio'] as Monto | undefined) ?? montoDe[u.unitId];
    const clientes = id ? clientesDe[id] : undefined;

    filas.push(
      <tr
        key={clave}
        className={`bo-fila-arbol${abierto ? ' bo-fila-abierta' : ''}${id ? ' abrible' : ''}`}
        onClick={id ? () => void alternar(clave, id) : undefined}
      >
        <td>
          <div className="bo-arbol-celda" style={{ paddingLeft: prof * 18 }}>
            <span className="bo-tree-caret" aria-hidden="true">
              {!id ? '·' : abierto ? '▾' : '▸'}
            </span>
            <span className="bo-arbol-nombre">
              {p ? String(p['name'] ?? u.name) : u.name}
              <span className="bo-tree-code"> {p ? String(p['email'] ?? 'ejecutivo') : 'sin titular'}</span>
            </span>
            {/* Una plaza vacía con cartera es un hueco de atención, no un dato de plantilla: son
                clientes que no tienen a quién llamar. */}
            {!p && <Badge tone="warn">Vacante</Badge>}
          </div>
        </td>
        <td className="num"><span className="bo-tree-code">—</span></td>
        {celdasMonto(monto, padre)}
        <td className="num">{celdaOrigen(monto)}</td>
        {/* El ejecutivo se mueve como nodo del árbol —a otra sucursal—, igual que una sucursal se
            mueve a otra zona. Es la misma operación en todos los escalones, y mover el nodo se
            lleva a la persona y su cartera con él: la cartera cuelga de quien la atiende, y quien
            la atiende cuelga de esta unidad. */}
        <td className="num">{botonMover(u)}</td>
      </tr>,
    );

    if (!abierto || !id) return;
    pintaClientes(clave, clientes, prof + 1, puedeTocar(u.unitId));
  };

  /** Alguien asignado a una unidad que no es hoja: un gerente de sucursal, de zona, regional. */
  const pintaPersona = (p: Record<string, unknown>, prof: number, padre?: Monto) => {
    const id = String(p['assigneeId']);
    const clave = `p:${id}`;
    const abierto = !!abiertos[clave];
    const monto = p['portfolio'] as Monto | undefined;
    const unidad = String(p['unitId'] ?? '');

    filas.push(
      <tr
        key={clave}
        className={`bo-fila-arbol abrible${abierto ? ' bo-fila-abierta' : ''}`}
        onClick={() => void alternar(clave, id)}
      >
        <td>
          <div className="bo-arbol-celda" style={{ paddingLeft: prof * 18 }}>
            <span className="bo-tree-caret" aria-hidden="true">{abierto ? '▾' : '▸'}</span>
            <span className="bo-arbol-nombre">
              {String(p['name'] ?? id)}
              <span className="bo-tree-code"> {String(p['email'] ?? 'responsable')}</span>
            </span>
            <Badge tone="muted">A cargo</Badge>
          </div>
        </td>
        <td className="num"><span className="bo-tree-code">—</span></td>
        {celdasMonto(monto, padre)}
        <td className="num">{celdaOrigen(monto)}</td>
        {/* Un responsable no es un nodo: está *asignado* a uno. Por eso cambia de unidad en vez
            de moverse de padre, y puede ir a cualquier escalón —un gerente de zona no vive en
            ninguna sucursal. */}
        <td className="num">
          {puedeTocar(unidad) && onMoverPersona && (
            <button type="button" className="bo-crumb"
                    onClick={(e) => { e.stopPropagation(); onMoverPersona(p); }}>
              Cambiar de unidad
            </button>
          )}
        </td>
      </tr>,
    );

    if (!abierto) return;
    pintaClientes(clave, clientesDe[id], prof + 1, puedeTocar(unidad));
  };

  const pintaClientes = (clave: string, clientes: ClienteEnCartera[] | 'cargando' | undefined,
                          prof: number, puede: boolean) => {
    if (clientes === 'cargando') {
      filas.push(
        <tr key={`${clave}:cargando`}>
          <td colSpan={columnas}><div style={{ paddingLeft: prof * 18 + 26 }}><Spinner /></div></td>
        </tr>,
      );
      return;
    }
    if (!clientes || clientes.length === 0) {
      filas.push(
        <tr key={`${clave}:vacio`}>
          <td colSpan={columnas}>
            <div className="bo-tree-empty" style={{ paddingLeft: prof * 18 + 26 }}>
              Sin clientes asignados.
            </div>
          </td>
        </tr>,
      );
      return;
    }
    clientes.forEach((c) => filas.push(
      <tr key={`${clave}:c:${c.partyId}`}>
        <td>
          <div className="bo-arbol-celda" style={{ paddingLeft: prof * 18 + 26 }}>
            <span className="bo-arbol-nombre">
              {c.nombre}
              <span className="bo-tree-code"> {c.tipo === 'BUSINESS' ? 'negocio' : 'persona'}</span>
            </span>
            {c.riesgo && <Badge tone={c.riesgo === 'ALTO' ? 'bad' : c.riesgo === 'MEDIO' ? 'warn' : 'ok'}>{c.riesgo}</Badge>}
          </div>
        </td>
        <td className="num" colSpan={columnas - 3}>
          <span className="bo-tree-code">cliente</span>
        </td>
        <td className="num" />
        <td className="num">
          {puede && onReasignarCliente && (
            <button type="button" className="bo-crumb" onClick={() => onReasignarCliente(c)}>
              Reasignar
            </button>
          )}
        </td>
      </tr>,
    ));
  };

  pintaUnidad(raiz, 0);

  return (
    <div className="bo-table-wrap">
      <table className="bo-table bo-arbol-cartera">
        <thead>
          <tr>
            <th>Unidad / responsable</th>
            <th className="num">Ejecutivos</th>
            <th className="num">Cuentas</th>
            <th className="num">Capital colocado</th>
            <th className="num" title="Cartera vencida oficial CNBV/IFRS-9: 90+ días">Vencida 90+</th>
            <th className="num" title="Exigible del periodo">A cobrar</th>
            <th className="num">Devengado s/cobrar</th>
            <th className="num">Adeudo total</th>
            <th className="num">Origen</th>
            <th className="num" />
          </tr>
        </thead>
        <tbody>{filas}</tbody>
      </table>
    </div>
  );
}

/** Plantilla de la rama: cuánta gente y cuánta coloca. */
function celdaPlantilla(p?: { total: number; conCartera: number }) {
  if (!p || p.total === 0) return <span className="bo-tree-code">—</span>;
  const ocioso = p.total - p.conCartera;
  return (
    <>
      {count(p.total)}
      <div className="bo-sub" title={`${p.conCartera} colocan, ${ocioso} sin cartera`}>
        {ocioso > 0 ? <span style={{ color: 'var(--bo-warn)' }}>{count(ocioso)} sin cartera</span>
                    : 'todos colocan'}
      </div>
    </>
  );
}

/**
 * Las cinco cifras de una rama.
 *
 * El capital lleva debajo qué proporción del padre representa: es lo que contesta «¿esta zona es
 * el problema o es que es la más grande?» sin sacar la calculadora. Sólo aparece cuando hay padre
 * —la raíz no es proporción de nada.
 */
function celdasMonto(m: Monto | undefined, padre?: Monto) {
  const vacio = !m || m.accounts === 0;
  if (vacio) {
    return (
      <>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <td className="num" key={i}><span className="bo-tree-code">—</span></td>
        ))}
      </>
    );
  }
  const parte = padre && padre.principal > 0 ? (m.principal * 100) / padre.principal : null;
  const devengado = m.accruedInterest ?? 0;
  const moratorios = m.penalty ?? 0;
  return (
    <>
      <td className="num">
        {count(m.accounts)}
        {m.delinquentAccounts > 0 && (
          <div className="bo-sub" style={{ color: 'var(--bo-bad)' }}>{count(m.delinquentAccounts)} vencidas</div>
        )}
      </td>
      <td className="num">
        <b>{money(m.principal)}</b>
        <div className="bo-sub">
          {parte != null && <>{percent(parte, 0)} de su rama · </>}
          ticket {moneyCompact(m.averageTicket ?? m.principal / Math.max(m.accounts, 1))}
        </div>
      </td>
      {/* Cartera vencida OFICIAL (90+), la misma que el panorama, con el IMOR debajo. El tramo
          31-90 va aparte porque es atraso y no cartera vencida: mezclarlos inflaba la mora de la
          red y la hacía discrepar del tablero. */}
      <td className="num">
        {m.overdue === 0 && !m.earlyArrears
          ? <span className="bo-tree-code">—</span>
          : (
            <>
              {m.overdue === 0
                ? <span className="bo-tree-code">—</span>
                : <span style={{ color: 'var(--bo-bad)', fontWeight: 650 }}>{money(m.overdue)}</span>}
              <div className="bo-sub" style={{ color: m.overdue > 0 ? 'var(--bo-bad)' : undefined }}>
                {m.overdue > 0 && <>IMOR {percent(m.delinquencyRate)}</>}
                {(m.earlyArrears ?? 0) > 0 && (
                  <span style={{ color: 'var(--bo-warn)' }}>
                    {m.overdue > 0 ? ' · ' : ''}{moneyCompact(m.earlyArrears)} en 31-90
                  </span>
                )}
              </div>
            </>
          )}
      </td>
      {/* Lo exigible: qué toca cobrar y cuánto de eso ya se pasó de fecha. Es la lectura de
          cobranza, distinta del capital expuesto que mide riesgo. */}
      <td className="num">
        {(m.dueThisPeriod ?? 0) === 0
          ? <span className="bo-tree-code">—</span>
          : (
            <>
              {money(m.dueThisPeriod)}
              {(m.pastDueAmount ?? 0) > 0 && (
                <div className="bo-sub" style={{ color: 'var(--bo-bad)' }}>
                  {money(m.pastDueAmount)} ya vencido
                </div>
              )}
            </>
          )}
      </td>
      <td className="num">
        {devengado === 0 ? <span className="bo-tree-code">—</span> : money(devengado)}
        {moratorios > 0 && <div className="bo-sub">+{money(moratorios)} moratorios</div>}
      </td>
      <td className="num">
        {money(m.totalDebt ?? m.principal + devengado + moratorios)}
      </td>
    </>
  );
}

/**
 * De dónde salió la colocación de esta rama.
 *
 * Va como columna y no como un bloque aparte al final de la pantalla porque no es un anexo: es un
 * atributo de cada rama. Una zona que coloca el 70% por terceros y otra que coloca todo con su
 * gente se dirigen distinto, y en un único «capital colocado» esa diferencia no aparece en
 * ningún renglón.
 */
function celdaOrigen(m?: Monto) {
  if (!m || m.accounts === 0) return <span className="bo-tree-code">—</span>;
  const share = m.distributorShare ?? 0;
  if (share === 0) return <Badge tone="muted">Propio</Badge>;
  if (share >= 99.5) return <Badge tone="info">Distribuidor</Badge>;
  return (
    <span title={`${count(m.distributorAccounts ?? 0)} cuentas por distribuidor`}>
      <Badge tone="info">Mixto</Badge>
      <div className="bo-sub">{percent(share, 0)} terceros</div>
    </span>
  );
}

/** Un cliente tal como se ve colgando de su ejecutivo. */
export interface ClienteEnCartera {
  partyId: string;
  nombre: string;
  tipo: string;
  riesgo: string | null;
  ejecutivoId: string | null;
  ejecutivoNombre: string | null;
}

function aCliente(c: Client): ClienteEnCartera {
  return {
    partyId: c.partyId,
    nombre: c.fullName ?? '—',
    tipo: c.partyType ?? 'INDIVIDUAL',
    riesgo: c.riskLevel ?? null,
    ejecutivoId: c.assignedExecutiveId ?? null,
    ejecutivoNombre: c.assignedExecutiveName ?? null,
  };
}

/** Reexportado para que las pantallas no tengan que volver a importar el SDK. */
export { salesOrgApi };
