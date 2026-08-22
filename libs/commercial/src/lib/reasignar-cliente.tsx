import { useMemo, useState } from 'react';
import {
  clientsApi,
  type CommercialDashboard, type SalesLevel, type SalesUnit,
} from '@bo/api-client';
import { Modal, Button } from '@bo/design-system';
import type { ClienteEnCartera } from './arbol-cartera.js';
import { SelectorRuta } from './selector-ruta.js';

/**
 * Mueve un cliente de un ejecutivo a otro.
 *
 * <p>El ejecutivo se elige **bajando por el árbol** —región, zona, sucursal y ya entonces la
 * persona— y no de una lista plana de cincuenta y siete nombres. Repartir cartera es una decisión
 * territorial: se le da a alguien *de la sucursal que atiende esa plaza*, y en una lista
 * alfabética esa información no está por ningún lado. Con la cascada, el sitio se elige primero y
 * la persona después, que es el orden en que se piensa.
 *
 * <p>Los destinos son **los del alcance de quien reasigna**: el árbol que llega ya viene
 * recortado a su subárbol. Un gerente de zona reparte dentro de su zona; si pudiera elegir a
 * cualquiera del país estaría moviendo cartera fuera de lo que dirige, y el backend se lo
 * permitiría porque `assign-executive` no conoce estructura comercial.
 */
export function ReasignarCliente({ cliente, datos, unidades, niveles, onCerrar, onListo }: {
  cliente: ClienteEnCartera;
  datos: CommercialDashboard;
  unidades: SalesUnit[];
  niveles: SalesLevel[];
  onCerrar: () => void;
  onListo: () => void;
}) {
  /** La unidad hoja elegida. El ejecutivo es quien la ocupa. */
  const [unidadDestino, setUnidadDestino] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const asignados = useMemo(
    () => (datos.assignees ?? []) as Array<Record<string, unknown>>,
    [datos.assignees],
  );

  /** unitId → quién la ocupa. Es lo que convierte «elegí esta hoja» en «se la doy a esta persona». */
  const personaDe = useMemo(() => {
    const m = new Map<string, Record<string, unknown>>();
    asignados.forEach((a) => {
      const k = String(a['unitId'] ?? '');
      if (k && !m.has(k)) m.set(k, a);
    });
    return m;
  }, [asignados]);

  const profundidadHoja = useMemo(() => {
    const conUnidades = new Set(unidades.map((u) => u.levelId));
    const usados = niveles.filter((l) => conUnidades.has(l.levelId)).map((l) => l.depth);
    return usados.length ? Math.max(...usados) : 0;
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

  /** Dónde está hoy la cartera: la hoja que ocupa su ejecutivo actual. */
  const unidadActual = useMemo(() => {
    const suya = asignados.find((a) => String(a['assigneeId']) === cliente.ejecutivoId);
    return suya ? String(suya['unitId'] ?? '') : null;
  }, [asignados, cliente.ejecutivoId]);

  const nuevo = unidadDestino ? personaDe.get(unidadDestino) : undefined;
  const nuevoId = nuevo ? String(nuevo['assigneeId']) : '';
  const cuentasDelNuevo = Number(
    (nuevo?.['portfolio'] as { accounts?: number } | undefined)?.accounts ?? 0,
  );

  const mover = async () => {
    setGuardando(true); setError(null);
    try {
      await clientsApi.assignExecutive(cliente.partyId, nuevoId);
      onListo();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo reasignar');
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal
      title={cliente.nombre}
      subtitle="Reasignar cartera"
      onClose={onCerrar}
      size="narrow"
      actions={
        <Button variant="primary" onClick={() => void mover()} disabled={!nuevoId || guardando}>
          {guardando ? 'Reasignando…' : 'Reasignar'}
        </Button>
      }
    >
      <div className="bo-ruta" style={{ marginBottom: 14 }}>
        <div className="bo-def-k">Lo lleva hoy</div>
        <div className="bo-ruta-v">
          {unidadActual
            ? rutaDe(unidadActual).join(' › ')
            : (cliente.ejecutivoNombre ?? 'Sin ejecutivo asignado')}
        </div>
      </div>

      {/* Territorio primero, persona después: se baja región → zona → sucursal y el último
          escalón son los ejecutivos de esa sucursal. Una lista alfabética de cincuenta y siete
          nombres no dice quién atiende esa plaza, que es lo único que importa al repartir. */}
      <SelectorRuta
        unidades={unidades}
        niveles={niveles}
        raiz={raizAlcance}
        hastaDepth={profundidadHoja}
        valor={unidadDestino}
        onChange={setUnidadDestino}
        inicial={unidadActual}
        etiquetaFinal="Pasa a este ejecutivo"
        // Una plaza vacante no puede recibir cartera: no hay a quién dársela.
        excluir={(u) => !personaDe.has(u.unitId) || u.unitId === unidadActual}
      />

      {nuevo && (
        <div className="bo-ruta bo-ruta-nueva" style={{ marginTop: 12 }}>
          <div className="bo-def-k">Quedará con</div>
          <div className="bo-ruta-v">
            {String(nuevo['name'] ?? nuevoId)}
            <span className="bo-page-sub" style={{ display: 'block', fontWeight: 400 }}>
              {rutaDe(unidadDestino).slice(0, -1).join(' › ')} · lleva hoy{' '}
              {cuentasDelNuevo === 1 ? '1 cuenta' : `${cuentasDelNuevo} cuentas`}
            </span>
          </div>
        </div>
      )}

      <p className="bo-page-sub" style={{ marginTop: 10 }}>
        Sólo aparece lo que cae dentro de tu alcance. El capital de este cliente deja de sumar en
        la rama de origen y empieza a sumar en la de destino.
      </p>

      {error && <p style={{ color: 'var(--bo-bad)', fontSize: 13, marginTop: 12 }}>{error}</p>}
    </Modal>
  );
}
