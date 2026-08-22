import { useMemo, useState } from 'react';
import { salesOrgApi, staffApi, type NuevoEmpleado, type StaffUserRow } from '@bo/api-client';
import {
  useAsync, Block, Card, CardTitled, DataTable, Badge, Button, Chip, Checkbox,
  Field, Modal, Select, SearchInput, StatCard, Stats, TextInput, Toolbar, Footnote,
  dateTime, count, type Column, type Tone,
} from '@bo/design-system';
import { ROLES, ROLE_LABELS, type EmployeeType, type Role } from '@bo/shared-types';

/**
 * Quién entra a la consola, con qué rol y desde cuándo.
 *
 * Un empleado tiene **rol** y **nodo**: el rol dice qué puede hacer y el nodo de estructura
 * comercial hasta dónde alcanza. Por eso aquí no se edita la adscripción — moverlo de unidad es una
 * operación de red y vive en Estructura comercial, donde se ve el árbol contra el que se decide.
 *
 * Las acciones que cortan el acceso —suspender, dar de baja, cambiar contraseña— dicen su efecto
 * antes de ejecutarse y no después. En particular la demora de la suspensión: identity revoca las
 * sesiones, pero el gateway valida la firma del token localmente y no consulta revocación, así que
 * el token que esa persona ya tiene sigue sirviendo hasta que caduque. Decir «revocado» sería
 * mentir durante ese cuarto de hora, que es justo el rato en que a alguien le importa.
 */
export function Usuarios({ editable }: { editable: boolean }) {
  const [q, setQ] = useState('');
  const [estado, setEstado] = useState('');
  const [rol, setRol] = useState('');
  const [alta, setAlta] = useState(false);
  const [abierto, setAbierto] = useState<StaffUserRow | null>(null);

  const state = useAsync(() => staffApi.list({ status: estado || undefined, role: rol || undefined }),
    [estado, rol]);

  /**
   * A qué unidad está adscrito cada empleado.
   *
   * En **dos** llamadas para toda la tabla, no una por fila: `scope` de la raíz devuelve las
   * asignaciones vigentes de todo el subárbol de una vez. Preguntar
   * `/assignments/STAFF/{id}/current` por renglón serían sesenta y dos peticiones para pintar una
   * columna, que es justo el N+1 que la arquitectura de este backoffice prohíbe.
   *
   * Es el dato que faltaba para poder leer esta pantalla completa: el rol dice qué puede hacer una
   * persona y el nodo hasta dónde alcanza, y sin la segunda mitad la tabla sólo cuenta media
   * historia.
   */
  const adscripcion = useAsync(async () => {
    const alcance = await salesOrgApi.myScope();
    if (!alcance.unitId) return new Map<string, string>();
    const [asignaciones, unidades] = await Promise.all([
      salesOrgApi.unitScope(alcance.unitId),
      salesOrgApi.units(),
    ]);
    const nombre = new Map(unidades.map((u) => [u.unitId, u.name]));
    const porPersona = new Map<string, string>();
    asignaciones
      .filter((a) => a.active && a.assigneeType === 'STAFF')
      .forEach((a) => porPersona.set(a.assigneeId, nombre.get(a.unitId) ?? a.unitId));
    return porPersona;
  }, []);

  const todos = state.data ?? [];

  const filas = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return todos;
    return todos.filter((s) =>
      s.fullName.toLowerCase().includes(t) || s.email.toLowerCase().includes(t));
  }, [todos, q]);

  const resumen = useMemo(() => ({
    activos: todos.filter((s) => s.status === 'ACTIVE').length,
    suspendidos: todos.filter((s) => s.status === 'SUSPENDED').length,
    externos: todos.filter((s) => s.employeeType === 'COLABORADOR_EMPRESARIAL').length,
    // Sin CURP la bitácora no puede identificar plenamente a quien actúa, y ese hueco no se repara
    // hacia atrás: los hechos ya registrados se quedan sin ella.
    sinCurp: todos.filter((s) => s.employeeType === 'INTERNO' && !s.curp).length,
  }), [todos]);

  const columns: Array<Column<StaffUserRow>> = [
    {
      key: 'quien', header: 'Usuario',
      render: (s) => (
        <div>
          <b>{s.fullName}</b>
          <div className="bo-sub">{s.email}</div>
        </div>
      ),
    },
    {
      key: 'roles', header: 'Roles',
      render: (s) => (
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', maxWidth: 320 }}>
          {s.roles.length === 0
            ? <span className="bo-sub">Sin rol — no abre ninguna pantalla</span>
            : s.roles.map((r) => <Chip key={r} tone="info">{ROLE_LABELS[r] ?? r}</Chip>)}
        </div>
      ),
    },
    {
      key: 'tipo', header: 'Tipo',
      render: (s) => s.employeeType === 'COLABORADOR_EMPRESARIAL'
        ? <Badge tone="warn">Colaborador externo</Badge>
        : <Badge tone="muted">Personal interno</Badge>,
    },
    {
      key: 'unidad', header: 'Adscrito a',
      render: (s) => {
        if (adscripcion.error) return <span className="bo-sub">—</span>;
        if (adscripcion.loading) return <span className="bo-sub">…</span>;
        const u = adscripcion.data?.get(s.staffUserId);
        // Sin adscripción no alcanza a ninguna rama: ve lo que su rol permita a nivel nacional, o
        // nada. Es lo que hay que corregir desde Estructura comercial, así que se marca.
        return u
          ? <span style={{ fontSize: 12.5 }}>{u}</span>
          : <span className="bo-sub">sin unidad</span>;
      },
    },
    {
      key: 'curp', header: 'CURP',
      render: (s) => s.curp
        ? <span className="bo-mono-sm">{s.curp}</span>
        : <span className="bo-sub">sin registrar</span>,
    },
    { key: 'estado', header: 'Estado', render: (s) => <EstadoBadge estado={s.status} /> },
    {
      key: 'acceso', header: 'Último acceso',
      render: (s) => s.lastLoginAt
        ? <span style={{ fontSize: 12.5 }}>{dateTime(s.lastLoginAt)}</span>
        : <span className="bo-sub">nunca entró</span>,
    },
  ];

  return (
    <>
      <Stats>
        <StatCard label="Activos" value={count(resumen.activos)} sub={`de ${count(todos.length)} dados de alta`} />
        <StatCard label="Suspendidos" value={count(resumen.suspendidos)}
                  tone={resumen.suspendidos > 0 ? 'warn' : undefined}
                  sub="no pueden iniciar sesión" />
        <StatCard label="Colaboradores externos" value={count(resumen.externos)}
                  tone={resumen.externos > 0 ? 'warn' : undefined}
                  sub="despacho y auditoría" />
        <StatCard label="Sin CURP" value={count(resumen.sinCurp)}
                  tone={resumen.sinCurp > 0 ? 'warn' : undefined}
                  sub="la bitácora no los identifica del todo" />
      </Stats>

      <Toolbar>
        <SearchInput
          value={q}
          onChange={setQ}
          onClear={() => setQ('')}
          placeholder="Nombre o correo…"
          ariaLabel="Buscar usuario por nombre o correo"
        />
        <Select
          value={estado}
          onChange={setEstado}
          placeholder="Todos los estados"
          ariaLabel="Estado del usuario"
          options={[
            { value: 'ACTIVE', label: 'Activos' },
            { value: 'SUSPENDED', label: 'Suspendidos' },
            { value: 'DISABLED', label: 'Dados de baja' },
          ]}
        />
        <Select
          value={rol}
          onChange={setRol}
          placeholder="Todos los roles"
          ariaLabel="Rol"
          options={ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))}
        />
        {editable && (
          <Button variant="primary" onClick={() => setAlta(true)}>+ Invitar usuario</Button>
        )}
      </Toolbar>

      <CardTitled
        title={`Personal${filas.length ? ` · ${count(filas.length)}` : ''}`}
        action={<span className="bo-page-sub">Abre uno para cambiar sus roles o su acceso</span>}
      >
        <Block state={state} emptyLabel="El directorio no devolvió a nadie.">
          {() => (
            <DataTable
              columns={columns}
              rows={filas}
              rowKey={(s) => s.staffUserId}
              onRowClick={setAbierto}
              emptyMessage="Ningún usuario con esos filtros."
            />
          )}
        </Block>
      </CardTitled>

      <Footnote>
        Un usuario tiene un rol y un nodo: el rol define <b>qué</b> puede hacer y el nodo de
        Estructura comercial <b>hasta dónde</b> alcanza. Mover a alguien de unidad cambia su alcance
        sin tocarle el rol, y por eso se hace allá y no aquí. Suspender revoca sus sesiones en
        identity-service, pero el gateway valida la firma del token localmente: el que ya tiene en
        la mano sigue sirviendo hasta que caduca, como mucho 15 minutos.
      </Footnote>

      {abierto && (
        <EmpleadoModal
          key={abierto.staffUserId}
          empleado={abierto}
          editable={editable}
          onClose={() => setAbierto(null)}
          onCambio={() => { setAbierto(null); state.reload(); }}
        />
      )}
      {alta && (
        <AltaModal onClose={() => setAlta(false)} onCreado={() => { setAlta(false); state.reload(); }} />
      )}
    </>
  );
}

function EstadoBadge({ estado }: { estado: string }) {
  const tone: Tone = estado === 'ACTIVE' ? 'ok' : estado === 'SUSPENDED' ? 'warn' : 'muted';
  const texto = estado === 'ACTIVE' ? 'Activo'
    : estado === 'SUSPENDED' ? 'Suspendido'
      : estado === 'DISABLED' ? 'Dado de baja' : estado;
  return <Badge tone={tone}>{texto}</Badge>;
}

/**
 * Ficha de un empleado y lo que se le puede cambiar.
 *
 * Los roles se guardan como conjunto completo, no como altas y bajas sueltas: es lo que la pantalla
 * enseña y lo que espera identity. Con operaciones incrementales, dos personas editando al mismo
 * empleado acaban con la unión de sus dos intenciones, y nadie pidió eso.
 */
function EmpleadoModal({ empleado, editable, onClose, onCambio }: {
  empleado: StaffUserRow; editable: boolean; onClose: () => void; onCambio: () => void;
}) {
  const [sel, setSel] = useState<Set<string>>(new Set(empleado.roles));
  const [clave, setClave] = useState('');
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const original = useMemo(() => new Set<string>(empleado.roles), [empleado]);
  const cambió = sel.size !== original.size || [...sel].some((r) => !original.has(r));
  const claveCorta = clave.length > 0 && clave.length < 12;

  const toggle = (r: string) => setSel((s) => {
    const n = new Set(s);
    if (n.has(r)) n.delete(r); else n.add(r);
    return n;
  });

  const correr = async (que: string, fn: () => Promise<unknown>) => {
    setOcupado(que); setError(null);
    try { await fn(); onCambio(); } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo completar');
    } finally { setOcupado(null); }
  };

  return (
    <Modal
      title={empleado.fullName}
      subtitle={`${empleado.email} · ${empleado.employeeType === 'INTERNO' ? 'personal interno' : 'colaborador externo'}`}
      onClose={onClose}
      actions={<EstadoBadge estado={empleado.status} />}
    >
      <div className="bo-defs cols-3" style={{ marginBottom: 20 }}>
        <div><div className="bo-def-k">CURP</div><div className="bo-def-v bo-mono-sm">{empleado.curp ?? '— sin registrar'}</div></div>
        <div><div className="bo-def-k">Alta</div><div className="bo-def-v">{dateTime(empleado.createdAt)}</div></div>
        <div><div className="bo-def-k">Último acceso</div><div className="bo-def-v">{empleado.lastLoginAt ? dateTime(empleado.lastLoginAt) : 'nunca entró'}</div></div>
      </div>

      <section style={{ marginBottom: 20 }}>
        <div className="bo-grupo-cap">Roles</div>
        <div style={{ display: 'grid', gap: 6 }}>
          {ROLES.map((r: Role) => {
            const marcado = sel.has(r);
            const nuevo = marcado && !original.has(r);
            const fuera = !marcado && original.has(r);
            return (
              <label key={r} className={`bo-cap-row${nuevo ? ' added' : ''}${fuera ? ' removed' : ''}`}>
                <input type="checkbox" checked={marcado} disabled={!editable} onChange={() => toggle(r)} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <b style={{ fontSize: 13 }}>{ROLE_LABELS[r]}</b>
                  <span className="bo-tree-code"> {r}</span>
                </span>
                {nuevo && <Badge tone="ok">se agrega</Badge>}
                {fuera && <Badge tone="bad">se quita</Badge>}
              </label>
            );
          })}
        </div>
        {editable && (
          <div style={{ display: 'flex', gap: 10, marginTop: 12, alignItems: 'center' }}>
            <Button
              variant="primary"
              disabled={!cambió || sel.size === 0 || ocupado != null}
              title={sel.size === 0 ? 'Un empleado sin ningún rol no abre ninguna pantalla' : undefined}
              onClick={() => void correr('roles', () => staffApi.changeRoles(empleado.staffUserId, [...sel]))}
            >
              {ocupado === 'roles' ? 'Guardando…' : 'Guardar roles'}
            </Button>
            {cambió && <span className="bo-page-sub">Mientras no guardes, lo marcado es una intención.</span>}
          </div>
        )}
      </section>

      {editable && (
        <>
          <section style={{ marginBottom: 20 }}>
            <div className="bo-grupo-cap">Contraseña</div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <Field
                label="Nueva contraseña"
                hint="Mínimo 12 caracteres. Al cambiarla se cierran todas sus sesiones abiertas."
                error={claveCorta ? 'Le faltan caracteres: identity exige 12 como mínimo.' : undefined}
              >
                <TextInput type="password" value={clave} onChange={setClave} invalid={claveCorta}
                           autoComplete="new-password" />
              </Field>
              <Button
                disabled={clave.length < 12 || ocupado != null}
                onClick={() => void correr('clave', async () => {
                  await staffApi.changePassword(empleado.staffUserId, clave);
                  setClave('');
                })}
              >
                {ocupado === 'clave' ? 'Cambiando…' : 'Cambiar contraseña'}
              </Button>
            </div>
          </section>

          <section>
            <div className="bo-grupo-cap">Acceso</div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {empleado.status === 'ACTIVE' ? (
                <Button
                  variant="danger"
                  disabled={ocupado != null}
                  title="Deja de poder iniciar sesión. El token que ya tenga sigue sirviendo hasta 15 minutos."
                  onClick={() => void correr('suspender', () => staffApi.suspend(empleado.staffUserId))}
                >
                  {ocupado === 'suspender' ? 'Suspendiendo…' : 'Suspender'}
                </Button>
              ) : (
                <Button
                  variant="primary"
                  disabled={ocupado != null}
                  onClick={() => void correr('reactivar', () => staffApi.reactivate(empleado.staffUserId))}
                >
                  {ocupado === 'reactivar' ? 'Reactivando…' : 'Reactivar'}
                </Button>
              )}
              {empleado.status !== 'DISABLED' && (
                <Button
                  variant="danger"
                  disabled={ocupado != null}
                  title="Baja lógica: conserva el registro porque la bitácora lo sigue nombrando."
                  onClick={() => void correr('baja', () => staffApi.disable(empleado.staffUserId))}
                >
                  {ocupado === 'baja' ? 'Dando de baja…' : 'Dar de baja'}
                </Button>
              )}
            </div>
            <p className="bo-page-sub" style={{ marginTop: 10 }}>
              La baja es lógica: el registro se conserva porque los hechos que esta persona provocó
              siguen citándola en la bitácora, y esa no se reescribe.
            </p>
          </section>
        </>
      )}

      {error && <p style={{ color: 'var(--bo-bad)', fontSize: 13, marginTop: 14 }}>{error}</p>}
    </Modal>
  );
}

/** Alta de empleado. Identity valida el formato de la CURP y la fuerza de la contraseña. */
function AltaModal({ onClose, onCreado }: { onClose: () => void; onCreado: () => void }) {
  const [form, setForm] = useState({
    email: '', fullName: '', curp: '',
    employeeType: 'INTERNO' as EmployeeType,
    distributorPartyId: '', password: '',
  });
  const [roles, setRoles] = useState<Set<string>>(new Set<string>(['SUPPORT']));
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const externo = form.employeeType === 'COLABORADOR_EMPRESARIAL';
  const claveCorta = form.password.length > 0 && form.password.length < 12;
  const listo = form.email.trim() !== '' && form.fullName.trim() !== ''
    && form.password.length >= 12 && roles.size > 0;

  const guardar = async () => {
    setOcupado(true); setError(null);
    try {
      const body: NuevoEmpleado = {
        email: form.email.trim(),
        fullName: form.fullName.trim(),
        employeeType: form.employeeType,
        roles: [...roles],
        password: form.password,
      };
      if (form.curp.trim()) body.curp = form.curp.trim().toUpperCase();
      if (externo && form.distributorPartyId.trim()) body.distributorPartyId = form.distributorPartyId.trim();
      await staffApi.create(body);
      onCreado();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo dar de alta');
    } finally {
      setOcupado(false);
    }
  };

  return (
    <Modal
      title="Invitar usuario"
      subtitle="El alta la resuelve identity-service; el rol define qué pantallas abre."
      onClose={onClose}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Field label="Nombre completo" required>
          <TextInput value={form.fullName} onChange={(v) => set('fullName', v)} />
        </Field>
        <Field label="Correo" required>
          <TextInput type="email" value={form.email} onChange={(v) => set('email', v)}
                     autoComplete="off" placeholder="nombre@kredius.mx" />
        </Field>
        <Field label="CURP" hint="La pide la bitácora para identificar plenamente a quien actúa.">
          <TextInput value={form.curp} onChange={(v) => set('curp', v)} placeholder="Opcional" />
        </Field>
        <Field label="Tipo de empleado">
          <Select
            value={form.employeeType}
            onChange={(v) => set('employeeType', v)}
            options={[
              { value: 'INTERNO', label: 'Personal interno' },
              { value: 'COLABORADOR_EMPRESARIAL', label: 'Colaborador externo' },
            ]}
          />
        </Field>
        {externo && (
          <Field label="Distribuidora de la que depende"
                 hint="El colaborador externo no recibe CURP, RFC ni buró de los clientes: el dato no sale del dominio.">
            <TextInput value={form.distributorPartyId} onChange={(v) => set('distributorPartyId', v)}
                       placeholder="partyId" />
          </Field>
        )}
        <Field
          label="Contraseña inicial"
          required
          hint="Mínimo 12 caracteres."
          error={claveCorta ? 'Le faltan caracteres: identity exige 12 como mínimo.' : undefined}
        >
          <TextInput type="password" value={form.password} onChange={(v) => set('password', v)}
                     invalid={claveCorta} autoComplete="new-password" />
        </Field>
      </div>

      <section style={{ marginTop: 18 }}>
        <div className="bo-grupo-cap">Roles</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 4 }}>
          {ROLES.map((r) => (
            <Checkbox
              key={r}
              checked={roles.has(r)}
              label={ROLE_LABELS[r]}
              onChange={() => setRoles((s) => {
                const n = new Set(s);
                if (n.has(r)) n.delete(r); else n.add(r);
                return n;
              })}
            />
          ))}
        </div>
        {roles.size === 0 && (
          <p className="bo-field-error" style={{ marginTop: 8 }}>
            Sin ningún rol el usuario entra y no ve ninguna pantalla.
          </p>
        )}
      </section>

      <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
        <Button variant="primary" onClick={() => void guardar()} disabled={!listo || ocupado}>
          {ocupado ? 'Dando de alta…' : 'Dar de alta'}
        </Button>
        <Button onClick={onClose}>Cancelar</Button>
      </div>

      {error && <p style={{ color: 'var(--bo-bad)', fontSize: 13, marginTop: 12 }}>{error}</p>}

      <Card style={{ marginTop: 18 }}>
        <span className="bo-page-sub">
          La adscripción a una unidad —región, zona, sucursal— no se define aquí: se hace en
          Estructura comercial, que es donde se ve el árbol contra el que se decide el alcance.
        </span>
      </Card>
    </Modal>
  );
}
