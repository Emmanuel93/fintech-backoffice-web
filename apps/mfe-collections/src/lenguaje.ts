import type {
  AgreementStatus, AgreementType, CaseDetail, CaseStatus, CollectionsConfig,
  CommunicationHold, ContactResult, DelinquencyBucket, HoldReason,
  PromiseStatus, WriteOffReason,
} from '@bo/api-client';

/**
 * Cobranza en español, y en el orden en que se pregunta.
 *
 * <p>El dominio nombra los tramos de mora `B31_60` y las estrategias
 * `AGENT_ASSIGNED_RESTRUCTURE_OFFER`. Son etiquetas de base de datos: dicen el rango pero no dicen
 * qué toca hacer, que es lo único que un gestor necesita del bucket. Aquí se traducen las dos
 * cosas —el tramo y lo que implica— porque la pantalla de cobranza no se lee, se trabaja.
 */

export const ESTADO_CASO: Record<CaseStatus, string> = {
  OPEN: 'Abierto',
  MANAGED: 'En gestión',
  LEGAL: 'En legal',
  WRITTEN_OFF: 'Quebrantado',
  CLOSED: 'Cerrado',
};

/** Un caso terminal no acepta gestión: la pantalla entera pasa a sólo lectura. */
export function esTerminal(status: CaseStatus): boolean {
  return status === 'WRITTEN_OFF' || status === 'CLOSED';
}

export const BUCKET_LABEL: Record<DelinquencyBucket, string> = {
  CURRENT: 'Al corriente',
  B1_30: '1 a 30 días',
  B31_60: '31 a 60 días',
  B61_90: '61 a 90 días',
  B91_120: '91 a 120 días',
  B121_180: '121 a 180 días',
  B181_PLUS: 'Más de 180 días',
};

/** El semáforo del tramo. Es lo que ordena la bandeja de un vistazo. */
export function bucketTono(b: DelinquencyBucket): 'ok' | 'info' | 'warn' | 'bad' {
  switch (b) {
    case 'CURRENT': return 'ok';
    case 'B1_30': return 'info';
    case 'B31_60':
    case 'B61_90': return 'warn';
    default: return 'bad';
  }
}

/**
 * Qué toca hacer en este tramo, en una frase.
 *
 * <p>Traduce `strategy`, que el dominio deriva del bucket. Se muestra la frase y no el código
 * porque el código obliga a recordar la tabla; la frase es la instrucción.
 */
export const ESTRATEGIA: Record<string, string> = {
  PRE_DUE_REMINDER: 'Recordatorio antes del vencimiento',
  AUTO_NOTIFY: 'Aviso automático — cobranza temprana',
  AGENT_ASSIGNED_RESTRUCTURE_OFFER: 'Gestión con agente; ofrecer reestructura',
  INTENSIVE_LEGAL_PREVENTIVE: 'Gestión intensiva; preventivo legal',
  PRE_WRITEOFF_EXTERNAL_AGENCY: 'Pre-quebranto; despacho externo',
  EXTERNAL_AGENCY_QUITA_OFFER: 'Despacho externo; ofrecer quita',
  WRITEOFF_CANDIDATE: 'Candidato a quebranto',
};

export function estrategiaLabel(s: string | null | undefined): string {
  if (!s) return '—';
  return ESTRATEGIA[s] ?? s;
}

/**
 * Los cuatro primeros describen una llamada y los captura un agente; los tres últimos describen el
 * ciclo de vida de un mensaje y los escribe el sistema. Mezclarlos en una sola lista de captura
 * dejaría al gestor eligiendo «Entregado» al colgar el teléfono.
 */
export const RESULTADO_CONTACTO: Record<ContactResult, string> = {
  ANSWERED: 'Contestó',
  NO_ANSWER: 'No contestó',
  WRONG_NUMBER: 'Número equivocado',
  PROMISE_MADE: 'Prometió pagar',
  DELIVERED: 'Entregado',
  READ: 'Leído',
  FAILED: 'No se pudo entregar',
};

/** Los que un agente puede capturar. Los de entrega los pone el sistema. */
export const RESULTADOS_MANUALES: ContactResult[] =
  ['ANSWERED', 'NO_ANSWER', 'WRONG_NUMBER', 'PROMISE_MADE'];

export const ESCALON_TONO: Record<number, string> = {
  1: 'Recordatorio',
  2: 'Cómo pagar',
  3: 'Aviso de atraso',
  4: 'Historial crediticio',
  5: 'Ofrecimiento de ayuda',
};

export const MOTIVO_FRENO: Record<HoldReason, string> = {
  ACTIVE_PROMISE: 'Promesa vigente',
  PROMISE_KEPT: 'Cumplió lo prometido',
  AGREEMENT_IN_FLIGHT: 'Convenio en curso',
  AGENCY_ASSIGNED: 'Caso en despacho externo',
  MANUAL: 'Pausa manual',
};

/**
 * El freno vigente de un caso, o `null` si la cobranza automática está corriendo.
 *
 * <p>Cuando hay varios, vale el que termina más tarde: es el que efectivamente calla.
 */
export function frenoVigente(detail: CaseDetail): CommunicationHold | null {
  const activos = (detail.communicationHolds ?? []).filter((h) => h.active);
  if (activos.length === 0) return null;
  return activos.reduce((a, b) => (a.heldUntil >= b.heldUntil ? a : b));
}

export const CANAL_CONTACTO: Record<string, string> = {
  PHONE: 'Teléfono',
  SMS: 'SMS',
  EMAIL: 'Correo',
  WHATSAPP: 'WhatsApp',
  VISIT: 'Visita',
};

export const ESTADO_PROMESA: Record<PromiseStatus, string> = {
  ACTIVE: 'Vigente',
  KEPT: 'Cumplida',
  BROKEN: 'Rota',
  EXPIRED: 'Vencida',
};

export function promesaTono(s: PromiseStatus): 'ok' | 'info' | 'warn' | 'bad' {
  switch (s) {
    case 'KEPT': return 'ok';
    case 'ACTIVE': return 'info';
    case 'BROKEN': return 'bad';
    default: return 'warn';
  }
}

export const TIPO_CONVENIO: Record<AgreementType, string> = {
  RESTRUCTURE: 'Reestructura',
  QUITA_PARCIAL: 'Quita parcial',
};

export const ESTADO_CONVENIO: Record<AgreementStatus, string> = {
  PROPOSED: 'Propuesto',
  ACCEPTED: 'Aceptado — falta autorizar',
  REJECTED: 'Rechazado',
  EXPIRED: 'Expirado',
  EXECUTED: 'Ejecutado',
};

export function convenioTono(s: AgreementStatus): 'ok' | 'info' | 'warn' | 'bad' | 'muted' {
  switch (s) {
    case 'EXECUTED': return 'ok';
    case 'ACCEPTED': return 'warn';
    case 'PROPOSED': return 'info';
    case 'REJECTED': return 'bad';
    default: return 'muted';
  }
}

export const MOTIVO_QUEBRANTO: Record<WriteOffReason, string> = {
  UNRECOVERABLE: 'Irrecuperable',
  REGULATORY: 'Disposición regulatoria',
  LEGAL_SETTLEMENT: 'Convenio judicial',
};

/**
 * Por qué no se puede registrar un contacto ahora mismo, o `null` si sí se puede.
 *
 * <p>Se evalúa antes de habilitar el botón y con los límites que manda el servidor, no con copias
 * en el código. La ventana CONDUSEF y el tope diario devuelven 422 idénticos; sin decir cuál de los
 * dos fue, el gestor vuelve a intentar y vuelve a fallar.
 *
 * <p>La hora se compara con la del navegador, que es una aproximación: el dominio decide con la
 * suya. Por eso el mensaje describe la ventana en vez de afirmar que faltan tantos minutos — si los
 * relojes difieren, una cuenta regresiva mentiría con precisión.
 */
export function bloqueoContacto(
  detail: CaseDetail,
  config: CollectionsConfig | null,
): string | null {
  if (esTerminal(detail.status)) {
    return `El caso está ${ESTADO_CASO[detail.status].toLowerCase()}: ya no admite gestión.`;
  }
  if (!config) return null;

  const hora = new Date().getHours();
  if (hora < config.contactAllowedHoursStart || hora >= config.contactAllowedHoursEnd) {
    return `Fuera de la ventana de contacto permitida (${config.contactAllowedHoursStart}:00 a ${config.contactAllowedHoursEnd}:00).`;
  }

  const hoy = detail.contactAttemptsToday ?? 0;
  const tope = detail.maxContactAttemptsPerDay ?? config.maxContactAttemptsPerDay;
  if (hoy >= tope) {
    return `Ya se agotaron los ${tope} intentos de contacto de hoy para este caso.`;
  }
  return null;
}

/**
 * El máximo condonable en pesos, que es como se decide una quita.
 *
 * <p>Se calcula sobre `totalDebt` **del caso** y no sobre el saldo de cartera, aunque el saldo de
 * cartera sea el que se muestra: el dominio valida contra el suyo, y ofrecer un máximo calculado
 * con el otro número produce una quita que el backend rechaza por centavos.
 */
export function maximoCondonable(detail: CaseDetail, config: CollectionsConfig | null): number {
  if (!config || detail.totalDebt == null) return 0;
  return detail.totalDebt * config.maxForgivenessPct;
}

/** Días que le quedan a un convenio propuesto antes de que el job lo expire. */
export function diasParaExpirar(proposedAt: string, config: CollectionsConfig | null): number | null {
  if (!config) return null;
  const desde = new Date(proposedAt).getTime();
  if (Number.isNaN(desde)) return null;
  const transcurridos = Math.floor((Date.now() - desde) / 86_400_000);
  return Math.max(0, config.agreementResponseDays - transcurridos);
}
