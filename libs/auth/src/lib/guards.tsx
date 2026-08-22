import { useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import type { Role } from '@bo/shared-types';
import { getSession, subscribe, hasAnyRole, type Session } from './session.js';

/** Reactive session hook: re-renders on login/logout across the app. */
export function useSession(): Session | null {
  return useSyncExternalStore(subscribe, getSession, () => null);
}

export function useHasAnyRole(required: Role[]): boolean {
  // depend on session so it recomputes on change
  useSession();
  return hasAnyRole(required);
}

/** Renders children only when the current user holds one of the roles. */
export function RequireRole({ roles, children, fallback = null }: {
  roles: Role[]; children: ReactNode; fallback?: ReactNode;
}) {
  const ok = useHasAnyRole(roles);
  return <>{ok ? children : fallback}</>;
}
