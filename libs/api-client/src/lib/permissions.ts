import type { Capability } from '@bo/shared-types';
import { isMock } from './config.js';
import { request } from './http.js';

export interface MyPermissions {
  roles: string[];
  capabilities: Capability[];
}

/** rol → capacidades. La misma matriz que el backend aplica en cada petición. */
export type PermissionMatrix = Record<string, Capability[]>;

/** Un rol del backoffice tal como lo publica identity-service. */
export interface Role {
  code: string;
  name: string;
  description: string | null;
  channel: string;
  /** Los define el producto: se les mueven capacidades, no se borran. */
  systemManaged: boolean;
  capabilities: Capability[];
  updatedAt: string | null;
}

/**
 * Lo que el usuario **puede hacer**, según el backend.
 *
 * La consola dejó de decidir por roles: el BFF ya publica las capacidades y es
 * quien manda (`SecurityConfig`). Derivar la navegación de aquí elimina la
 * segunda fuente de verdad — la lista de roles en `nav.ts`— que había que mover
 * a la par y cuyo síntoma al separarse era un módulo visible que responde 403.
 */
export const permissionsApi = {
  async me(): Promise<MyPermissions> {
    if (!isMock()) return request<MyPermissions>('/permissions/me');
    // En mock se derivan de los roles del usuario demo, con la misma matriz.
    const raw = localStorage.getItem('bo.user');
    const roles: string[] = raw ? (JSON.parse(raw).roles ?? []) : [];
    const caps = new Set<Capability>();
    roles.forEach((r) => (MOCK_MATRIX[r] ?? []).forEach((c) => caps.add(c)));
    return { roles, capabilities: [...caps] };
  },

  async matrix(): Promise<PermissionMatrix> {
    if (!isMock()) return request<PermissionMatrix>('/permissions/matrix');
    return MOCK_MATRIX;
  },

  async roles(): Promise<Role[]> {
    if (!isMock()) return request<Role[]>('/permissions/roles');
    return Object.entries(MOCK_MATRIX).map(([code, capabilities]) => ({
      code, name: code, description: null, channel: 'BACKOFFICE',
      systemManaged: true, capabilities, updatedAt: null,
    }));
  },

  /** Las capacidades que existen. Asignar una que nadie consulta no abre ninguna puerta. */
  async capabilities(): Promise<Capability[]> {
    if (!isMock()) return request<Capability[]>('/permissions/capabilities');
    return [...new Set(Object.values(MOCK_MATRIX).flat())].sort();
  },

  /**
   * Reemplaza el conjunto completo de capacidades de un rol.
   *
   * Reemplazo y no altas sueltas: la pantalla edita una matriz y manda el estado
   * al que quiere llegar. Con operaciones incrementales, dos personas editando el
   * mismo rol acaban con la unión de sus dos intenciones y nadie pidió eso.
   */
  async replaceCapabilities(code: string, capabilities: Capability[]): Promise<Role> {
    if (isMock()) {
      MOCK_MATRIX[code] = capabilities;
      return { code, name: code, description: null, channel: 'BACKOFFICE',
               systemManaged: true, capabilities, updatedAt: new Date().toISOString() };
    }
    return request<Role>(`/permissions/roles/${code}/capabilities`, {
      method: 'PUT',
      body: { capabilities },
    });
  },
};

/**
 * Espejo de la matriz del BFF para el modo mock.
 *
 * Es una copia y como tal se desincroniza — ya pasó: se quedó sin `beneficiaries.view`, sin
 * `permissions.view` y sin las de contabilidad, así que en modo simulado nadie veía Beneficiarios,
 * Roles ni Permisos y parecía que las pantallas no existían. Se regeneró desde
 * `PermissionsService` del BFF, que es la fuente.
 *
 * Existe sólo para que la consola sea navegable sin backend; cualquier decisión de producto se
 * toma contra la de verdad, y la pantalla **Permisos** enseña las dos y marca dónde discrepan.
 */
const MOCK_MATRIX: PermissionMatrix = {
  ADMIN: [
    'accounting.close', 'accounting.view', 'applications.analyze', 'applications.decide',
    'applications.request-documents', 'applications.view', 'audit.view',
    'beneficiaries.review-identity', 'beneficiaries.view', 'clients.assign-executive',
    'clients.view', 'compliance.adjudicate', 'compliance.review-identity', 'compliance.view',
    'dashboard.commercial', 'dashboard.view', 'permissions.manage', 'permissions.view',
    'portfolio.view', 'products.manage', 'salesorg.manage', 'salesorg.view', 'treasury.funding', 'treasury.view',
  ],
  // Operación ve tesorería sin ver el mayor: la pregunta que le llega es «¿ya le llegó su
  // dinero?», y se contesta con la clave de rastreo, no con la balanza.
  OPS_SUPERVISOR: [
    'applications.view', 'beneficiaries.review-identity', 'beneficiaries.view',
    'clients.assign-executive', 'clients.view', 'compliance.adjudicate',
    'compliance.review-identity', 'compliance.view', 'dashboard.commercial', 'dashboard.view',
    'permissions.view', 'portfolio.view', 'salesorg.manage', 'salesorg.view', 'treasury.view',
  ],
  CREDIT_ANALYST: [
    'applications.analyze', 'applications.request-documents', 'applications.view',
    'beneficiaries.view', 'clients.view', 'dashboard.view', 'portfolio.view',
  ],
  UNDERWRITER: [
    'applications.analyze', 'applications.decide', 'applications.request-documents',
    'applications.view', 'clients.view', 'dashboard.view', 'portfolio.view',
  ],
  COMMITTEE: [
    'applications.analyze', 'applications.decide', 'applications.request-documents',
    'applications.view', 'clients.view', 'dashboard.view', 'portfolio.view',
  ],
  RISK_ANALYST: [
    'applications.analyze', 'applications.view', 'beneficiaries.view', 'clients.view',
    'dashboard.commercial', 'dashboard.view', 'portfolio.view', 'salesorg.view',
  ],
  EXECUTIVE: [
    'clients.view', 'dashboard.commercial', 'dashboard.view', 'portfolio.view', 'salesorg.view',
  ],
  // Auditoría lee el mayor y **no** cierra períodos: auditar no puede implicar poder mover el
  // corte contable de lo que se está auditando.
  AUDITOR: [
    'accounting.view', 'applications.analyze', 'applications.view', 'audit.view',
    'beneficiaries.view', 'clients.view', 'compliance.view', 'dashboard.commercial',
    'dashboard.view', 'portfolio.view', 'salesorg.view', 'treasury.view',
  ],
  FINANCE: [
    'accounting.close', 'accounting.view', 'dashboard.commercial', 'dashboard.view',
    'portfolio.view', 'salesorg.view', 'treasury.funding', 'treasury.view',
  ],
  PRODUCT_MANAGER: ['dashboard.view', 'products.manage'],
  SUPPORT: [
    'beneficiaries.review-identity', 'beneficiaries.view', 'clients.view', 'dashboard.view',
    'portfolio.view',
  ],
  COLLECTIONS_AGENT: ['portfolio.view'],
};
