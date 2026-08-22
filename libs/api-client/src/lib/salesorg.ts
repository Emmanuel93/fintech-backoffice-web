import { isMock } from './config.js';
import { request } from './http.js';

export interface SalesLevel {
  levelId: string; depth: number; code: string; name: string; active: boolean;
}

export interface SalesUnit {
  unitId: string; levelId: string; parentUnitId: string | null;
  code: string; name: string; partyRef: string | null;
  path?: string; active: boolean; createdAt?: string;
  /**
   * IVA que se traslada al colocar en esta unidad, como fracción (0.16 = 16%). El subárbol lo
   * hereda: `null` significa «lo que diga mi padre», no «cero».
   */
  vatRate?: number | null;
}

/**
 * Una asignación: quién está —o estuvo— en qué unidad.
 *
 * El histórico es **append-only**: mover a alguien cierra la asignación vigente (le pone
 * `endedAt`) y abre otra. Por eso «dónde estaba en marzo» es una pregunta que se puede contestar,
 * y por eso reasignar no borra nada.
 */
export interface UnitAssignment {
  assignmentId: string;
  unitId: string;
  assigneeType: string;
  assigneeId: string;
  assignmentRole: string | null;
  assignedBy: string | null;
  assignedAt: string | null;
  endedAt: string | null;
  active: boolean;
}

/**
 * Lo que trae una rama del árbol.
 *
 * Capital y mora contestan cuánto se colocó y cuánto está en riesgo; el devengado y los
 * moratorios contestan qué está ganando esa rama y cuánto de eso todavía no entra a caja. Son
 * lecturas distintas y hacen falta las cuatro para comparar dos sucursales: mismo capital con
 * distinta mora no vale lo mismo, y misma mora con distinto devengado tampoco.
 *
 * El origen —propio o por distribuidor— viene desglosado porque es la pregunta de estructura:
 * una rama que coloca a través de terceros tiene otro costo y otra palanca de dirección que una
 * que coloca con su propia gente, y sumadas en un solo número esa diferencia desaparece.
 */
export interface Monto {
  accounts: number;
  delinquentAccounts: number;
  principal: number;
  /**
   * Cartera vencida **oficial** (CNBV/IFRS-9): capital de cuentas con más de 90 días de atraso.
   *
   * No es «lo que trae algún día de atraso». Antes lo era, y por eso la mora de la red no
   * cuadraba con la del panorama: la misma cartera daba dos porcentajes según la pantalla y no
   * había forma de saber cuál llevar a un comité.
   */
  overdue: number;
  /** IMOR: vencida oficial sobre capital, 0-100. */
  delinquencyRate: number;
  /** Atraso temprano 31-90 días (SICR en IFRS-9). Atraso, todavía no cartera vencida. */
  earlyArrears?: number;
  /** Capital al corriente (≤30 días). */
  healthy?: number;
  /** Exigible del periodo: la suma de las mensualidades por cobrar. */
  dueThisPeriod?: number;
  /** Exigible que ya se pasó de fecha — lo que persigue cobranza, no el capital expuesto. */
  pastDueAmount?: number;
  /** Interés ya devengado que todavía no se cobra. Crece solo y es lo primero que se pierde. */
  accruedInterest?: number;
  /** Moratorios acumulados. */
  penalty?: number;
  /** Lo que se debe hoy: capital + devengado + moratorios. */
  totalDebt?: number;
  /** Capital entre cuentas. Lo calcula quien suma, para no repetir la división en cada tabla. */
  averageTicket?: number;
  ownAccounts?: number;
  ownPrincipal?: number;
  distributorAccounts?: number;
  distributorPrincipal?: number;
  /** Qué proporción del capital de la rama entró por un tercero, 0-100. */
  distributorShare?: number;
}

/**
 * Hasta dónde llega quien mira, según el BFF.
 *
 * La consola lo pregunta en vez de deducirlo para no ofrecer acciones que el backend va a
 * rechazar: descubrir lo que no puedes hacer intentándolo y recibiendo un 403 es la peor forma
 * de comunicar una regla. El backend sigue siendo la autoridad; esto sólo la describe.
 */
export interface AlcanceComercial {
  /** Rol transversal: ve y opera sobre cualquier unidad. */
  orgWide: boolean;
  /** La unidad de la que cuelga su alcance. Para un rol transversal, la raíz. */
  unitId: string | null;
  unitName: string | null;
  path: string | null;
  /** Si además puede reorganizar, o sólo mirar. */
  canManage: boolean;
  /** El subárbol completo sobre el que puede operar. */
  unitIds: string[];
}

/** Una rama con su nombre y sus números, para pintarla junto al árbol. */
export interface RamaConCartera extends Monto {
  unitId: string;
  name: string;
}

/** Cartera del subárbol de una unidad. Cada quien ve sólo lo suyo. */
export interface CommercialDashboard {
  unitId: string;
  /**
   * Asignaciones vigentes del subárbol, con nombre, correo y **su cartera**:
   * el BFF ya resolvió a quién pertenece cada crédito. Es lo que hace que
   * «cartera por ejecutivo» sea una tabla y no una promesa.
   */
  assignees?: Array<Record<string, unknown>>;
  executiveCount?: number;
  /** Total del subárbol. */
  portfolio?: Monto;
  /** El desglose por rama directa: es lo que se expande al bajar por el árbol. */
  byChildUnit?: RamaConCartera[];
  /** unitId → sus números, para anotar cada nodo del árbol sin pedirlos uno a uno. */
  byUnit?: Record<string, Monto>;
  distributorCartera?: Array<Record<string, unknown>>;
  distributorCount?: number;
  distributorPrincipal?: number;
  /**
   * La cartera viva que **no cuelga de nadie**: su cliente no tiene ejecutivo asignado, o lo
   * tiene sin adscripción en la estructura. Sólo viene en la raíz, porque en cualquier otro nodo
   * «lo que no cuelga de aquí» es simplemente el resto de la red.
   *
   * Existe porque este árbol y el panorama de cartera daban cifras distintas del mismo negocio
   * sin nada en pantalla que lo explicara. Sumada al total del árbol da el total de la red.
   */
  unassigned?: {
    accounts: number;
    principal: number;
    networkAccounts: number;
    networkPrincipal: number;
  } | null;
}


/**
 * Cartera atribuida a la unidad que **colocó** el crédito.
 *
 * Es la otra lectura de la misma red. `commercial()` atribuye por **ejecutivo actual**: si la
 * cartera se reasigna, se mueve de rama. Esto atribuye por la **unidad de origen sellada al
 * activar el préstamo**, que no se mueve nunca. Las dos son correctas y contestan preguntas
 * distintas —«de quién es hoy» contra «quién la colocó»— y por eso el BFF manda `attribution` y
 * `attributionNote`: la pantalla tiene que decir cuál está enseñando, o las dos cifras se leen
 * como una contradicción.
 *
 * El total del subárbol es exactamente la suma de sus unidades: cada cuenta se atribuye a una sola
 * unidad de origen. Eso hace la vista cotejable contra sí misma a cualquier altura del árbol.
 */
export interface MontoPorOrigen {
  accounts: number;
  delinquentAccounts: number;
  principal: number;
  /** 90+ días. La vencida oficial CNBV/IFRS-9 — el tramo 31-90 va aparte, con su nombre. */
  carteraVencida: number;
  atrasoTemprano: number;
  alCorriente: number;
  provision: number;
  delinquencyRate: number;
}

export interface RamaPorOrigen extends MontoPorOrigen {
  unitCode: string;
  unitName: string | null;
}

export interface CarteraPorOrigen {
  unitId: string;
  attribution: string;
  attributionNote: string;
  total: MontoPorOrigen;
  byUnit: RamaPorOrigen[];
}

export const salesOrgApi = {
  async levels(): Promise<SalesLevel[]> {
    if (!isMock()) return request<SalesLevel[]>('/sales-org/levels');
    return MOCK_LEVELS;
  },

  async units(): Promise<SalesUnit[]> {
    if (!isMock()) return request<SalesUnit[]>('/sales-org/units');
    return MOCK_UNITS;
  },

  async children(unitId: string): Promise<SalesUnit[]> {
    if (!isMock()) return request<SalesUnit[]>(`/sales-org/units/${unitId}/children`);
    return MOCK_UNITS.filter((u) => u.parentUnitId === unitId);
  },

  async unit(unitId: string): Promise<SalesUnit> {
    if (!isMock()) return request<SalesUnit>(`/sales-org/units/${unitId}`);
    return MOCK_UNITS.find((u) => u.unitId === unitId) ?? MOCK_UNITS[0];
  },

  /**
   * La unidad y todo lo que cuelga de ella.
   *
   * Lo resuelve el servidor con el `path` en LTREE, en una consulta. Derivarlo aquí recorriendo
   * `parentUnitId` funciona sólo mientras la consola tenga **todas** las unidades en memoria —hoy
   * las tiene—, y deja de funcionar el día que la lista se pagine, que es precisamente cuando el
   * árbol es grande y el error importa.
   */
  async subtree(unitId: string): Promise<SalesUnit[]> {
    if (!isMock()) return request<SalesUnit[]>(`/sales-org/units/${unitId}/subtree`);
    return MOCK_UNITS.filter((u) => u.unitId === unitId);
  },

  /** Quién trabaja en esta rama: asignaciones vigentes de todo su subárbol. */
  async unitScope(unitId: string): Promise<UnitAssignment[]> {
    if (!isMock()) return request<UnitAssignment[]>(`/sales-org/units/${unitId}/scope`);
    return [];
  },

  /** Asignaciones vigentes de una unidad, sin bajar a su subárbol. */
  async unitAssignments(unitId: string): Promise<UnitAssignment[]> {
    if (!isMock()) return request<UnitAssignment[]>(`/sales-org/units/${unitId}/assignments`);
    return [];
  },

  /**
   * Por dónde ha pasado una persona, de lo más reciente a lo más antiguo.
   *
   * Es la respuesta a «esta cartera cambió de sucursal, ¿cuándo y quién lo hizo?». Vive aquí y no
   * en la bitácora porque es un hecho del dominio, no un registro de acceso: la estructura guarda
   * las asignaciones cerradas a propósito.
   */
  async assignmentHistory(assigneeType: string, assigneeId: string): Promise<UnitAssignment[]> {
    if (!isMock()) {
      return request<UnitAssignment[]>(`/sales-org/assignments/${assigneeType}/${assigneeId}/history`);
    }
    return [];
  },

  /**
   * Saca a alguien de su unidad sin ponerlo en otra.
   *
   * Deja de contar en el árbol y su cartera pasa a estar sin dueño —aparece en el aviso de cartera
   * huérfana—. Es lo correcto para una baja o una licencia; para un cambio de adscripción está
   * `reassignStaff`, que cierra y abre en el mismo gesto.
   */
  async endAssignment(assigneeType: string, assigneeId: string): Promise<void> {
    if (isMock()) return;
    return request<void>(`/sales-org/assignments/${assigneeType}/${assigneeId}`, { method: 'DELETE' });
  },

  /**
   * Fija el IVA de una unidad. El subárbol lo hereda.
   *
   * `null` **borra** la tasa propia y devuelve la unidad a heredar la de su padre; no es lo mismo
   * que fijarla en cero, que sería declarar la rama exenta.
   */
  async setVatRate(code: string, rate: number | null): Promise<{ code: string; vatRate: number | null }> {
    if (isMock()) return { code, vatRate: rate };
    return request(`/sales-org/units/by-code/${code}/vat-rate`, {
      method: 'PUT',
      query: rate == null ? {} : { rate },
    });
  },

  /**
   * Da de alta un escalón de la jerarquía.
   *
   * Los niveles son configurables por diseño: se puede insertar «Plaza» entre Zona y Sucursal sin
   * migrar código ni renumerar el árbol. Sin `depth` se anexa al fondo; con `depth`, se inserta ahí
   * y corre hacia abajo los niveles iguales o más profundos.
   */
  async createLevel(body: { code: string; name: string; depth?: number | null }): Promise<SalesLevel> {
    if (isMock()) return { levelId: `l-${body.code}`, depth: body.depth ?? 9, code: body.code, name: body.name, active: true };
    return request<SalesLevel>('/sales-org/levels', { method: 'POST', body });
  },

  /**
   * Qué puede tocar quien está mirando.
   *
   * Se pide una vez al abrir la pantalla, no por fila: es la misma respuesta para todas y
   * consultarla por renglón convertiría una tabla de ochenta y siete nodos en ochenta y siete
   * peticiones para pintar unos botones.
   */
  async myScope(): Promise<AlcanceComercial> {
    if (!isMock()) return request<AlcanceComercial>('/sales-org/my-scope');
    return { orgWide: true, unitId: 'u0', unitName: 'México (Nacional)', path: 'MX', canManage: true, unitIds: ['u0'] };
  },

  /**
   * Cartera del subárbol.
   *
   * **Sin `unitId`** el BFF devuelve la unidad del propio usuario, que es como se
   * descubre dónde está parado; un rol transversal no tiene unidad propia y
   * recibe 400 pidiendo que elija. Fuera del alcance responde 403. Ninguno de los dos es un fallo: el primero es que falta
   * elegir, el segundo que está preguntando por cartera ajena. `ApiError.kind`
   * los distingue y la UI los explica en vez de disculparse.
   */
  /**
   * Cuelga una unidad de otro padre. La rama entera se mueve con ella.
   *
   * Reasignar y no borrar-y-recrear: la unidad conserva su id, así que conserva
   * también sus asignaciones y su historia de quién estuvo ahí.
   */
  async moveUnit(unitId: string, parentUnitId: string | null): Promise<SalesUnit> {
    if (isMock()) return { ...MOCK_UNITS[0], unitId, parentUnitId };
    return request<SalesUnit>(`/sales-org/units/${unitId}/parent`, {
      method: 'PUT',
      body: { parentUnitId },
    });
  },

  /** Mueve a una persona a otra unidad: se cierra la asignación vigente y se abre la nueva. */
  async reassignStaff(staffUserId: string, unitId: string): Promise<void> {
    if (isMock()) return;
    // Sin cerrar la anterior quedarían dos vigentes y el alcance sería ambiguo:
    // el mismo ejecutivo contaría su cartera en dos ramas del árbol.
    try {
      await salesOrgApi.endAssignment('STAFF', staffUserId);
    } catch {
      // No tenía asignación vigente: es el caso normal de alguien recién dado de alta.
    }
    await request<void>(`/sales-org/units/${unitId}/assignments`, {
      method: 'POST',
      body: { assigneeType: 'STAFF', assigneeId: staffUserId, assignmentRole: 'OWNER' },
    });
  },

  /**
   * Cartera del subárbol atribuida por **unidad de origen**, no por ejecutivo actual.
   *
   * Una llamada para todo el árbol: el BFF resuelve el subárbol en sales-org y pide el agregado a
   * credit-portfolio, que lo saca de un `GROUP BY origin_unit_code`. No depende de cuántas unidades
   * cuelguen ni de cuántas cuentas tengan.
   */
  async commercialByOriginUnit(unitId?: string): Promise<CarteraPorOrigen> {
    if (!isMock()) {
      return request<CarteraPorOrigen>('/dashboard/commercial/by-origin-unit', { query: { unitId } });
    }
    return {
      unitId: unitId ?? 'u0', attribution: 'ORIGIN_UNIT',
      attributionNote: 'Unidad que colocó el crédito, sellada al activarlo.',
      total: { accounts: 0, delinquentAccounts: 0, principal: 0, carteraVencida: 0, atrasoTemprano: 0, alCorriente: 0, provision: 0, delinquencyRate: 0 },
      byUnit: [],
    };
  },

  async commercial(unitId?: string): Promise<CommercialDashboard> {
    if (!isMock()) return request<CommercialDashboard>('/dashboard/commercial', { query: { unitId } });
    return { unitId: unitId ?? 'u0', executiveCount: 0, distributorCount: 0, distributorPrincipal: 0, distributorCartera: [] };
  },
};

const MOCK_LEVELS: SalesLevel[] = [
  { levelId: 'l0', depth: 0, code: 'NATIONAL', name: 'Nacional', active: true },
  { levelId: 'l1', depth: 1, code: 'REGION', name: 'Región', active: true },
  { levelId: 'l4', depth: 4, code: 'EXECUTIVE', name: 'Ejecutivo', active: true },
  { levelId: 'l5', depth: 5, code: 'DISTRIBUTOR', name: 'Distribuidor', active: true },
];
const MOCK_UNITS: SalesUnit[] = [
  { unitId: 'u0', levelId: 'l0', parentUnitId: null, code: 'MX', name: 'México (Nacional)', partyRef: null, active: true },
];
