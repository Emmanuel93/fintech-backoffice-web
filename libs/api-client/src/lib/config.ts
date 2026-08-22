// Runtime config for the BFF SDK. Two modes:
//  - 'mock'  → data served from an in-memory dataset (default; app runs with no backend)
//  - 'live'  → real calls to channel-backoffice-service through the gateway subdomain
//
// Switch by setting VITE_API_MODE=live and VITE_BO_API_URL in an app .env, or at
// runtime via window.__BO_CONFIG__ = { mode, apiUrl }.

export type ApiMode = 'mock' | 'live';

interface BoConfig {
  mode: ApiMode;
  apiUrl: string;

  /**
   * Contraseña compartida de los usuarios sembrados, para los accesos rápidos por rol.
   * Solo se define en `.env.local` (que no se comparte) o en `window.__BO_CONFIG__`: si no
   * está, los atajos no se pintan. Nunca va en el código ni en un `.env` versionado.
   */
  devPassword?: string;
}

declare global {
  interface Window {
    __BO_CONFIG__?: Partial<BoConfig>;
  }
}

function env(key: string): string | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (import.meta as any).env?.[key];
  } catch {
    return undefined;
  }
}

export function apiConfig(): BoConfig {
  const runtime = typeof window !== 'undefined' ? window.__BO_CONFIG__ ?? {} : {};
  const mode = (runtime.mode ?? env('VITE_API_MODE') ?? 'mock') as ApiMode;
  const apiUrl = runtime.apiUrl ?? env('VITE_BO_API_URL') ?? 'http://backoffice.localhost:8080';
  const devPassword = runtime.devPassword ?? env('VITE_DEV_PASSWORD');
  return { mode, apiUrl, devPassword };
}

export function isMock(): boolean {
  return apiConfig().mode === 'mock';
}

/**
 * Contraseña a usar en los accesos rápidos por rol. En mock vale cualquier cosa; en live tiene
 * que ser la real de los empleados sembrados. `null` = no hay atajos que pintar.
 */
export function quickLoginPassword(): string | null {
  const { mode, devPassword } = apiConfig();
  if (mode === 'mock') return 'demo';
  return devPassword && devPassword.length > 0 ? devPassword : null;
}
