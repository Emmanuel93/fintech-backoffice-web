import { useMemo, useState } from 'react';
import { salesOrgApi, type SalesLevel, type SalesUnit, type UnitAssignment } from '@bo/api-client';
import { SelectorRuta } from '@bo/commercial';
import { Modal, Button, Collapsible, Spinner, useAsync, dateTime } from '@bo/design-system';

/**
 * Mover una unidad de padre, o una persona de unidad.
 *
 * <p>Reorganizar la fuerza de ventas es una operación normal —una sucursal cambia de zona, un
 * ejecutivo se pasa a otra sucursal— y no había forma de hacerla desde la consola: sólo dar de
 * alta. La alternativa era borrar y recrear, que pierde las asignaciones y la historia de quién
 * estuvo dónde.
 *
 * El destino se ofrece **ya filtrado** por dos cosas: el nivel que corresponde —una sucursal
 * cuelga de una zona y de nada más— y el alcance de quien mueve, porque la lista de `unidades` que
 * recibe ya viene recortada a su subárbol. El backend valida las dos igual —es quien manda— pero
 * ofrecer destinos imposibles convierte una pantalla de reorganización en un juego de adivinar
 * cuál va a ser rechazado.
 */
export function ReasignarUnidad({ unidad, unidades, niveles, onCerrar, onListo }: {
  unidad: SalesUnit;
  unidades: SalesUnit[];
  niveles: SalesLevel[];
  onCerrar: () => void;
  onListo: () => void;
}) {
  const [destino, setDestino] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nivelDe = useMemo(() => new Map(niveles.map((l) => [l.levelId, l])), [niveles]);
  const miNivel = nivelDe.get(unidad.levelId);

  /**
   * El escalón inmediatamente superior *que existe*, no `depth - 1`.
   *
   * Los niveles se numeran con huecos a propósito para poder insertar uno intermedio sin
   * renumerar el árbol, así que restar uno puede caer en un hueco y dejar el diálogo sin
   * candidatos ni etiqueta con la que explicarse.
   */
  const nivelSuperior = useMemo(
    () => niveles
      .filter((l) => l.depth < (miNivel?.depth ?? 0))
      .sort((a, b) => b.depth - a.depth)[0],
    [niveles, miNivel],
  );

  /** Si un nodo cuelga del que se está moviendo. Colgarlo de su propio hijo partiría el árbol. */
  const esDescendiente = useMemo(() => {
    const padreDe = new Map(unidades.map((u) => [u.unitId, u.parentUnitId]));
    return (id: string): boolean => {
      let cur: string | null | undefined = id;
      let guarda = 0;
      while (cur && guarda++ < 20) {
        if (cur === unidad.unitId) return true;
        cur = padreDe.get(cur) ?? null;
      }
      return false;
    };
  }, [unidades, unidad.unitId]);

  /** ¿Hay siquiera a dónde ir? Sin esto el diálogo se abre sólo para decir que no. */
  const candidatos = useMemo(() => {
    if (!nivelSuperior) return [];
    return unidades
      .filter((u) => nivelDe.get(u.levelId)?.depth === nivelSuperior.depth)
      .filter((u) => u.unitId !== unidad.parentUnitId)   // ahí ya está
      .filter((u) => !esDescendiente(u.unitId));
  }, [unidades, nivelDe, nivelSuperior, unidad.parentUnitId, esDescendiente]);

  /**
   * La raíz desde la que se baja: el nodo más alto que quien mueve alcanza a ver.
   *
   * Las `unidades` que llegan ya vienen recortadas a su alcance, así que el que no tiene padre
   * *dentro de esa lista* es su techo — para un gerente de zona, su zona; para un transversal, el
   * nacional. Empezar la cascada más arriba ofrecería ramas que no puede tocar.
   */
  const raizAlcance = useMemo(() => {
    const ids = new Set(unidades.map((u) => u.unitId));
    return unidades.find((u) => !u.parentUnitId || !ids.has(u.parentUnitId)) ?? unidades[0];
  }, [unidades]);

  /**
   * La ruta de un nodo desde la raíz, con el nombre de cada escalón.
   *
   * Es lo que convierte «mover Sucursal Culiacán» en una decisión informada: dos zonas pueden
   * llamarse parecido y colgar de regiones distintas, y elegir la equivocada del desplegable no
   * se nota hasta que la cartera aparece sumando en otra región. Mostrar de dónde sale y a dónde
   * llega —la ruta entera, no sólo el destino— es lo que hace visible el efecto real.
   */
  const rutaDe = useMemo(() => {
    const byId = new Map(unidades.map((u) => [u.unitId, u]));
    return (id: string | null | undefined): string[] => {
      const camino: string[] = [];
      let cur = id ? byId.get(id) : undefined;
      let guarda = 0;
      while (cur && guarda++ < 20) {
        camino.unshift(cur.name);
        cur = cur.parentUnitId ? byId.get(cur.parentUnitId) : undefined;
      }
      return camino;
    };
  }, [unidades]);

  const rutaHoy = [...rutaDe(unidad.parentUnitId), unidad.name];
  const rutaNueva = destino ? [...rutaDe(destino), unidad.name] : null;

  const mover = async () => {
    setGuardando(true); setError(null);
    try {
      await salesOrgApi.moveUnit(unidad.unitId, destino || null);
      onListo();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo mover');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal
      title={`Mover ${unidad.name} a otra ${(nivelSuperior?.name ?? 'unidad').toLowerCase()}`}
      subtitle={`${miNivel?.name ?? 'Unidad'} · ${unidad.code}`}
      onClose={onCerrar}
      size="narrow"
      actions={
        <Button variant="primary" onClick={() => void mover()} disabled={!destino || guardando}>
          {guardando ? 'Moviendo…' : 'Mover'}
        </Button>
      }
    >
      <p className="bo-page-sub" style={{ marginTop: 0 }}>
        Se mueve la rama completa. La unidad conserva su código, su gente y su cartera; lo que
        cambia es de quién cuelga — y con ella se mueve todo lo que tiene por debajo.
      </p>

      <div className="bo-ruta">
        <div className="bo-def-k">Hoy está en</div>
        <div className="bo-ruta-v">{rutaHoy.join(' › ')}</div>
      </div>

      {candidatos.length === 0 ? (
        <div className="bo-alert" style={{ marginTop: 14 }}>
          No hay otra unidad de la que pueda colgar: {miNivel?.name.toLowerCase() ?? 'este nivel'} sólo
          va bajo {nivelSuperior?.name.toLowerCase() ?? 'su nivel superior'},
          y no hay más candidatas dentro de tu alcance fuera de su propia rama.
        </div>
      ) : (
        <div style={{ marginTop: 14 }}>
          {/* Se baja por el árbol, un selector por escalón, en vez de buscar la unidad correcta
              en una lista de ochenta y siete. Cada paso sólo ofrece lo que cuelga del anterior,
              así que no se puede componer una ruta que no existe. */}
          <SelectorRuta
            unidades={unidades}
            niveles={niveles}
            raiz={raizAlcance}
            hastaDepth={nivelSuperior?.depth ?? 0}
            valor={destino}
            onChange={setDestino}
            inicial={unidad.parentUnitId}
            etiquetaFinal={`Pasa a colgar de esta ${nivelSuperior?.name.toLowerCase() ?? 'unidad'}`}
            // Ni ella misma ni su propia rama: un nodo no puede colgar de su descendiente.
            excluir={(u) => u.unitId === unidad.unitId || esDescendiente(u.unitId)}
          />

          {/* Dónde queda, dicho antes de guardar. Es la comprobación que se hace en voz alta
              —«entonces Culiacán pasa a Zona Noreste, que es de Región Norte»— y hasta ahora
              había que hacerla de memoria contra el árbol de la pantalla de atrás. */}
          {rutaNueva && (
            <div className="bo-ruta bo-ruta-nueva" style={{ marginTop: 12 }}>
              <div className="bo-def-k">Quedará en</div>
              <div className="bo-ruta-v">{rutaNueva.join(' › ')}</div>
            </div>
          )}
        </div>
      )}

      {error && <p style={{ color: 'var(--bo-bad)', fontSize: 13, marginTop: 12 }}>{error}</p>}
    </Modal>
  );
}

/** Mueve a una persona a otra unidad. Su cartera se va con ella, porque cuelga de ella. */
export function ReasignarPersona({ persona, unidades, niveles, onCerrar, onListo }: {
  persona: Record<string, unknown>;
  unidades: SalesUnit[];
  niveles: SalesLevel[];
  onCerrar: () => void;
  onListo: () => void;
}) {
  const [destino, setDestino] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [sacando, setSacando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const assigneeId = String(persona['assigneeId'] ?? '');
  const assigneeType = String(persona['assigneeType'] ?? 'STAFF');

  /**
   * Por dónde ha pasado.
   *
   * El árbol guarda las asignaciones cerradas a propósito —el histórico es append-only—, así que
   * «esta cartera cambió de sucursal en marzo» es una pregunta contestable. Se pide al abrir el
   * diálogo, que es el único momento en que hace falta.
   */
  const historial = useAsync(
    () => (assigneeId ? salesOrgApi.assignmentHistory(assigneeType, assigneeId) : Promise.resolve([])),
    [assigneeType, assigneeId],
  );

  /**
   * Hasta qué escalón se ofrece bajar: el último que **no** es hoja.
   *
   * La hoja es el ejecutivo, y un ejecutivo es un nodo con nombre propio, no un sitio donde
   * asignar a alguien más. Ofrecerlo como destino permitiría colgar a un gerente de otro
   * ejecutivo, que no significa nada en esta estructura.
   */
  const profundidadDestino = useMemo(() => {
    const conUnidades = new Set(unidades.map((u) => u.levelId));
    const usados = niveles.filter((l) => conUnidades.has(l.levelId)).map((l) => l.depth);
    const hoja = usados.length ? Math.max(...usados) : 0;
    const noHoja = usados.filter((d) => d < hoja);
    return noHoja.length ? Math.max(...noHoja) : hoja;
  }, [unidades, niveles]);

  const raizAlcance = useMemo(() => {
    const ids = new Set(unidades.map((u) => u.unitId));
    return unidades.find((u) => !u.parentUnitId || !ids.has(u.parentUnitId)) ?? unidades[0];
  }, [unidades]);

  const rutaDe = useMemo(() => {
    const byId = new Map(unidades.map((u) => [u.unitId, u]));
    return (id: string | null | undefined): string[] => {
      const camino: string[] = [];
      let cur = id ? byId.get(id) : undefined;
      let guarda = 0;
      while (cur && guarda++ < 20) {
        camino.unshift(cur.name);
        cur = cur.parentUnitId ? byId.get(cur.parentUnitId) : undefined;
      }
      return camino;
    };
  }, [unidades]);

  const unidadActual = unidades.find((u) => u.unitId === persona['unitId']);
  // La unidad hoja de un ejecutivo lleva su propio nombre —así cuelga su cartera—, así que
  // sola no ubica a nadie: la ruta entera sí.
  const dondeEsta = rutaDe(unidadActual?.unitId).join(' › ');
  const rutaDestino = destino ? rutaDe(destino) : null;
  const cartera = persona['portfolio'] as { accounts?: number } | undefined;
  const cuentas = cartera?.accounts ?? 0;

  const mover = async () => {
    setGuardando(true); setError(null);
    try {
      await salesOrgApi.reassignStaff(assigneeId, destino);
      onListo();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo reasignar');
    } finally {
      setGuardando(false);
    }
  };

  /**
   * Sacarla del árbol sin ponerla en otro sitio.
   *
   * Es lo que hace falta en una baja o una licencia, y hasta ahora sólo se podía «reasignar a otra
   * unidad», que obliga a inventarle un destino a alguien que ya no está. La consecuencia se dice
   * antes: su cartera deja de colgar de ninguna rama y pasa a la bolsa de cartera huérfana, donde
   * es visible —que es mejor que quedarse sumando en una sucursal donde ya no trabaja nadie.
   */
  const sacar = async () => {
    setSacando(true); setError(null);
    try {
      await salesOrgApi.endAssignment(assigneeType, assigneeId);
      onListo();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cerrar su asignación');
    } finally {
      setSacando(false);
    }
  };

  return (
    <Modal
      title={String(persona['name'] ?? 'Reasignar')}
      subtitle={String(persona['email'] ?? persona['assigneeId'] ?? '')}
      onClose={onCerrar}
      size="narrow"
      actions={
        <Button variant="primary" onClick={() => void mover()} disabled={!destino || guardando}>
          {guardando ? 'Reasignando…' : 'Reasignar'}
        </Button>
      }
    >
      {guardando ? <Spinner /> : (
        <>
          <div className="bo-ruta" style={{ marginBottom: 14 }}>
            <div className="bo-def-k">
              Está hoy en · se lleva {cuentas === 1 ? '1 cuenta' : `${cuentas} cuentas`}
            </div>
            <div className="bo-ruta-v">{dondeEsta || '—'}</div>
          </div>

          {cuentas > 0 && (
            <div className="bo-alert" style={{ marginBottom: 14 }}>
              {cuentas === 1 ? 'Su cuenta cuelga' : `Sus ${cuentas} cuentas cuelgan`} de la persona,
              no de la unidad: al moverla, esa cartera deja de sumar en{' '}
              <b>{dondeEsta || 'su unidad actual'}</b> y empieza a sumar en la nueva. Para dejarla
              donde está, reasigna primero los clientes a otro ejecutivo desde <b>Clientes</b>.
            </div>
          )}

          {/* Se baja por el árbol y se puede parar donde toque: un gerente de zona queda en la
              zona, uno de sucursal en la sucursal. Obligar a llegar al fondo dejaría a los
              puestos de mando sin destino posible. */}
          <SelectorRuta
            unidades={unidades}
            niveles={niveles}
            raiz={raizAlcance}
            hastaDepth={profundidadDestino}
            valor={destino}
            onChange={setDestino}
            inicial={String(persona['unitId'] ?? '') || null}
            etiquetaFinal="Sucursal (opcional)"
            permiteParcial
            excluir={(u) => u.unitId === persona['unitId']}
          />
          <p className="bo-page-sub" style={{ marginTop: 10 }}>
            Queda en el escalón más bajo que elijas: si sólo eliges región, queda a cargo de la
            región. Se cierra su asignación vigente y se abre la nueva — una persona está en una
            unidad a la vez.
          </p>
          {rutaDestino && (
            <div className="bo-ruta bo-ruta-nueva" style={{ marginTop: 12 }}>
              <div className="bo-def-k">Quedará en</div>
              <div className="bo-ruta-v">{rutaDestino.join(' › ')}</div>
            </div>
          )}

          <div style={{ marginTop: 16 }}>
            <Collapsible
              title="Por dónde ha pasado"
              count={historial.data?.length}
              subtitle="el histórico no se borra: reasignar cierra y abre"
            >
              {historial.loading ? <Spinner /> : historial.error ? (
                <p className="bo-page-sub">No se pudo leer el historial: {historial.error}</p>
              ) : (
                <Historial asignaciones={historial.data ?? []} rutaDe={rutaDe} />
              )}
            </Collapsible>
          </div>

          {/* Sacar del árbol: no es reasignar, es dejar de contar. Va abajo y en rojo porque la
              cartera se queda sin dueño, que es una consecuencia que hay que querer. */}
          <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--bo-border)' }}>
            <Button
              variant="danger"
              disabled={sacando || !assigneeId}
              title="Cierra su asignación vigente sin abrir otra"
              onClick={() => void sacar()}
            >
              {sacando ? 'Sacando…' : 'Sacar de la unidad'}
            </Button>
            <p className="bo-page-sub" style={{ marginTop: 8 }}>
              Para una baja o una licencia. Deja de contar en el árbol y{' '}
              {cuentas > 0
                ? <>sus {cuentas === 1 ? 'cuenta pasa' : `${cuentas} cuentas pasan`} a cartera sin dueño</>
                : <>no arrastra cartera, porque no tiene</>}
              . Se puede volver a asignar después; el historial lo conserva.
            </p>
          </div>
        </>
      )}

      {error && <p style={{ color: 'var(--bo-bad)', fontSize: 13, marginTop: 12 }}>{error}</p>}
    </Modal>
  );
}

/**
 * El historial de asignaciones, de lo más reciente a lo más antiguo.
 *
 * La unidad se nombra por su **ruta completa** y no por su nombre suelto: la unidad hoja de un
 * ejecutivo lleva su propio nombre, así que «Diego Lozano» como destino no ubica a nadie.
 */
function Historial({ asignaciones, rutaDe }: {
  asignaciones: UnitAssignment[];
  rutaDe: (id: string | null | undefined) => string[];
}) {
  if (asignaciones.length === 0) {
    return <p className="bo-page-sub">Sin asignaciones registradas todavía.</p>;
  }
  const orden = [...asignaciones].sort(
    (a, b) => (b.assignedAt ?? '').localeCompare(a.assignedAt ?? ''),
  );
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {orden.map((a) => {
        const ruta = rutaDe(a.unitId).join(' › ');
        return (
          <div key={a.assignmentId} className="bo-ruta">
            <div className="bo-def-k">
              {a.active ? 'Vigente desde' : 'Estuvo'} {dateTime(a.assignedAt)}
              {!a.active && a.endedAt && <> — hasta {dateTime(a.endedAt)}</>}
              {/* `assignedBy` es el identificador del empleado que lo hizo, no su nombre: la
                  estructura no resuelve nombres. Se acorta y se deja el completo al posarse
                  encima — un UUID de 36 caracteres a media frase la vuelve ilegible y no dice
                  más que sus primeros ocho. Quién es se busca en Usuarios o en la bitácora. */}
              {a.assignedBy && (
                <> · lo hizo <span className="bo-mono-sm" title={a.assignedBy}>{a.assignedBy.slice(0, 8)}</span></>
              )}
            </div>
            <div className="bo-ruta-v">{ruta || a.unitId}</div>
          </div>
        );
      })}
    </div>
  );
}
