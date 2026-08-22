import { useCallback, useEffect, useSyncExternalStore, type ReactNode } from 'react';
import type { Capability } from '@bo/shared-types';
import { getSession } from './session.js';

/**
 * Quién trae las capacidades.
 *
 * Se recibe como prop en vez de importar `@bo/api-client` aquí: ese paquete ya
 * depende de `@bo/auth` para leer el token, y cerrar el círculo rompería la
 * resolución de módulos. La dependencia va en un solo sentido y el shell —que
 * conoce a los dos— es quien las conecta.
 */
export type CapabilitiesLoader = () => Promise<{ roles: string[]; capabilities: Capability[] }>;

interface CapabilitiesValue {
  capabilities: Set<Capability>;
  roles: string[];
  loading: boolean;
  can: (c: Capability) => boolean;
}

interface Snapshot {
  caps: Set<Capability>;
  roles: string[];
  loading: boolean;
}

/**
 * El estado vive en `globalThis`, no en un contexto de React.
 *
 * Cada micro-frontend se carga con su propia copia de esta librería salvo que la
 * federación las deduplique, y en dev no siempre lo hace. Un contexto duplicado
 * no es "otra instancia del mismo contexto": es otro objeto, y el `useContext`
 * del remote cae al valor por defecto —`can() => false`—. El síntoma no era un
 * error sino algo peor: los botones de aprobar y rechazar simplemente no
 * aparecían, y la consola se veía correcta mientras escondía trabajo a quien sí
 * tenía permiso.
 *
 * Anclarlo en `globalThis` hace que todas las copias lean el mismo dato, haya
 * una o cinco, en dev y en build. Es el mismo criterio con el que ya vivía la
 * sesión: una sola verdad por pestaña.
 */
const KEY = '__bo_capabilities_store__';

interface Store {
  snapshot: Snapshot;
  listeners: Set<() => void>;
  set(next: Snapshot): void;
  subscribe(fn: () => void): () => void;
}

function store(): Store {
  const g = globalThis as unknown as Record<string, Store | undefined>;
  let s = g[KEY];
  if (!s) {
    s = {
      snapshot: { caps: new Set<Capability>(), roles: [], loading: true },
      listeners: new Set(),
      set(next: Snapshot) {
        this.snapshot = next;
        this.listeners.forEach((fn) => fn());
      },
      subscribe(fn: () => void) {
        this.listeners.add(fn);
        return () => { this.listeners.delete(fn); };
      },
    };
    g[KEY] = s;
  }
  return s;
}

/**
 * Las capacidades del usuario, una sola vez por sesión.
 *
 * Se piden al entrar y se guardan en memoria: es la respuesta a "qué puede
 * hacer esta persona", y cambia cuando cambia la sesión, no entre pantallas.
 * Pedirlas por módulo multiplicaría la misma llamada por cada remote.
 */
export function CapabilitiesProvider({
  loader,
  children,
}: {
  loader: CapabilitiesLoader;
  children: ReactNode;
}) {
  const session = getSession();

  useEffect(() => {
    const s = store();
    if (!session) { s.set({ caps: new Set(), roles: [], loading: false }); return; }
    let alive = true;
    s.set({ ...s.snapshot, loading: true });
    loader()
      .then((p) => { if (alive) s.set({ caps: new Set(p.capabilities), roles: p.roles, loading: false }); })
      // Sin capacidades no se inventa acceso: la consola queda sin módulos y el
      // usuario ve por qué, en vez de entrar a pantallas que van a dar 403.
      .catch(() => { if (alive) s.set({ caps: new Set(), roles: [], loading: false }); });
    return () => { alive = false; };
  }, [session?.token]);

  return <>{children}</>;
}

export function useCapabilities(): CapabilitiesValue {
  const s = store();
  const snapshot = useSyncExternalStore(
    useCallback((fn: () => void) => s.subscribe(fn), [s]),
    () => s.snapshot,
    () => s.snapshot,
  );
  return {
    capabilities: snapshot.caps,
    roles: snapshot.roles,
    loading: snapshot.loading,
    can: (c: Capability) => snapshot.caps.has(c),
  };
}

/**
 * Monta a sus hijos sólo si el usuario tiene la capacidad.
 *
 * **No los oculta: no los monta.** Esconder un botón con CSS deja el manejador
 * vivo y la llamada a un clic de distancia; el backend la rechazaría, pero la
 * consola no debería llegar a intentarlo.
 */
export function Can({
  capability,
  children,
  fallback = null,
}: {
  capability: Capability;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { can, loading } = useCapabilities();
  if (loading) return null;
  return can(capability) ? <>{children}</> : <>{fallback}</>;
}
