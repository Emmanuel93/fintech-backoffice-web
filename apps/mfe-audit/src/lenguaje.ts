import type { AuditEntry } from '@bo/api-client';

/**
 * Traduce una entrada de bitácora a una frase que se lee sin manual.
 *
 * <p>Una bitácora regulatoria se revisa leyendo, no descifrando. La versión anterior mostraba
 * «ORIGINATION_CONTRACT_SIGNED · actor 00000000-…-0001 · agregado 6c4ce13a…», y con eso un
 * auditor no puede contestar ninguna de las preguntas que trae: quién entró a esto, desde dónde,
 * si tuvo éxito, y si era alguien de la casa o un cliente. Se pasaba el rato cruzando
 * identificadores contra otras pantallas.
 *
 * <p>Todo lo que hay aquí es presentación: el hecho ya viene resuelto del servicio —nombre,
 * correo, canal, IP, recurso con etiqueta—. Esto sólo lo ordena en una oración.
 */

/** Quién actúa, en los términos que usa un auditor: de la casa, o de fuera y de qué clase. */
export type TipoActor = 'INTERNO' | 'CLIENTE' | 'DISTRIBUIDOR' | 'NEGOCIO' | 'SISTEMA';

export const TIPO_ACTOR_LABEL: Record<TipoActor, string> = {
  INTERNO: 'Personal interno',
  CLIENTE: 'Cliente',
  DISTRIBUIDOR: 'Distribuidor',
  NEGOCIO: 'Empresa',
  SISTEMA: 'Sistema',
};

/**
 * De qué clase es quien actuó.
 *
 * <p>Se deduce del canal y del rol, que es lo que la bitácora guarda. El canal manda: quien entra
 * por el backoffice es de la casa aunque su rol no lo diga, y quien entra por la app es un
 * tercero. Sin actor identificado es el sistema —un evento de dominio que nadie disparó a mano—,
 * y distinguirlo importa: «nadie lo hizo» y «no sabemos quién lo hizo» son cosas distintas y
 * sólo la primera es aceptable.
 */
export function tipoActor(e: AuditEntry): TipoActor {
  const canal = (e.actorChannel ?? '').toUpperCase();
  const roles = (e.actorRoles ?? '').toUpperCase();

  if (!e.actor && !e.actorName) return 'SISTEMA';
  if (canal === 'SERVICE') return 'SISTEMA';
  if (canal === 'BACKOFFICE') return 'INTERNO';
  if (canal === 'MOBILE') {
    if (roles.includes('DISTRIBUTOR') || roles.includes('COLABORADOR')) return 'DISTRIBUIDOR';
    if (roles.includes('BUSINESS') || roles.includes('EMPRESA')) return 'NEGOCIO';
    return 'CLIENTE';
  }
  // Sin canal pero con actor: es un evento de dominio atribuido. Se trata como interno sólo si
  // trae rol de staff; en otro caso queda como sistema para no inventar una procedencia.
  return roles ? 'INTERNO' : 'SISTEMA';
}

export const CANAL_LABEL: Record<string, string> = {
  BACKOFFICE: 'Backoffice (consola interna)',
  MOBILE: 'App móvil',
  SERVICE: 'Servicio interno',
};

export function canalLabel(c: string | null | undefined): string {
  return c ? CANAL_LABEL[c.toUpperCase()] ?? c : 'sin canal (evento de dominio)';
}

export const CATEGORIA_LABEL: Record<string, string> = {
  BUSINESS: 'Hecho de negocio',
  AUTH: 'Autenticación',
  SENSITIVE_READ: 'Consulta de dato sensible',
  ACCESS: 'Navegación y consulta',
};

export function categoriaLabel(c: string | null | undefined): string {
  return c ? CATEGORIA_LABEL[c.toUpperCase()] ?? c : 'Sin clasificar';
}

/**
 * El verbo del hecho, en español y en pasado.
 *
 * <p>Los códigos de acción vienen del productor del evento y están en inglés e infinitivo. Un
 * acta se lee en pasado: «consultó», no «VIEW».
 */
const ACCION: Record<string, string> = {
  LOGIN: 'inició sesión',
  LOGIN_FAILED: 'intentó entrar sin lograrlo',
  LOGOUT: 'cerró sesión',
  VIEW: 'consultó',
  LIST: 'listó',
  SEARCH: 'buscó en',
  DOWNLOAD: 'descargó',
  CREATE: 'dio de alta',
  UPDATE: 'modificó',
  DELETE: 'eliminó',
  DECIDE: 'resolvió',
  APPROVE: 'aprobó',
  REJECT: 'rechazó',
  ASSIGN: 'reasignó',
  SIGN: 'firmó',
  PAY: 'registró un pago en',
  DISBURSE: 'desembolsó',
};

/**
 * El módulo o proceso donde ocurrió, con el nombre que se usa en la consola.
 *
 * <p>El servicio ya manda `resourceLabel` para lo que sabe etiquetar; esto cubre el resto para
 * que ningún renglón muestre el nombre técnico de un servicio en lugar de una pantalla.
 */
const MODULO: Record<string, string> = {
  origination: 'Crédito — solicitudes',
  'origination-service': 'Crédito — solicitudes',
  scoring: 'Evaluación de riesgo',
  'scoring-service': 'Evaluación de riesgo',
  identity: 'Accesos y sesiones',
  'identity-service': 'Accesos y sesiones',
  party: 'Clientes y distribuidores',
  'party-service': 'Clientes y distribuidores',
  'credit-portfolio': 'Cartera',
  'credit-portfolio-service': 'Cartera',
  'credit-product-service': 'Catálogo de productos',
  'sales-org': 'Estructura comercial',
  'sales-org-service': 'Estructura comercial',
  payments: 'Pagos',
  'payments-service': 'Pagos',
  charges: 'Cargos',
  'charges-service': 'Cargos',
  'channel-backoffice-service': 'Consola de backoffice',
  'channel-mobile-service': 'App del cliente',
  'audit-service': 'Bitácora',
  dashboard: 'Tablero',
};

export function moduloLabel(e: AuditEntry): string {
  return e.resourceLabel
    ?? MODULO[e.resourceType ?? '']
    ?? MODULO[e.domainSource]
    ?? e.domainSource;
}

/**
 * El hecho, en una oración.
 *
 * <p>Sujeto, verbo, objeto y desenlace: «Ana Torres consultó el expediente en Crédito —
 * solicitudes · sin éxito (403)». Es la línea que un auditor cita en su papel de trabajo, así que
 * tiene que sostenerse sola, sin la fila de al lado ni el detalle abierto.
 */
export function frase(e: AuditEntry): string {
  const quien = e.actorName ?? e.actorEmail ?? (e.actor ? 'un usuario identificado' : 'El sistema');
  const verbo = verboDesdeRuta(e) ?? ACCION[(e.action ?? '').toUpperCase()] ?? verboDesdeEvento(e.eventType);
  const donde = moduloLabel(e);
  const fallo = e.outcome && e.outcome.toUpperCase() !== 'SUCCESS';

  let f = `${quien} ${verbo} en ${donde}`;
  // Sobre quién, cuando se sabe. Es la mitad de la pregunta que el renglón no contestaba: «quién
  // abrió el expediente de esta persona» se respondía abriendo el detalle y resolviendo un UUID
  // contra otra pantalla. Con el nombre resuelto cabe en la misma oración.
  if (e.subjectName) f += `, sobre ${e.subjectName}`;
  if (fallo) f += ` — sin éxito${e.statusCode ? ` (${e.statusCode})` : ''}`;
  return f;
}

/**
 * Las escrituras que importan en una revisión, reconocidas por su ruta.
 *
 * <p>La bitácora registra toda escritura como `MUTATION`, sin decir cuál. Así, la firma de un
 * dictamen de identidad se leía «Olivia Paz generó un evento en Beneficiaries» —la misma frase que
 * un cierre de sesión—, y encontrar quién habilitó un depósito obligaba a abrir renglón por renglón
 * para leer el endpoint. La ruta ya lo dice; aquí se traduce.
 *
 * <p>Sólo se nombran las que alguien busca al auditar un crédito. Una ruta que no está aquí cae al
 * verbo genérico, que no miente: dice que hubo un cambio sin afirmar cuál.
 */
const RUTAS: Array<[RegExp, string]> = [
  [/\/beneficiaries\/placements\/[^/]+\/identity-review$/, 'firmó el dictamen de identidad de una beneficiaria'],
  [/\/compliance\/verifications\/[^/]+\/identity$/, 'firmó el dictamen de identidad'],
  [/\/compliance\/verifications\/[^/]+\/adjudicate$/, 'resolvió una coincidencia en listas'],
  [/\/origination\/applications\/[^/]+\/decision$/, 'resolvió la solicitud de crédito'],
  [/\/origination\/applications\/[^/]+\/request-documents$/, 'pidió documentos'],
  [/\/placements\/[^/]+\/approve$/, 'aprobó la colocación y asumió el riesgo'],
  [/\/clients\/[^/]+\/assign-executive$/, 'reasignó el ejecutivo de un cliente'],
  [/\/accounting\/periods\/[^/]+\/close$/, 'cerró el período contable'],
  [/\/auth\/(staff\/)?login$/, 'inició sesión'],
  [/\/auth\/(staff\/)?logout$/, 'cerró sesión'],
];

function verboDesdeRuta(e: AuditEntry): string | null {
  if (!e.httpPath || (e.httpMethod ?? 'GET').toUpperCase() === 'GET') return null;
  return RUTAS.find(([re]) => re.test(e.httpPath!))?.[1] ?? null;
}

/**
 * Cuando no hay `action`, el verbo sale del tipo de evento.
 *
 * <p>Los eventos de dominio no traen acción porque nadie los «hizo»: ocurrieron. Se leen como
 * hechos —«se registró»— y no como actos de una persona, que sería atribuirle a alguien algo
 * que la bitácora no sabe.
 */
function verboDesdeEvento(t: string): string {
  const s = t.toUpperCase();
  if (s.includes('LOGIN') && s.includes('FAIL')) return 'intentó entrar sin lograrlo';
  if (s.includes('LOGIN')) return 'inició sesión';
  if (s.includes('CREATED')) return 'quedó registrado';
  if (s.includes('APPROVED')) return 'quedó aprobado';
  if (s.includes('REJECTED')) return 'quedó rechazado';
  if (s.includes('SIGNED')) return 'quedó firmado';
  if (s.includes('UPDATED')) return 'se actualizó';
  if (s.includes('APPLIED')) return 'se aplicó';
  if (s.includes('ACTIVATED')) return 'se activó';
  return 'generó un evento';
}

/** El endpoint tal cual, para el detalle. Es la evidencia técnica del hecho. */
export function endpoint(e: AuditEntry): string | null {
  if (!e.httpPath) return null;
  return `${e.httpMethod ?? 'GET'} ${e.httpPath}${e.httpQuery ? `?${e.httpQuery}` : ''}`;
}

/** Éxito o no, con el código HTTP cuando lo hay. */
export function desenlace(e: AuditEntry): { texto: string; ok: boolean } {
  const ok = !e.outcome || e.outcome.toUpperCase() === 'SUCCESS';
  const codigo = e.statusCode ? ` · ${e.statusCode}` : '';
  if (ok) return { texto: `Correcto${codigo}`, ok: true };
  const map: Record<string, string> = {
    DENIED: 'Denegado por permisos',
    FAILED: 'Falló',
    FAILED_CREDENTIALS: 'Credenciales incorrectas',
    ACCOUNT_LOCKED: 'Cuenta bloqueada',
    ERROR: 'Error del servidor',
  };
  return { texto: (map[e.outcome!.toUpperCase()] ?? e.outcome!) + codigo, ok: false };
}

/**
 * El tipo de evento en español, para el filtro y el encabezado del detalle.
 *
 * <p>El código crudo se conserva al lado: es lo que se cita al pedirle al equipo que reproduzca
 * un caso, y traducirlo sin dejarlo visible obligaría a adivinar cuál era.
 */
export function eventoLabel(t: string): string {
  const map: Record<string, string> = {
    IDENTITY_LOGIN_SUCCESS: 'Inicio de sesión',
    IDENTITY_LOGIN_FAILED: 'Intento de acceso fallido',
    IDENTITY_LOGIN_CREDENTIAL_NOT_FOUND: 'Acceso con usuario inexistente',
    ORIGINATION_PROSPECT_CREATED: 'Prospecto creado',
    ORIGINATION_SCORE_REQUESTED: 'Score solicitado',
    ORIGINATION_APPLICATION_APPROVED: 'Solicitud aprobada',
    ORIGINATION_APPLICATION_REJECTED: 'Solicitud rechazada',
    ORIGINATION_DOCUMENTS_REQUESTED: 'Documentos solicitados',
    ORIGINATION_CONTRACT_SIGNED: 'Contrato firmado',
    SCORING_COMPLETED: 'Evaluación de riesgo completada',
    CREDIT_PORTFOLIO_ACCOUNT_ACTIVATED: 'Cuenta de crédito activada',
    CREDIT_PORTFOLIO_BALANCE_UPDATED: 'Saldo actualizado',
    CHARGES_CHARGE_APPLIED: 'Cargo aplicado',
    PAYMENTS_PAYMENT_APPLIED: 'Pago aplicado',
    ACCESS_VIEW: 'Consulta de pantalla',
    ACCESS_LIST: 'Listado consultado',
    ACCESS_DOWNLOAD: 'Descarga de documento',
    ACCESS_SEARCH: 'Búsqueda',
    ACCESS_MUTATION: 'Operación que modifica',
  };
  if (map[t]) return map[t];
  const partes = t.split('_');
  const resto = partes.slice(1).join(' ').toLowerCase();
  return resto ? resto.charAt(0).toUpperCase() + resto.slice(1) : t;
}
