import type { EmployeeType, Role } from '@bo/shared-types';
import { isMock } from './config.js';
import { request } from './http.js';

/**
 * Directorio de personal.
 *
 * Es passthrough del BFF a identity-service, que vuelve a exigir ADMIN con el token de quien pide:
 * la autorización se decide una sola vez y en el dueño del dato. Por eso aquí no hay ninguna
 * comprobación de rol — sólo se evita ofrecer la pantalla a quien va a recibir 403, que es una
 * cortesía de la consola, no la puerta.
 *
 * Un empleado tiene **rol** y **nodo**: el rol dice qué puede hacer y el nodo —el de estructura
 * comercial— hasta dónde alcanza. Moverlo de unidad cambia su alcance sin tocarle el rol, y por eso
 * la adscripción no se edita aquí sino en Estructura comercial.
 */
export type StaffStatus = 'ACTIVE' | 'SUSPENDED' | 'DISABLED';

export interface StaffUserRow {
  staffUserId: string;
  email: string;
  fullName: string;
  /** La exige la bitácora para identificar plenamente a quien actúa; el personal viejo no la tiene. */
  curp: string | null;
  employeeType: EmployeeType;
  /** Presente sólo en colaboradores externos: de qué distribuidora dependen. */
  distributorPartyId: string | null;
  roles: Role[];
  status: StaffStatus | string;
  lastLoginAt: string | null;
  createdAt: string | null;
}

export interface StaffQuery {
  status?: string;
  role?: string;
}

export interface NuevoEmpleado {
  email: string;
  fullName: string;
  curp?: string;
  employeeType: EmployeeType;
  distributorPartyId?: string;
  roles: string[];
  password: string;
}

const MOCK: StaffUserRow[] = [
  {
    staffUserId: 'stf-0001', email: 'admin@kredius.mx', fullName: 'Admin Kredius', curp: null,
    employeeType: 'INTERNO', distributorPartyId: null, roles: ['ADMIN'], status: 'ACTIVE',
    lastLoginAt: '2026-08-17T09:12:00Z', createdAt: '2026-01-08T16:00:00Z',
  },
  {
    staffUserId: 'stf-0002', email: 'analista@kredius.mx', fullName: 'Sandra Núñez', curp: null,
    employeeType: 'INTERNO', distributorPartyId: null, roles: ['CREDIT_ANALYST', 'RISK_ANALYST'],
    status: 'ACTIVE', lastLoginAt: '2026-08-17T08:40:00Z', createdAt: '2026-02-11T16:00:00Z',
  },
  {
    staffUserId: 'stf-0003', email: 'ejecutivo@kredius.mx', fullName: 'Ana Torres', curp: null,
    employeeType: 'INTERNO', distributorPartyId: null, roles: ['EXECUTIVE'], status: 'ACTIVE',
    lastLoginAt: '2026-08-17T08:31:00Z', createdAt: '2026-03-02T16:00:00Z',
  },
  {
    staffUserId: 'stf-0004', email: 'comite@kredius.mx', fullName: 'Comité de Crédito', curp: null,
    employeeType: 'INTERNO', distributorPartyId: null, roles: ['UNDERWRITER', 'COMMITTEE'],
    status: 'ACTIVE', lastLoginAt: '2026-08-16T18:22:00Z', createdAt: '2026-01-20T16:00:00Z',
  },
  {
    staffUserId: 'stf-0005', email: 'producto@kredius.mx', fullName: 'Pablo Vela', curp: null,
    employeeType: 'INTERNO', distributorPartyId: null, roles: ['PRODUCT_MANAGER'],
    status: 'SUSPENDED', lastLoginAt: '2026-07-18T14:03:00Z', createdAt: '2026-02-01T16:00:00Z',
  },
  {
    staffUserId: 'stf-0006', email: 'auditoria@bdo.mx', fullName: 'Auditoría Externa', curp: null,
    employeeType: 'COLABORADOR_EMPRESARIAL', distributorPartyId: null, roles: ['AUDITOR'],
    status: 'ACTIVE', lastLoginAt: '2026-07-28T11:41:00Z', createdAt: '2026-05-14T16:00:00Z',
  },
];

const wait = <T,>(v: T, ms = 200): Promise<T> => new Promise((r) => setTimeout(() => r(v), ms));

export const staffApi = {
  async list(query: StaffQuery = {}): Promise<StaffUserRow[]> {
    if (!isMock()) return request<StaffUserRow[]>('/staff', { query: { ...query } });
    let rows = [...MOCK];
    if (query.status) rows = rows.filter((s) => s.status === query.status);
    if (query.role) rows = rows.filter((s) => s.roles.includes(query.role as Role));
    return wait(rows);
  },

  async detail(staffUserId: string): Promise<StaffUserRow> {
    if (!isMock()) return request<StaffUserRow>(`/staff/${staffUserId}`);
    const row = MOCK.find((s) => s.staffUserId === staffUserId);
    if (!row) throw new Error('Empleado no encontrado');
    return wait(row);
  },

  async create(body: NuevoEmpleado): Promise<StaffUserRow> {
    if (!isMock()) return request<StaffUserRow>('/staff', { method: 'POST', body });
    const row: StaffUserRow = {
      staffUserId: `stf-${Date.now()}`, email: body.email, fullName: body.fullName,
      curp: body.curp ?? null, employeeType: body.employeeType,
      distributorPartyId: body.distributorPartyId ?? null, roles: body.roles as Role[],
      status: 'ACTIVE', lastLoginAt: null, createdAt: new Date().toISOString(),
    };
    MOCK.unshift(row);
    return wait(row);
  },

  async changeRoles(staffUserId: string, roles: string[]): Promise<StaffUserRow> {
    if (!isMock()) return request<StaffUserRow>(`/staff/${staffUserId}/roles`, { method: 'PUT', body: { roles } });
    const row = MOCK.find((s) => s.staffUserId === staffUserId);
    if (!row) throw new Error('Empleado no encontrado');
    row.roles = roles as Role[];
    return wait(row);
  },

  /** Cambiar la contraseña cierra las sesiones vivas del empleado. Se dice en la pantalla. */
  async changePassword(staffUserId: string, password: string): Promise<StaffUserRow> {
    if (!isMock()) return request<StaffUserRow>(`/staff/${staffUserId}/password`, { method: 'PUT', body: { password } });
    return wait(MOCK.find((s) => s.staffUserId === staffUserId)!);
  },

  /**
   * Suspender revoca sus sesiones en identity, pero el gateway valida la firma del token
   * localmente y no consulta revocación: el access token que ya tiene vive hasta 15 minutos. Por
   * eso la consola no dice «revocado» sino «suspendido» — decir lo primero sería mentir durante
   * ese cuarto de hora.
   */
  async suspend(staffUserId: string): Promise<StaffUserRow> {
    if (!isMock()) return request<StaffUserRow>(`/staff/${staffUserId}/suspend`, { method: 'PUT' });
    const row = MOCK.find((s) => s.staffUserId === staffUserId)!;
    row.status = 'SUSPENDED';
    return wait(row);
  },

  async reactivate(staffUserId: string): Promise<StaffUserRow> {
    if (!isMock()) return request<StaffUserRow>(`/staff/${staffUserId}/reactivate`, { method: 'PUT' });
    const row = MOCK.find((s) => s.staffUserId === staffUserId)!;
    row.status = 'ACTIVE';
    return wait(row);
  },

  /** Baja lógica: conserva el registro histórico, porque la bitácora lo sigue nombrando. */
  async disable(staffUserId: string): Promise<StaffUserRow> {
    if (!isMock()) return request<StaffUserRow>(`/staff/${staffUserId}`, { method: 'DELETE' });
    const row = MOCK.find((s) => s.staffUserId === staffUserId)!;
    row.status = 'DISABLED';
    return wait(row);
  },
};
