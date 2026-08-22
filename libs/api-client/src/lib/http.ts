import { getToken, getRefreshToken, clearSession, setSession, tokenPorCaducar } from '@bo/auth';
import type { LoginResponse } from '@bo/shared-types';
import { apiConfig, isMock } from './config.js';

/**
 * Por qué falló, no sólo con qué código.
 *
 * `FORBIDDEN_SCOPE` y `UNIT_REQUIRED` existen porque el backoffice tiene alcance
 * por subárbol: un ejecutivo que pide una unidad ajena recibe 403, y eso **no es
 * un error de la aplicación** — es la respuesta correcta a una pregunta que no
 * le toca hacer. Pintarlo como "algo salió mal" hace que reporte un bug que no
 * existe. `UNIT_REQUIRED` es el 400 de `/dashboard/commercial` sin `unitId`:
 * tampoco es un fallo, es que falta elegir unidad.
 */
export type ApiErrorKind =
  | 'UNAUTHORIZED'      // 401 — sesión vencida
  | 'FORBIDDEN'         // 403 sin alcance: el rol no tiene la capacidad
  | 'FORBIDDEN_SCOPE'   // 403 por alcance: fuera de su subárbol
  | 'UNIT_REQUIRED'     // 400 de /dashboard/commercial sin unitId
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'SERVER'
  | 'NETWORK';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public kind: ApiErrorKind = 'SERVER',
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** El backend contestó lo que debía; no hay nada que reportar. */
  get isExpected(): boolean {
    return this.kind === 'FORBIDDEN_SCOPE' || this.kind === 'UNIT_REQUIRED';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | undefined | null>;
}

/**
 * Convierte el cuerpo de error del BFF en algo que una persona pueda leer.
 *
 * El backend responde ProblemDetail (`detail`) y, en errores de validación de Spring, un objeto con
 * `errors[].defaultMessage`. Volcar ese JSON crudo en la pantalla —que es lo que se hacía— obliga al
 * usuario a interpretar un stack de validación para enterarse de que le faltó un campo.
 */
function humanize(status: number, body: string): string {
  if (!body) return `Error ${status}`;
  try {
    const parsed = JSON.parse(body) as {
      detail?: string;
      message?: string;
      errors?: Array<{ defaultMessage?: string; field?: string }>;
    };
    const validation = parsed.errors
      ?.map((e) => e.defaultMessage ?? e.field)
      .filter(Boolean)
      .join('. ');
    return validation || parsed.detail || parsed.message || `Error ${status}`;
  } catch {
    // No era JSON: se devuelve tal cual, acotado para que no reviente el layout.
    return body.length > 300 ? `${body.slice(0, 300)}…` : body;
  }
}

/**
 * Clasifica el fallo. El 400 de `/dashboard/commercial` sin `unitId` se
 * reconoce por su mensaje: el BFF pide explícitamente elegir una unidad, y eso
 * se pinta como una invitación, no como un error.
 */
function kindOf(status: number, body: string): ApiErrorKind {
  if (status === 400 && /unitId|indica unidad|elige una unidad/i.test(body)) return 'UNIT_REQUIRED';
  if (status === 400 || status === 422) return 'VALIDATION';
  if (status === 404) return 'NOT_FOUND';
  return 'SERVER';
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const { apiUrl } = apiConfig();
  const url = new URL(path.replace(/^\//, ''), apiUrl.endsWith('/') ? apiUrl : `${apiUrl}/`);
  if (query) {
    Object.entries(query).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
    });
  }
  return url.toString();
}

/* ============================ Renovación de la sesión ============================
 *
 * El token de acceso vive quince minutos. Sin renovarlo, la consola devuelve al login a media
 * tarea —con el formulario a medio llenar— y la única señal es un «Sesión expirada» que llega
 * cuando ya se perdió el trabajo. Es la fricción diaria más cara de la consola y se arregla aquí,
 * en el único sitio por el que pasan todas las peticiones.
 *
 * Dos caminos, y hacen falta los dos:
 *
 * - **Por adelantado**, cuando al token le queda menos de un minuto. Evita el 401 en la inmensa
 *   mayoría de los casos, que es lo que hace que no se note nada.
 * - **Reactivo**, al recibir un 401. Cubre lo que la marca local no puede saber: un reloj
 *   desfasado, una pestaña que estuvo dormida, o una sesión revocada y vuelta a emitir.
 *
 * La renovación es de **un solo vuelo**: la consola dispara media docena de peticiones en paralelo
 * al abrir una pantalla, y sin compartir la promesa cada una pediría su propio refresh. El
 * servidor rota el token de renovación, así que seis refresh simultáneos significan cinco
 * rechazados y una sesión cerrada — exactamente el fallo que se venía a evitar.
 */

const MARGEN_RENOVACION_MS = 60_000;

let renovacionEnVuelo: Promise<boolean> | null = null;

/** Las rutas de sesión no se renuevan a sí mismas: sería una recursión sin fondo. */
function esRutaDeSesion(path: string): boolean {
  return path.startsWith('/auth/staff');
}

async function renovarSesion(): Promise<boolean> {
  if (renovacionEnVuelo) return renovacionEnVuelo;

  renovacionEnVuelo = (async () => {
    const refreshToken = getRefreshToken();
    if (!refreshToken || isMock()) return false;
    try {
      // `fetch` a pelo y no `request`: pasar por aquí volvería a entrar en la renovación.
      const res = await fetch(buildUrl('/auth/staff/refresh'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) return false;
      // La respuesta trae los **roles vigentes**, no los del login: a quien le cambiaron el rol
      // se le actualiza la consola al renovar, sin tener que volver a entrar.
      setSession((await res.json()) as LoginResponse);
      return true;
    } catch {
      // Sin red no se cierra la sesión: al volver la conexión el token puede seguir sirviendo.
      return false;
    }
  })();

  try {
    return await renovacionEnVuelo;
  } finally {
    renovacionEnVuelo = null;
  }
}

function enviar(path: string, opts: RequestOptions): Promise<Response> {
  const token = getToken();
  return fetch(buildUrl(path, opts.query), {
    method: opts.method ?? 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: opts.body != null ? JSON.stringify(opts.body) : undefined,
  });
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const renovable = !esRutaDeSesion(path) && getRefreshToken() != null;

  if (renovable && tokenPorCaducar(MARGEN_RENOVACION_MS)) await renovarSesion();

  let res = await enviar(path, opts);

  // El 401 se reintenta **una sola vez**: si tras renovar sigue rechazando, el problema no es la
  // caducidad y volver a intentarlo sólo alarga la espera antes de mandar al login.
  if (res.status === 401 && renovable && await renovarSesion()) {
    res = await enviar(path, opts);
  }

  if (res.status === 401) {
    clearSession();
    throw new ApiError(401, 'Sesión expirada', 'UNAUTHORIZED');
  }
  if (res.status === 403) {
    // El BFF distingue "no tienes la capacidad" de "esa unidad no es tuya".
    // El segundo es alcance y se comunica distinto: no es un permiso faltante,
    // es que está preguntando por cartera de otro.
    const body = await res.text();
    const scoped = /alcance|scope|subárbol|subarbol/i.test(body);
    throw new ApiError(
      403,
      scoped ? 'Esta unidad está fuera de tu alcance' : 'No autorizado para esta operación',
      scoped ? 'FORBIDDEN_SCOPE' : 'FORBIDDEN',
    );
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new ApiError(res.status, humanize(res.status, text), kindOf(res.status, text));
  }
  if (res.status === 204) return undefined as T;
  // Varios endpoints del BFF contestan `ResponseEntity.ok().build()`: **200 con cuerpo vacío**
  // (OriginationController.java:299 para la decisión, y sus hermanos de pedir documentos y
  // documentos-recibidos). Con sólo el 204 contemplado, `res.json()` reventaba con "Unexpected
  // end of JSON input" y la consola daba por fallada una aprobación que el backend **sí** había
  // aplicado: la ficha se quedaba abierta con el estado viejo y el analista volvía a pulsar.
  const cuerpo = await res.text();
  if (cuerpo === '') return undefined as T;
  return JSON.parse(cuerpo) as T;
}

/**
 * Lo mismo que `request`, para respuestas binarias.
 *
 * Existe aparte porque el expediente no es JSON y porque el endpoint exige el
 * token: un `<img src="…">` no manda cabeceras, así que el archivo se baja aquí y
 * se entrega como `blob:` a quien lo va a pintar.
 */
export async function requestBlob(path: string): Promise<Blob> {
  // Misma renovación que `request`: abrir el expediente de un cliente es justo lo que se hace tras
  // un rato leyendo, que es cuando el token está por caducar.
  const renovable = getRefreshToken() != null;
  if (renovable && tokenPorCaducar(MARGEN_RENOVACION_MS)) await renovarSesion();

  const bajar = () => fetch(buildUrl(path), {
    headers: getToken() ? { Authorization: `Bearer ${getToken()}` } : {},
  });

  let res = await bajar();
  if (res.status === 401 && renovable && await renovarSesion()) res = await bajar();

  if (res.status === 401) {
    clearSession();
    throw new ApiError(401, 'Sesión expirada', 'UNAUTHORIZED');
  }
  if (res.status === 403) {
    throw new ApiError(403, 'Tu rol no puede ver el expediente', 'FORBIDDEN');
  }
  if (!res.ok) {
    throw new ApiError(res.status, `No se pudo abrir el documento (${res.status})`,
      kindOf(res.status, ''));
  }
  return res.blob();
}
