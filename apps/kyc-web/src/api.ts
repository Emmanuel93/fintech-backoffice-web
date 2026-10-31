/**
 * El cliente de la liga pública. Pequeño a propósito y sin nada de la consola.
 *
 * No hay JWT: la liga se identifica por su token y, después del OTP, por una sesión corta que va
 * en `X-Kyc-Session`. Nada de esto debe poder confundirse con la sesión de un empleado, y por eso
 * este archivo no importa `@bo/api-client` — ni siquiera sus tipos.
 */

const API_URL = (import.meta.env.VITE_KYC_API_URL as string | undefined) ?? 'http://kyc.localhost:8090';
const BASE = `${API_URL.replace(/\/$/, '')}/api/v1/beneficiary/public`;

/** Por qué falló, con el `error` del cuerpo cuando lo hay: la pantalla decide por él, no por el texto. */
export class KycError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public body: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'KycError';
  }
}

export interface Invite {
  lenderName: string;
  beneficiaryFirstName: string | null;
  amount: number;
  fortnightlyPayment: number;
  termFortnights: number;
  totalToPay: number;
  phoneMask: string;
  status: string;
}

export type SessionStep = 'INE' | 'LIVENESS' | 'DATA' | 'CONSENTS' | 'SUBMIT' | 'DONE';

export interface SessionState {
  step: SessionStep;
  documents: string[];
  data: Partial<Record<string, unknown>> | null;
  consentsAccepted: boolean;
}

/** Lo que se lee de la INE. Sólo es una propuesta: ella lo corrige en el paso de datos. */
export interface Extracted {
  firstName?: string | null;
  lastName1?: string | null;
  lastName2?: string | null;
  curp?: string | null;
  rfc?: string | null;
  dateOfBirth?: string | null;
  street?: string | null;
  exteriorNumber?: string | null;
  neighborhood?: string | null;
  municipality?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
}

export interface PersonalData {
  firstName: string;
  lastName1: string;
  lastName2: string;
  curp: string;
  rfc: string;
  dateOfBirth: string;
  occupation: string;
  monthlyIncome: number;
  street: string;
  exteriorNumber: string;
  neighborhood: string;
  municipality: string;
  city: string;
  state: string;
  postalCode: string;
  clabe: string;
}

/** La versión del texto que se le enseña. Va con el consentimiento: sin ella no prueba a qué dijo que sí. */
export const CONSENT_TEXT_VERSION = 'kyc-beneficiaria-v1';

interface CallOptions {
  method?: 'GET' | 'POST' | 'PUT';
  json?: unknown;
  form?: FormData;
  session?: string;
}

async function call<T>(path: string, opts: CallOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (opts.json !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.session) headers['X-Kyc-Session'] = opts.session;
  // Con `FormData` no se pone Content-Type: el navegador escribe el `boundary`, y uno puesto a mano
  // sin él hace que el servidor no encuentre ningún archivo.

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.form ?? (opts.json !== undefined ? JSON.stringify(opts.json) : undefined),
    });
  } catch {
    throw new KycError(0, 'SIN_RED', 'No pudimos conectarnos. Revisa tu señal e intenta de nuevo.');
  }

  const text = await res.text();
  let body: Record<string, unknown> = {};
  try { body = text ? JSON.parse(text) : {}; } catch { /* un cuerpo que no es JSON no tiene `error` */ }

  if (!res.ok) {
    const code = typeof body.error === 'string' ? body.error : `HTTP_${res.status}`;
    const message = typeof body.message === 'string' ? body.message : 'Algo salió mal. Intenta de nuevo.';
    throw new KycError(res.status, code, message, body);
  }
  return body as T;
}

const enc = encodeURIComponent;

export const kycApi = {
  invite: (token: string) => call<Invite>(`/invites/${enc(token)}`),

  sendOtp: (token: string) =>
    call<{ sent: boolean; phoneMask: string; resendInSeconds: number }>(
      `/invites/${enc(token)}/otp`, { method: 'POST' }),

  verifyOtp: (token: string, code: string) =>
    call<{ sessionToken: string; expiresAt: string }>(
      `/invites/${enc(token)}/otp/verify`, { method: 'POST', json: { code } }),

  session: (s: string) => call<SessionState>('/session', { session: s }),

  uploadIne: (s: string, front: File, back: File) => {
    const form = new FormData();
    form.append('front', front);
    form.append('back', back);
    return call<{ extracted: Extracted }>('/session/ine', { method: 'POST', form, session: s });
  },

  uploadSelfie: (s: string, selfie: File) => {
    const form = new FormData();
    form.append('selfie', selfie);
    return call<{ captured: boolean; review: string }>('/session/liveness', { method: 'POST', form, session: s });
  },

  saveData: (s: string, data: PersonalData) =>
    call<{ ok: boolean }>('/session/data', { method: 'PUT', json: data, session: s }),

  acceptConsents: (s: string) =>
    call<{ ok: boolean }>('/session/consents', {
      method: 'POST',
      session: s,
      json: {
        privacyNotice: true,
        bureauAuthorization: true,
        creditOwnership: true,
        textVersion: CONSENT_TEXT_VERSION,
      },
    }),

  submit: (s: string, code: string) =>
    call<{ status: string; firstName: string | null; phoneMask: string | null }>(
      '/session/submit', { method: 'POST', json: { code }, session: s }),
};

/**
 * La sesión vive en `sessionStorage`, por liga: recargar la página retoma donde iba, y cerrar la
 * pestaña la olvida. `localStorage` la dejaría viva en un celular prestado.
 *
 * Todo va en try/catch porque en navegación privada de algunos navegadores el acceso truena; sin
 * almacenamiento el flujo sigue funcionando, sólo que una recarga pide el código otra vez.
 */
const key = (token: string) => `kredius.kyc.${token}`;

export function readSession(token: string): string | null {
  try { return sessionStorage.getItem(key(token)); } catch { return null; }
}

export function writeSession(token: string, sessionToken: string | null): void {
  try {
    if (sessionToken) sessionStorage.setItem(key(token), sessionToken);
    else sessionStorage.removeItem(key(token));
  } catch { /* sin almacenamiento: la recarga pedirá el código otra vez */ }
}
