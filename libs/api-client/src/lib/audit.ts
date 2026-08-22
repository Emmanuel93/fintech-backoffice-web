import { isMock } from './config.js';
import { request } from './http.js';

/**
 * Una entrada de la bitácora, tal como la publica el BFF.
 *
 * <p>El servicio ya resuelve lo que la tabla guarda como identificador —nombre y correo del
 * actor, etiqueta del recurso, fecha con zona horaria—, así que la consola no traduce UUIDs. Eso
 * importa: un auditor que lee «actor 00000000-0000-4000-8000-000000000001 sobre agregado
 * 6c4ce13a…» no está auditando, está transcribiendo.
 */
export interface AuditEntry {
  entryId: string;
  /** BUSINESS | AUTH | SENSITIVE_READ | ACCESS — de qué tipo de hecho se trata. */
  category: string | null;
  eventType: string;
  /** El verbo: LOGIN, VIEW, DOWNLOAD, CREATE, UPDATE, DECIDE… */
  action: string | null;
  domainSource: string;
  aggregateId: string | null;
  partyId: string | null;
  correlationId: string | null;

  // ── Quién ────────────────────────────────────────────────────────────────
  actor?: string | null;
  actorEmail?: string | null;
  actorName?: string | null;
  /**
   * CURP y teléfono de quien actuó, congelados al momento del acceso.
   *
   * Identificar plenamente a una persona física es requisito de trazabilidad, y un UUID no lo
   * hace. Vienen nulos en todo lo anterior a la migración 009 de audit-service: la bitácora es
   * inmutable y no hubo relleno hacia atrás, así que una entrada vieja sin CURP **no es un
   * fallo de resolución** —es que entonces no se registraba—. Por eso la pantalla los omite en
   * vez de pintar «—»: un guion invita a buscar por qué faltó.
   */
  actorCurp?: string | null;
  actorPhone?: string | null;
  actorRoles?: string | null;
  /** BACKOFFICE | MOBILE | SERVICE — por dónde entró. */
  actorChannel?: string | null;
  actorIp?: string | null;
  userAgent?: string | null;
  sessionId?: string | null;

  // ── Sobre quién se actuó ─────────────────────────────────────────────────
  /**
   * La otra mitad de la pregunta. «Quién actuó» acusa; «sobre quién» contesta *quién abrió el
   * expediente de esta persona*, que es con lo que empieza una revisión. Su identificador es
   * `partyId`, que antes venía vacío en el 91% de las entradas y ahora el canal sí llena.
   */
  subjectName?: string | null;
  subjectCurp?: string | null;
  subjectEmail?: string | null;
  subjectPhone?: string | null;

  // ── Sobre qué ────────────────────────────────────────────────────────────
  resourceType?: string | null;
  /** El módulo en lenguaje humano: «Solicitudes de crédito», no «origination». */
  resourceLabel?: string | null;
  resourceId?: string | null;

  // ── Cómo ─────────────────────────────────────────────────────────────────
  httpMethod?: string | null;
  httpPath?: string | null;
  httpQuery?: string | null;
  outcome?: string | null;
  statusCode?: number | null;
  durationMs?: number | null;

  // ── Cuándo ───────────────────────────────────────────────────────────────
  /** Cuando ocurrió el hecho. */
  occurredAt?: string | null;
  /** Ya formateada con zona horaria: «2026-08-12 10:44:34 CST». */
  occurredAtLabel?: string | null;
  createdAt: string;
  createdAtLabel?: string | null;

  /** Sólo en el detalle. Ya viene saneado: los secretos salen ***REDACTED***. */
  payload?: unknown;
}

export interface AuditQuery {
  /**
   * Lo que la persona escribió: teléfono, correo, CURP, contrato o UUID.
   *
   * El BFF lo traduce a los identificadores con los que la bitácora indexa —y
   * consulta los varios caminos que puede tomar un mismo dato—, así que la
   * consola no clasifica nada: manda el texto tal cual.
   */
  subject?: string;
  actor?: string;
  partyId?: string;
  aggregateId?: string;
  eventType?: string;
  from?: string;
  to?: string;
}

export const auditApi = {
  async list(query: AuditQuery = {}): Promise<AuditEntry[]> {
    if (!isMock()) return request<AuditEntry[]>('/audit/entries', { query: { ...query } });
    return MOCK_ENTRIES;
  },

  async detail(entryId: string): Promise<AuditEntry> {
    if (!isMock()) return request<AuditEntry>(`/audit/entries/${entryId}`);
    return MOCK_ENTRIES[0];
  },
};

const MOCK_ENTRIES: AuditEntry[] = [
  {
    entryId: 'a-1', category: 'BUSINESS', eventType: 'ORIGINATION_CONTRACT_SIGNED',
    action: 'SIGN', domainSource: 'origination-service',
    aggregateId: 'app-1', partyId: 'p-1', correlationId: 'c-1',
    createdAt: '2026-08-10T18:00:00Z', payload: { contractNumber: 'CTR-202608-DEMO' },
  },
];
