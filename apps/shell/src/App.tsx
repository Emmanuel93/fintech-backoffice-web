import { Component, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { useSession, CapabilitiesProvider, useCapabilities } from '@bo/auth';
import { Spinner } from '@bo/design-system';
import type { Capability, Role } from '@bo/shared-types';
import { permissionsApi } from '@bo/api-client';
import { lazyProvider } from './mf';
import { AppFrame } from './layout/AppFrame';
import { LoginPage } from './pages/LoginPage';
import { NAV_ALIASES, NAV_ITEMS } from './nav';

/**
 * Los remotes se instancian una sola vez, a nivel de módulo, para que navegar entre rutas no
 * desmonte ni vuelva a bajar el contenedor federado.
 *
 * Uno por **alias**, no uno por ruta: contabilidad tiene cuatro pantallas y un solo remote. Con una
 * entrada por ruta se creaban cuatro `lazy()` distintos del mismo contenedor y cambiar de pestaña
 * remontaba el módulo entero — perdiendo el período contable seleccionado en el camino.
 */
const REMOTES: Record<string, ReturnType<typeof lazyProvider<{ vista?: string }>>> =
  Object.fromEntries(NAV_ALIASES.map((a) => [a, lazyProvider<{ vista?: string }>(a, 'App')] as const));

/**
 * El puerto que el remote intentó cargar, sacado del propio error de federación.
 *
 * El mensaje llevaba el rango de puertos escrito a mano y envejeció dos veces —se quedó en 5108
 * mientras entraban cobranza y contabilidad—, así que mandaba a revisar puertos que no eran el del
 * módulo que falló. Derivarlo del error no puede quedarse viejo: lo dice el propio intento fallido.
 */
function puertoDelError(message: string): string | null {
  return /localhost:(\d{4,5})/.exec(message)?.[1] ?? null;
}

/**
 * The remote answered, but a shared library (@bo/*) it imports is an old copy: Vite's cache of the dev server, not
 * the code. Only a restart that rebuilds the cache fixes it (run-dev.sh starts Vite with --force).
 */
function esCopiaVieja(message: string): boolean {
  return /does not provide an export named/.test(message);
}

class RemoteBoundary extends Component<{ name: string; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    const { error } = this.state;
    if (error) {
      const puerto = puertoDelError(error.message);
      return (
        <div className="bo-card"><div className="bo-card-pad">
          <b>No se pudo cargar el módulo «{this.props.name}».</b>
          <p className="bo-page-sub">{error.message}</p>
          <p className="bo-page-sub">
            {esCopiaVieja(error.message)
              ? <>El módulo respondió, pero el servidor de desarrollo le sirve una copia vieja de una librería
                  compartida (<code>@bo/…</code>) que cambió después de arrancar. Reinicia <code>./run-dev.sh</code>:
                  arranca Vite con <code>--force</code> y las vuelve a empaquetar.</>
              : <>
                  {puerto
                    ? <>Nadie está sirviendo el puerto <b>{puerto}</b>. </>
                    : <>El remote no responde. </>}
                  Si <code>./run-dev.sh</code> lleva corriendo desde antes de que este módulo existiera, no
                  lo lanzó: reinícialo para que tome la lista completa.
                </>}
          </p>
        </div></div>
      );
    }
    return <Suspense fallback={<Spinner />}>{this.props.children}</Suspense>;
  }
}

function ModuleRoute({ alias, vista, capability, roles }: {
  alias: string; vista?: string; capability?: Capability; roles?: Role[];
}) {
  const { can, loading } = useCapabilities();
  const session = useSession();

  // Mientras no se sepan las capacidades no se decide: negar el acceso durante
  // la carga haría parpadear "acceso restringido" a quien sí lo tiene.
  if (loading) return <Spinner />;
  if (capability && !can(capability)) {
    return <Restringido motivo={<>Tu cuenta no tiene la capacidad «{capability}».</>} />;
  }
  // Lo que el BFF todavía autoriza por rol y no por capacidad. Comprobarlo aquí evita ofrecer una
  // pantalla que va a contestar 403 en la primera petición.
  if (roles && !roles.some((r) => (session?.user.roles ?? []).includes(r))) {
    return <Restringido motivo={<>Esta pantalla es de {roles.join(' o ')}.</>} />;
  }

  const Remote = REMOTES[alias];
  // La vista va como prop y no como `key`: remontar el módulo al cambiar de pantalla tiraría lo que
  // vale para todas —el período contable de contabilidad, por ejemplo—, y volver de «Balanza» a
  // «Pólizas» reabriría en el mes por defecto en vez de en el que se venía trabajando.
  return <RemoteBoundary name={alias}><Remote vista={vista} /></RemoteBoundary>;
}

function Restringido({ motivo }: { motivo: ReactNode }) {
  return (
    <div className="bo-card"><div className="bo-card-pad">
      <b>Acceso restringido</b>
      <p className="bo-page-sub">{motivo}</p>
    </div></div>
  );
}

function Protected() {
  const session = useSession();
  if (!session) return <Navigate to="/login" replace />;
  // Las capacidades se piden una vez por sesión y envuelven todo lo autenticado:
  // la nav, las rutas y las acciones dentro de cada módulo leen del mismo lugar.
  return (
    <CapabilitiesProvider loader={permissionsApi.me}>
      <AppFrame><Outlet /></AppFrame>
    </CapabilitiesProvider>
  );
}

function PublicOnly({ children }: { children: ReactNode }) {
  const session = useSession();
  if (session) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<PublicOnly><LoginPage /></PublicOnly>} />
        <Route element={<Protected />}>
          {NAV_ITEMS.map((i) => (
            <Route
              key={i.to}
              path={i.to}
              element={<ModuleRoute alias={i.alias} vista={i.vista} capability={i.capability} roles={i.roles} />}
            />
          ))}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
