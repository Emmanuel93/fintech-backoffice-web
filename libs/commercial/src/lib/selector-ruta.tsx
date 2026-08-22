import { useEffect, useMemo, useState } from 'react';
import type { SalesLevel, SalesUnit } from '@bo/api-client';
import { Field, Select } from '@bo/design-system';

/**
 * Elegir un destino bajando por el árbol, un escalón por selector.
 *
 * <p>Antes el destino era **una sola lista** con las ochenta y siete unidades de la red. Funciona
 * con cuatro nodos y deja de funcionar con ochenta: hay que reconocer la unidad correcta entre
 * zonas que se llaman parecido, sin ver de qué región cuelga cada una, y equivocarse no se nota
 * hasta que la cartera aparece sumando en otra parte del país.
 *
 * <p>Aquí se elige como se piensa: primero la región, luego la zona de esa región, luego la
 * sucursal de esa zona. Cada selector sólo ofrece lo que cuelga del anterior, así que **no se
 * puede componer una ruta que no existe**, y la profundidad la fija quien lo usa según qué se
 * esté moviendo: una sucursal se elige hasta zona, un ejecutivo hasta sucursal, un cliente hasta
 * ejecutivo.
 *
 * <p>Arranca precargado con la ruta actual del nodo. Reasignar casi siempre es mover algo *cerca*
 * —a la zona de al lado, no al otro extremo del país—, así que partir de dónde está ahorra
 * rehacer el camino entero y, sobre todo, deja ver de dónde sale.
 */
export function SelectorRuta({
  unidades, niveles, raiz, hastaDepth, valor, onChange, inicial, etiquetaFinal,
  excluir, permiteParcial,
}: {
  unidades: SalesUnit[];
  niveles: SalesLevel[];
  /** Desde dónde arranca la cascada. No se elige: es el contexto —la raíz del alcance. */
  raiz: SalesUnit;
  /** El escalón más profundo que se puede elegir. El último selector devuelve el destino. */
  hastaDepth: number;
  valor: string;
  onChange: (unitId: string) => void;
  /** La unidad donde está hoy lo que se mueve, para precargar el camino. */
  inicial?: string | null;
  /** Rótulo del último selector, que es el que de verdad decide. */
  etiquetaFinal?: string;
  /** Filtra qué se puede elegir en el último escalón (p. ej. excluir la propia rama). */
  excluir?: (u: SalesUnit) => boolean;
  /**
   * Si vale el escalón donde se pare, no sólo el último.
   *
   * Para mover **personas**: un gerente de zona vive en una zona y no en ninguna sucursal, así
   * que obligar a bajar hasta el fondo lo dejaría sin destino posible. Para mover **nodos** no
   * aplica —una sucursal cuelga de una zona y de nada más—, y ahí exigir el último escalón es lo
   * que impide dejar el árbol a medio armar.
   */
  permiteParcial?: boolean;
}) {
  const nivelDe = useMemo(() => new Map(niveles.map((l) => [l.levelId, l])), [niveles]);
  const porId = useMemo(() => new Map(unidades.map((u) => [u.unitId, u])), [unidades]);
  const raizDepth = nivelDe.get(raiz.levelId)?.depth ?? 0;

  /** Los escalones entre la raíz (excluida) y el destino (incluido). */
  const escalones = useMemo(
    () => niveles
      .filter((l) => l.depth > raizDepth && l.depth <= hastaDepth)
      .sort((a, b) => a.depth - b.depth),
    [niveles, raizDepth, hastaDepth],
  );

  /** Un unitId por escalón. `''` = todavía sin elegir. */
  const [ruta, setRuta] = useState<string[]>(() => escalones.map(() => ''));

  // Precarga: se sube desde donde está hoy hasta la raíz y se rellena cada escalón. Se hace en
  // un efecto y no al construir el estado porque las unidades pueden llegar después del primer
  // pintado, y entonces la ruta se armaría vacía y ya no se recalcularía nunca.
  useEffect(() => {
    if (!inicial || escalones.length === 0) return;
    const camino: string[] = escalones.map(() => '');
    let cur = porId.get(inicial);
    let guarda = 0;
    while (cur && guarda++ < 20) {
      const d = nivelDe.get(cur.levelId)?.depth;
      const i = escalones.findIndex((l) => l.depth === d);
      if (i >= 0) camino[i] = cur.unitId;
      cur = cur.parentUnitId ? porId.get(cur.parentUnitId) : undefined;
    }
    // El último escalón se precarga **sólo si sigue siendo elegible**. Reasignar un cliente
    // excluye a su ejecutivo actual —dárselo a quien ya lo tiene no es reasignar—, así que
    // precargarlo dejaba el selector en blanco mientras el resumen de abajo afirmaba «quedará
    // con» esa misma persona: dos partes del diálogo diciendo cosas distintas.
    const ultimo = camino.length - 1;
    const unidadUltima = camino[ultimo] ? porId.get(camino[ultimo]) : undefined;
    if (unidadUltima && excluir?.(unidadUltima)) camino[ultimo] = '';

    setRuta(camino);
    const destino = elegido(camino);
    if (destino) onChange(destino);
    // Sólo al abrir: después manda lo que la persona elija.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inicial, escalones.length, porId]);

  /** Qué unidad queda elegida: la del fondo, o la más profunda alcanzada si vale pararse antes. */
  const elegido = (camino: string[]): string => (permiteParcial
    ? [...camino].reverse().find(Boolean) ?? ''
    : camino[escalones.length - 1] ?? '');

  const elegir = (i: number, unitId: string) => {
    // Al cambiar un escalón, lo que cuelga de él deja de ser válido: una zona de otra región no
    // puede quedarse seleccionada. Borrarlo es lo que impide componer rutas imposibles.
    const nueva = ruta.map((v, j) => (j < i ? v : j === i ? unitId : ''));
    setRuta(nueva);
    onChange(elegido(nueva));
  };

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {escalones.map((l, i) => {
        const padre = i === 0 ? raiz.unitId : ruta[i - 1];
        const esUltimo = i === escalones.length - 1;
        const opciones = padre
          ? unidades
              .filter((u) => u.parentUnitId === padre && u.active)
              .filter((u) => !(esUltimo && excluir?.(u)))
              .sort((a, b) => a.name.localeCompare(b.name))
          : [];
        return (
          <Field key={l.levelId} label={esUltimo ? (etiquetaFinal ?? l.name) : l.name}>
            <Select
              value={ruta[i] ?? ''}
              onChange={(v) => elegir(i, v)}
              // Sin el escalón de arriba no hay nada que ofrecer, y un desplegable vacío que se
              // deja abrir sugiere que el dato falta en vez de que falta un paso.
              disabled={!padre}
              options={[
                {
                  value: '',
                  label: !padre
                    ? `Elige antes ${escalones[i - 1]?.name.toLowerCase() ?? 'el nivel anterior'}…`
                    : opciones.length === 0
                      ? `No hay ${l.name.toLowerCase()} disponible aquí`
                      : `Elige ${l.name.toLowerCase()}…`,
                },
                ...opciones.map((u) => ({ value: u.unitId, label: `${u.name} · ${u.code}` })),
              ]}
            />
          </Field>
        );
      })}
    </div>
  );
}
