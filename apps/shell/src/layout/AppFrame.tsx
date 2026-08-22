import { useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { clearSession, useCapabilities, useSession } from '@bo/auth';
import { authApi } from '@bo/api-client';
import { Brand, initials, ThemeToggle } from '@bo/design-system';
import { Buzon } from './Buzon';
import { ROLE_LABELS, type Role } from '@bo/shared-types';
import { NAV_SECTIONS, itemDe, seccionDe, type NavItem, type NavSection } from '../nav';

export function AppFrame({ children }: { children: ReactNode }) {
  const session = useSession();
  const location = useLocation();
  // El menú se arma de lo que el backend dice que esta persona puede hacer.
  const { can } = useCapabilities();
  const roles = (session?.user.roles ?? []) as Role[];

  const visible = (i: NavItem) =>
    (!i.capability || can(i.capability)) && (!i.roles || i.roles.some((r) => roles.includes(r)));

  // Lo pendiente de conectar cuelga del permiso de su sección, no del suyo —todavía no tiene
  // capacidad que declarar—. Sin esto, a quien no puede ver originación le aparecería una sección
  // «Originación» cuyo único renglón es un «Beneficiarios · sin conectar» que no le incumbe.
  const secciones = NAV_SECTIONS
    .map((s) => {
      const hayReales = s.items.some((i) => !i.pendiente && visible(i));
      return { ...s, items: hayReales ? s.items.filter((i) => i.pendiente || visible(i)) : [] };
    })
    .filter((s) => s.items.length > 0);

  const actual = itemDe(location.pathname);
  const seccionActual = seccionDe(location.pathname);

  const salir = async () => {
    try { await authApi.logout(); } catch { /* Sin servidor igual se sale de esta pestaña. */ }
    clearSession();
  };

  return (
    <div className="bo-frame">
      <aside className="bo-sidebar">
        {/* Sobre el azul de marca el tratamiento oficial es el invertido: cuadro blanco, K azul. */}
        <div className="bo-brand">
          <Brand variant="inverted" subtitle="Backoffice de crédito" />
        </div>

        {secciones.map((s) => (
          <Seccion
            key={s.key}
            seccion={s}
            abiertaPorDefecto={s.key === seccionActual?.key}
          />
        ))}

        <div className="bo-sidebar-foot">
          v0.2 · RBAC por capacidad y jerarquía<br />web → gateway → BFF backoffice
        </div>
      </aside>

      <div className="bo-main">
        <header className="bo-topbar">
          <div className="bo-topbar-title">
            {seccionActual && seccionActual.items.length > 1 && (
              <span style={{ color: 'var(--bo-text-muted)', fontWeight: 500 }}>
                {seccionActual.title} ·{' '}
              </span>
            )}
            {actual?.label ?? 'Backoffice'}
          </div>
          <div className="bo-user">
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 13, fontWeight: 650 }}>{session?.user.fullName}</div>
              <div style={{ fontSize: 11, color: 'var(--bo-text-muted)' }}>
                {roles.map((r) => ROLE_LABELS[r] ?? r).join(' · ')}
              </div>
            </div>
            <div className="bo-avatar">{initials(session?.user.fullName)}</div>
            <Buzon />
            <ThemeToggle />
            {/* Salir cierra la sesión también en identity, para que el token de renovación deje de
                servir. Se limpia el navegador **pase lo que pase** con la llamada: si el servidor
                no responde, dejar la sesión abierta en pantalla sería peor que no revocarla. */}
            <button className="bo-btn" onClick={() => { void salir(); }}>Salir</button>
          </div>
        </header>
        <main className="bo-content">{children}</main>
      </div>
    </div>
  );
}

/**
 * Una sección del menú.
 *
 * Con una sola pantalla dentro no hay nada que plegar: se pinta como entrada directa. Envolverla en
 * un encabezado que abre para revelar un único renglón con el mismo nombre es un clic que no
 * informa de nada.
 *
 * La sección que contiene la ruta actual arranca abierta, para que entrar por un enlace directo
 * deje el menú mostrando dónde se está parado. A partir de ahí manda quien navega: si la cierra, se
 * queda cerrada.
 */
function Seccion({ seccion, abiertaPorDefecto }: { seccion: NavSection; abiertaPorDefecto: boolean }) {
  const [abierta, setAbierta] = useState(abiertaPorDefecto);

  if (seccion.items.length === 1) {
    const i = seccion.items[0];
    return (
      <NavLink
        to={i.to}
        end
        className={({ isActive }) => `bo-nav-item ${isActive ? 'active' : ''}`}
      >
        <span className="bo-nav-ico">{seccion.icon}</span>{i.label}
      </NavLink>
    );
  }

  return (
    <div className="bo-nav-group">
      <button
        type="button"
        className={`bo-nav-head ${abiertaPorDefecto ? 'dentro' : ''}`}
        onClick={() => setAbierta((v) => !v)}
        aria-expanded={abierta}
      >
        <span className="bo-nav-ico" aria-hidden="true">{seccion.icon}</span>
        <span className="bo-nav-label">{seccion.title}</span>
        <span className="bo-nav-chev" data-abierto={abierta || undefined} aria-hidden="true">›</span>
      </button>

      {abierta && (
        <div className="bo-nav-sub">
          {seccion.items.map((i) => (i.pendiente ? (
            <div key={i.to} className="bo-nav-subitem soon" title={i.pendiente}>
              <span className="bo-nav-dot" />
              <span className="bo-nav-text">{i.label}</span>
              <span className="bo-nav-tag">sin conectar</span>
            </div>
          ) : (
            <NavLink
              key={i.to}
              to={i.to}
              end
              className={({ isActive }) => `bo-nav-subitem ${isActive ? 'active' : ''}`}
            >
              <span className="bo-nav-dot" />
              <span className="bo-nav-text">{i.label}</span>
            </NavLink>
          )))}
        </div>
      )}
    </div>
  );
}
