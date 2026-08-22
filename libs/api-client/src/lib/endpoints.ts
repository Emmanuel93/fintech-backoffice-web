import type {
  LoginRequest, LoginResponse, DashboardSummary, Page, CreditAccount, AccountDetail,
  Client, ClientDetail, ProductDefinition, CreateProductVersionRequest, CreditApplication,
  Role, ProductType, Installment, Distributor, DistributorDetail,
} from '@bo/shared-types';
import { isMock } from './config.js';
import { request } from './http.js';
import {
  ACCOUNTS, CLIENTS, PRODUCTS, APPLICATIONS, EXECUTIVES, DISTRIBUTORS, type Executive,
  stageOf, provisionRate, originatedCreditsOf,
} from './mock-data.js';

export interface DemoUser { email: string; name: string; roles: Role[] }
export const DEMO_USERS: DemoUser[] = [
  { email: 'admin@kredius.mx', name: 'Admin Kredius', roles: ['ADMIN'] },
  { email: 'analista@kredius.mx', name: 'Sandra Núñez', roles: ['CREDIT_ANALYST', 'RISK_ANALYST'] },
  { email: 'ejecutivo@kredius.mx', name: 'Ana Torres', roles: ['EXECUTIVE'] },
  { email: 'comite@kredius.mx', name: 'Comité de Crédito', roles: ['UNDERWRITER', 'COMMITTEE'] },
  { email: 'producto@kredius.mx', name: 'Pablo Vela', roles: ['PRODUCT_MANAGER'] },

  // Un responsable por escalón del árbol comercial. Todos con el mismo rol a
  // propósito: el rol dice *qué* puede hacer y la unidad *sobre qué*. Entrar con
  // uno y con otro es la forma de ver el alcance, que con el admin no se aprecia
  // —los roles transversales ven toda la red por diseño—.
  { email: 'nacional@kredius.mx', name: 'Rodrigo Castañeda · Nacional', roles: ['EXECUTIVE'] },
  { email: 'region@kredius.mx', name: 'Paulina Serrano · Región Norte', roles: ['EXECUTIVE'] },
  { email: 'zona@kredius.mx', name: 'Emilio Ávalos · Zona Noroeste', roles: ['EXECUTIVE'] },
  { email: 'sucursal@kredius.mx', name: 'Marisol Cuevas · Sucursal Culiacán', roles: ['EXECUTIVE'] },
  { email: 'ejecutivo.cul@kredius.mx', name: 'Diego Lozano · Ejecutivo', roles: ['EXECUTIVE'] },
];

const wait = <T,>(v: T, ms = 240): Promise<T> => new Promise((r) => setTimeout(() => r(v), ms));

function paginate<T>(all: T[], page = 0, size = 25): Page<T> {
  const start = page * size;
  return {
    content: all.slice(start, start + size),
    page, size,
    totalElements: all.length,
    totalPages: Math.max(1, Math.ceil(all.length / size)),
  };
}

/* ============================ auth ============================ */

export const authApi = {
  /**
   * Cierra la sesión **en el servidor**, no sólo en esta pestaña.
   *
   * Borrar el `localStorage` deja el token de renovación vivo en identity: quien tuviera una copia
   * podría seguir emitiendo tokens de acceso después de que la persona pulsó «Salir». Cerrarlo en
   * el emisor es lo que hace que salir signifique algo.
   *
   * El access token que ya está emitido sigue siendo válido hasta que caduque —el gateway valida
   * la firma localmente y no consulta revocación—, así que esto corta la renovación, no el minuto
   * que le quede al token en curso.
   */
  async logout(): Promise<void> {
    if (isMock()) return;
    return request<void>('/auth/staff/logout', { method: 'POST' });
  },

  /** El empleado de la sesión, releído del servidor. Sirve para confirmar roles vigentes. */
  async me(): Promise<LoginResponse['user']> {
    if (!isMock()) return request<LoginResponse['user']>('/auth/staff/me');
    const raw = localStorage.getItem('bo.user');
    if (!raw) throw new Error('Sin sesión');
    return JSON.parse(raw) as LoginResponse['user'];
  },

  async login(req: LoginRequest): Promise<LoginResponse> {
    if (!isMock()) return request<LoginResponse>('/auth/staff/login', { method: 'POST', body: req });
    const demo = DEMO_USERS.find((u) => u.email === req.email) ?? DEMO_USERS[1];
    return wait({
      accessToken: `mock.${btoa(demo.email)}.${Date.now()}`,
      refreshToken: 'mock.refresh',
      expiresIn: 900,
      channel: 'BACKOFFICE',
      user: {
        id: `STF-${demo.email}`,
        email: demo.email,
        fullName: demo.name,
        employeeType: 'INTERNO',
        roles: demo.roles,
      },
    });
  },
};

/* ============================ dashboard ============================ */

function computeSummary(): DashboardSummary {
  const active = ACCOUNTS.filter((a) => a.status === 'ACTIVE');
  const sum = (xs: CreditAccount[], f: (a: CreditAccount) => number) => xs.reduce((s, a) => s + f(a), 0);
  const sana = sum(active.filter((a) => a.ifrs9Stage === 'STAGE_1'), (a) => a.principalBalance);
  // Vencida oficial CNBV/IFRS-9: sólo STAGE_3 (90+). El tramo 31-90 es atraso temprano (SICR) y
  // se lleva aparte. El mock seguía la definición vieja —todo lo que no fuera STAGE_1— y eso lo
  // convertía en una trampa: quien probara contra datos simulados vería una mora que el entorno
  // real ya no produce.
  const atrasoTemprano = sum(active.filter((a) => a.ifrs9Stage === 'STAGE_2'), (a) => a.principalBalance);
  const vencida = sum(active.filter((a) => a.ifrs9Stage === 'STAGE_3'), (a) => a.principalBalance);
  const capital = sana + atrasoTemprano + vencida;
  const provision = sum(ACCOUNTS, (a) => a.principalBalance * provisionRate(stageOf(a.daysDelinquent, a.status)));

  const productMap = new Map<ProductType, { behavior: CreditAccount['productBehavior']; accounts: number; capital: number; vencida: number }>();
  for (const a of active) {
    const e = productMap.get(a.productType) ?? { behavior: a.productBehavior, accounts: 0, capital: 0, vencida: 0 };
    e.accounts += 1; e.capital += a.principalBalance;
    if (a.ifrs9Stage !== 'STAGE_1') e.vencida += a.principalBalance;
    productMap.set(a.productType, e);
  }

  const exeMap = new Map<string, { name: string; clients: Set<string>; accounts: number; capital: number; sana: number; vencida: number; provision: number }>();
  for (const a of active) {
    const id = a.assignedExecutiveId ?? 'N/A';
    const e = exeMap.get(id) ?? { name: a.assignedExecutiveName ?? '—', clients: new Set(), accounts: 0, capital: 0, sana: 0, vencida: 0, provision: 0 };
    e.clients.add(a.obligorPartyId); e.accounts += 1; e.capital += a.principalBalance;
    if (a.ifrs9Stage === 'STAGE_1') e.sana += a.principalBalance; else e.vencida += a.principalBalance;
    e.provision += a.principalBalance * provisionRate(a.ifrs9Stage ?? 'STAGE_1');
    exeMap.set(id, e);
  }

  const pipelineMap = new Map<string, number>();
  for (const app of APPLICATIONS) pipelineMap.set(app.status, (pipelineMap.get(app.status) ?? 0) + 1);

  const disbursed = APPLICATIONS
    .filter((a) => a.status === 'DISBURSED' || a.status === 'CONTRACT_SIGNED')
    .reduce((s, a) => s + a.requestedAmount, 0);

  return {
    capitalColocado: capital,
    totalDebt: sum(active, (a) => a.totalDebt),
    carteraSana: sana,
    carteraVencida: vencida,
    carteraAtrasoTemprano: atrasoTemprano,
    provisionTotal: Math.round(provision),
    ead: sum(active, (a) => a.totalDebt),
    activeAccounts: active.length,
    activeClients: CLIENTS.filter((c) => c.partyType === 'INDIVIDUAL' && c.status === 'ACTIVE').length,
    activeBusinesses: CLIENTS.filter((c) => c.partyType === 'BUSINESS' && c.status === 'ACTIVE').length,
    delinquencyRate: capital ? (vencida / capital) * 100 : 0,
    disbursedThisMonth: disbursed,
    byProduct: [...productMap.entries()].map(([productType, v]) => ({
      productType, behavior: v.behavior, accounts: v.accounts, capital: v.capital, vencida: v.vencida,
    })).sort((a, b) => b.capital - a.capital),
    health: {
      stage1: sana,
      stage2: sum(active.filter((a) => a.ifrs9Stage === 'STAGE_2'), (a) => a.principalBalance),
      stage3: sum(active.filter((a) => a.ifrs9Stage === 'STAGE_3'), (a) => a.principalBalance),
    },
    byExecutive: [...exeMap.entries()].map(([executiveId, v]) => ({
      executiveId, executiveName: v.name, clients: v.clients.size, accounts: v.accounts,
      capital: v.capital, sana: v.sana, vencida: v.vencida, provision: Math.round(v.provision),
    })).sort((a, b) => b.capital - a.capital),
    pipeline: [...pipelineMap.entries()].map(([status, count]) => ({ status, count })),
  };
}

/**
 * Cómo se reparte la cartera según una dimensión. Lo agrega la base de datos de
 * `credit-portfolio`, no el BFF fila por fila.
 *
 * `dpdBucket` es la que no se podía contestar de otra forma: la distribución por tramo de atraso
 * sobre la cartera **entera**. Derivarla de la página que se está mirando —que es lo que hacía la
 * consola— produce un total que sólo cuenta 25 renglones, y ese número se acaba llevando a una
 * junta como si fuera la mora completa.
 */
export type StatsGroupBy = 'status' | 'productType' | 'dpdBucket';

export interface StatBucket {
  key: string;
  count: number;
  principal: number;
}

export const dashboardApi = {
  async summary(): Promise<DashboardSummary> {
    if (!isMock()) return request<DashboardSummary>('/dashboard/summary');
    return wait(computeSummary());
  },

  async stats(groupBy: StatsGroupBy): Promise<StatBucket[]> {
    if (!isMock()) return request<StatBucket[]>('/dashboard/stats', { query: { groupBy } });

    // Las mismas claves que emite la consulta de credit-portfolio —CURRENT, 1-30, 31-60, 61-90,
    // 90+—. Inventarle otras al mock haría que las etiquetas y los filtros funcionaran en
    // demostración y se rompieran al conectar el backend, que es el peor momento para descubrirlo.
    const clave = (a: CreditAccount): string => {
      if (groupBy === 'status') return a.status;
      if (groupBy === 'productType') return a.productType;
      const d = a.daysDelinquent;
      return d <= 0 ? 'CURRENT' : d <= 30 ? '1-30' : d <= 60 ? '31-60' : d <= 90 ? '61-90' : '90+';
    };
    const map = new Map<string, StatBucket>();
    for (const a of ACCOUNTS) {
      const k = clave(a);
      const e = map.get(k) ?? { key: k, count: 0, principal: 0 };
      e.count += 1;
      e.principal += a.principalBalance;
      map.set(k, e);
    }
    // Por tramo el orden es el del atraso —no el del saldo—: la escala se lee de menos a más grave,
    // igual que la ordena la base con MIN(days_delinquent).
    const orden = ['CURRENT', '1-30', '31-60', '61-90', '90+'];
    const filas = [...map.values()];
    return wait(groupBy === 'dpdBucket'
      ? filas.sort((x, y) => orden.indexOf(x.key) - orden.indexOf(y.key))
      : filas.sort((x, y) => y.principal - x.principal));
  },
};

/* ============================ portfolio ============================ */

export interface PortfolioQuery { status?: string; productType?: string; q?: string; executiveId?: string; page?: number; size?: number }

export const portfolioApi = {
  async list(query: PortfolioQuery = {}): Promise<Page<CreditAccount>> {
    if (!isMock()) return request<Page<CreditAccount>>('/portfolio', { query: { ...query } });
    let rows = [...ACCOUNTS];
    if (query.status) rows = rows.filter((a) => a.status === query.status);
    if (query.productType) rows = rows.filter((a) => a.productType === query.productType);
    if (query.executiveId) rows = rows.filter((a) => a.assignedExecutiveId === query.executiveId);
    if (query.q) {
      const q = query.q.toLowerCase();
      rows = rows.filter((a) => a.obligorName?.toLowerCase().includes(q) || a.contractNumber.toLowerCase().includes(q));
    }
    return wait(paginate(rows, query.page ?? 0, query.size ?? 25));
  },

  async detail(id: string): Promise<AccountDetail> {
    if (!isMock()) return request<AccountDetail>(`/portfolio/${id}`);
    const acc = ACCOUNTS.find((a) => a.creditAccountId === id);
    if (!acc) throw new Error('Cuenta no encontrada');
    const stage = acc.ifrs9Stage ?? 'STAGE_1';
    return wait({
      ...acc,
      expectedLossRate: provisionRate(stage),
      provisionAmount: Math.round(acc.principalBalance * provisionRate(stage)),
      dispositions: acc.productBehavior === 'REVOLVING'
        ? [{ dispositionId: `DSP-${id}`, amount: acc.principalBalance, type: 'SELF_USE', status: 'COMPLETED', createdAt: acc.activatedAt ?? '2026-06-15T12:00:00Z' }]
        : [],
      schedule: acc.productBehavior === 'INSTALLMENT' ? mockSchedule(acc.principalBalance, acc.assignedTerm ?? 24, acc.nominalRate, acc.daysDelinquent) : [],
    });
  },
};

function mockSchedule(principal: number, term: number, annualRate: number, dpd: number): Installment[] {
  const r = annualRate / 12;
  const payment = principal * r / (1 - Math.pow(1 + r, -term));
  const out: Installment[] = [];
  let bal = principal;
  const paidCount = Math.max(0, Math.round(term * 0.35));
  for (let n = 1; n <= term; n++) {
    const interest = bal * r;
    const princ = payment - interest;
    bal -= princ;
    const status: Installment['status'] = n <= paidCount ? 'PAID' : (n === paidCount + 1 && dpd > 0 ? 'OVERDUE' : 'PENDING');
    out.push({
      installmentNumber: n,
      dueDate: `2026-${String(((n - 1) % 12) + 1).padStart(2, '0')}-05`,
      principalAmount: Math.round(princ),
      interestAmount: Math.round(interest),
      // El IVA se calcula sobre el interés, igual que en el motor real: si el mock lo omitiera,
      // el «Pago» no cuadraría contra capital + interés + IVA y la columna nueva saldría vacía
      // en modo demostración, que se lee como que la función no está hecha.
      taxAmount: Math.round(interest * 0.16),
      totalAmount: Math.round(payment) + Math.round(interest * 0.16),
      status,
    });
  }
  return out;
}

/* ============================ clients ============================ */

export interface ClientQuery { type?: string; status?: string; q?: string; executiveId?: string; page?: number; size?: number }

export const clientsApi = {
  async list(query: ClientQuery = {}): Promise<Page<Client>> {
    if (!isMock()) return request<Page<Client>>('/clients', { query: { ...query } });
    let rows = [...CLIENTS];
    if (query.type) rows = rows.filter((c) => c.partyType === query.type);
    if (query.status) rows = rows.filter((c) => c.status === query.status);
    if (query.executiveId) rows = rows.filter((c) => c.assignedExecutiveId === query.executiveId);
    if (query.q) {
      const q = query.q.toLowerCase();
      rows = rows.filter((c) => c.fullName.toLowerCase().includes(q) || (c.curp ?? '').toLowerCase().includes(q) || (c.rfc ?? '').toLowerCase().includes(q));
    }
    return wait(paginate(rows, query.page ?? 0, query.size ?? 25));
  },

  async detail(id: string): Promise<ClientDetail> {
    if (!isMock()) return request<ClientDetail>(`/clients/${id}`);
    const client = CLIENTS.find((c) => c.partyId === id);
    if (!client) throw new Error('Cliente no encontrado');
    return wait({
      ...client,
      accounts: ACCOUNTS.filter((a) => a.obligorPartyId === id),
      applications: APPLICATIONS.filter((a) => a.prospectId === id),
    });
  },

  async assignExecutive(partyId: string, executiveId: string): Promise<void> {
    if (!isMock()) return request<void>(`/clients/${partyId}/assign-executive`, { method: 'POST', body: { executiveId } });
    const client = CLIENTS.find((c) => c.partyId === partyId);
    const exe = EXECUTIVES.find((e) => e.id === executiveId);
    if (client && exe) { client.assignedExecutiveId = exe.id; client.assignedExecutiveName = exe.name; }
    return wait(undefined);
  },
};

export const executivesApi = {
  async list(): Promise<Executive[]> {
    if (!isMock()) return request<Executive[]>('/executives');
    return wait(EXECUTIVES);
  },
};

/* ============================ distribuidores ============================ */

export interface DistributorQuery { q?: string; active?: boolean; page?: number; size?: number }

/**
 * Distribuidores: se consulta del distribuidor hacia sus créditos, nunca al revés.
 *
 * Quien pregunta desde la consola llega con el nombre o el código del distribuidor —"¿cómo va la
 * cartera de DIST-0042?"—, no con un número de contrato. Un índice que solo permitiera ir del
 * crédito al distribuidor obligaría a recorrer la cartera entera para responder esa pregunta.
 */
export const distributorsApi = {
  async list(query: DistributorQuery = {}): Promise<Page<Distributor>> {
    if (!isMock()) return request<Page<Distributor>>('/distributors', { query: { ...query, active: query.active } as never });
    let rows = [...DISTRIBUTORS];
    if (query.active != null) rows = rows.filter((d) => d.active === query.active);
    if (query.q) {
      const q = query.q.toLowerCase();
      rows = rows.filter((d) =>
        d.fullName.toLowerCase().includes(q) ||
        (d.promoterCode ?? '').toLowerCase().includes(q) ||
        (d.rfc ?? '').toLowerCase().includes(q));
    }
    return wait(paginate(rows, query.page ?? 0, query.size ?? 25));
  },

  async detail(partyId: string): Promise<DistributorDetail> {
    if (!isMock()) return request<DistributorDetail>(`/distributors/${partyId}`);
    const dist = DISTRIBUTORS.find((d) => d.partyId === partyId);
    if (!dist) throw new Error('Distribuidor no encontrado');
    return wait({ ...dist, credits: originatedCreditsOf(dist.promoterCode ?? '') });
  },
};

/* ============================ products ============================ */

/** Una regla del motor de riesgo, como la publica el BFF ya traducida. */
export interface ReglaScoring {
  tipo: string;
  tipoCredito: string | null;
  operador: string;
  valor: number;
  puntos: number;
  descalifica: boolean;
  periodoMeses: number | null;
  descripcion: string | null;
  /** La regla dicha en una línea: «Días de mora > 90 → descalifica». */
  legible: string;
}

export interface UmbralScoring {
  nivelRiesgo: string;
  scoreMinimo: number;
  decision: string;
  legible: string;
}

export interface PoliticaScoring {
  policyId: string;
  nombre: string;
  descripcion: string | null;
  tipoProspecto: string;
  tipoProducto: string;
  version: number;
  activa: boolean;
  reglas: ReglaScoring[];
  umbrales: UmbralScoring[];
}

/**
 * Detalle de un producto: sus condiciones y **el scoring que lo gobierna**.
 *
 * El catálogo decía tasa y plazo, que es lo que el producto cobra, pero no bajo qué reglas se
 * aprueba —qué atributos del buró pesan, cuántos puntos suma cada uno, qué descalifica de
 * entrada—. Sin eso, «por qué me rechazaron» sólo se contesta leyendo código.
 */
export interface ProductDetail {
  product: ProductDefinition;
  condiciones: Record<string, unknown>;
  scoring: {
    scoreMinimoAprobacion: number | null;
    flujoAprobacion: string | null;
    tienePoliticaAsignada: boolean;
    porTipoProspecto: Array<{ tipoProspecto: string; gobernadoPor: PoliticaScoring | null }>;
  };
}

/**
 * Una variable del buró que se puede configurar, tal como la publica el motor.
 *
 * El catálogo viene del backend y no de una lista escrita aquí: con veinte variables, una copia
 * en el front se desalinea a la primera que se agrega —la consola ofrece una que el motor no sabe
 * calcular, y la regla queda muerta sin que nadie lo note.
 */
export interface VariableScoring {
  tipo: string;
  dimension: 'COMPORTAMIENTO' | 'EXPOSICION' | 'PERFIL' | 'PERSONA';
  etiqueta: string;
  unidad: string;
  explicacion: string;
  aplicaTipoCredito: boolean;
  aplicaPeriodo: boolean;
}

/** Lo que se manda al dar de alta una política. */
export interface NuevaPolitica {
  prospectType: string;
  productTypeIntent: string;
  name: string;
  description?: string;
  rules: Array<{
    ruleType: string;
    creditType?: string | null;
    operator: string;
    thresholdValue: number;
    scoreContribution: number;
    disqualifying: boolean;
    periodMonths?: number | null;
    description?: string;
  }>;
  thresholds: Array<{ riskLevel: string; minScore: number; decision: string }>;
}

export const scoringApi = {
  /** Qué se puede configurar. Lo dice el motor, no la pantalla. */
  async variables(): Promise<VariableScoring[]> {
    if (!isMock()) return request<VariableScoring[]>('/scoring/rule-types');
    return wait([]);
  },

  async politicas(): Promise<PoliticaScoring[]> {
    if (!isMock()) return request<PoliticaScoring[]>('/scoring/policies');
    return wait([]);
  },

  async crearPolitica(body: NuevaPolitica): Promise<PoliticaScoring> {
    if (!isMock()) return request<PoliticaScoring>('/scoring/policies', { method: 'POST', body });
    throw new Error('No disponible en modo simulado');
  },
};

export const productsApi = {
  async list(): Promise<ProductDefinition[]> {
    if (!isMock()) return request<ProductDefinition[]>('/products');
    return wait([...PRODUCTS]);
  },

  /** El producto con la política de riesgo que se le aplica. */
  async detail(id: string): Promise<ProductDetail> {
    if (!isMock()) return request<ProductDetail>(`/products/${id}`);
    const prod = PRODUCTS.find((p) => p.id === id);
    if (!prod) throw new Error('Producto no encontrado');
    return wait({
      product: prod,
      condiciones: {},
      scoring: {
        scoreMinimoAprobacion: prod.minApprovalScore ?? null,
        flujoAprobacion: prod.defaultApprovalFlow ?? null,
        tienePoliticaAsignada: false,
        porTipoProspecto: [],
      },
    });
  },

  async createVersion(req: CreateProductVersionRequest): Promise<ProductDefinition> {
    if (!isMock()) return request<ProductDefinition>('/products', { method: 'POST', body: req });
    const existing = PRODUCTS.filter((p) => p.productCode === req.productCode);
    const version = existing.length ? Math.max(...existing.map((p) => p.productVersion)) + 1 : 1;
    const created: ProductDefinition = {
      ...req,
      id: `PRD-${req.productCode}-V${version}`,
      productVersion: version,
      status: 'DRAFT',
      currency: 'MXN',
      activeInApp: false,
    };
    PRODUCTS.push(created);
    return wait(created);
  },

  async activate(id: string): Promise<ProductDefinition> {
    if (!isMock()) return request<ProductDefinition>(`/products/${id}/activate`, { method: 'PUT' });
    const prod = PRODUCTS.find((p) => p.id === id);
    if (!prod) throw new Error('Producto no encontrado');
    // one-active invariant: retire other active versions of same code
    PRODUCTS.filter((p) => p.productCode === prod.productCode && p.id !== id && p.status === 'ACTIVE')
      .forEach((p) => { p.status = 'RETIRED'; p.activeInApp = false; });
    prod.status = 'ACTIVE'; prod.activeInApp = true;
    return wait(prod);
  },

  async retire(id: string): Promise<void> {
    if (!isMock()) return request<void>(`/products/${id}/retire`, { method: 'PUT' });
    const prod = PRODUCTS.find((p) => p.id === id);
    if (prod) { prod.status = 'RETIRED'; prod.activeInApp = false; }
    return wait(undefined);
  },
};

/* ============================ origination / underwriting ============================ */

export const originationApi = {
  async queue(status?: string): Promise<CreditApplication[]> {
    if (!isMock()) return request<CreditApplication[]>('/origination/applications', { query: { status } });
    let rows = [...APPLICATIONS];
    if (status) rows = rows.filter((a) => a.status === status);
    return wait(rows);
  },

  async decide(applicationId: string, approved: boolean, rejectionReason?: string): Promise<void> {
    if (!isMock()) return request<void>(`/origination/applications/${applicationId}/decision`, { method: 'POST', body: { approved, rejectionReason } });
    const app = APPLICATIONS.find((a) => a.applicationId === applicationId);
    if (app) {
      app.status = approved ? 'APPROVED' : 'REJECTED';
      app.rejectionReason = approved ? null : (rejectionReason ?? 'Rechazado por comité');
    }
    return wait(undefined);
  },
};
