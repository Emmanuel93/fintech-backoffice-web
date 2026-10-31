import { useMemo, useState } from 'react';
import { permissionsApi, type PermissionMatrix, type Role } from '@bo/api-client';
import { useCapabilities, useHasAnyRole } from '@bo/auth';
import { staffApi } from '@bo/api-client';
import {
  ensureThemeStyles, useAsync, useVista, Block, PageHeader, Card, CardTitled, Badge, Button,
  Chip, DataTable, Footnote, Modal, StatCard, Stats, Tabs, Spinner, count, dateTime,
  type Column,
} from '@bo/design-system';
import type { Capability } from '@bo/shared-types';
import { Usuarios } from './Usuarios';

ensureThemeStyles();

/**
 * Las tres pantallas de administración, cada una con su ruta.
 *
 * `roles` y `permisos` estuvieron juntas en una sola pantalla con pestañas y se separaron: son dos
 * preguntas de momentos distintos. «Qué roles existen y quién los tiene» se consulta al dar de alta
 * a alguien; «qué puede hacer cada rol en cada módulo» se consulta al auditar o al conceder. Con
 * pestañas había que entrar por una para llegar a la otra y ninguna tenía dirección que mandar.
 */
type Vista = 'usuarios' | 'roles' | 'permisos';
const VISTAS: readonly Vista[] = ['usuarios', 'roles', 'permisos'];

const TITULO: Record<Vista, string> = {
  usuarios: 'Usuarios',
  roles: 'Roles',
  permisos: 'Permisos',
};

const SUBTITULO: Record<Vista, string> = {
  usuarios: 'Quién entra a la consola, con qué rol y desde cuándo. El alcance sobre la red lo da el nodo al que está adscrito, no el rol.',
  roles: 'Qué roles existen y quién los tiene. El rol define qué puede hacer una persona; el nodo al que está adscrita, hasta dónde alcanza.',
  permisos: 'Qué puede hacer cada rol, capacidad por capacidad. Es la misma matriz que el backend comprueba en cada petición: cambiarla surte efecto de inmediato, sin desplegar.',
};

/**
 * Administración: personal y permisos.
 *
 * Van juntos porque son las dos mitades de la misma pregunta —quién entra y qué puede hacer— y se
 * responden en la misma sesión: se da de alta a alguien y lo siguiente que hace falta saber es qué
 * abre el rol que se le puso. Separarlos en dos módulos obligaba a memorizar la matriz para
 * poder elegir un rol.
 *
 * La matriz es la misma que el backend aplica en cada petición: la publica identity-service y el
 * canal la lee. Vivía escrita en el código del BFF, donde mover una capacidad de un rol a otro
 * exigía compilar y desplegar; ahora es un dato, y guardar aquí surte efecto en la siguiente
 * petición.
 *
 * Ocultar un módulo sigue haciendo la consola usable, no segura: quien tenga el token puede pedir
 * la ruta a mano, y quien manda entonces es el servidor.
 */
export function App({ vista: vistaRuta }: { vista?: string } = {}) {
  const [vista, setVista] = useVista<Vista>(vistaRuta, VISTAS, 'roles');

  const { capabilities: mine, can } = useCapabilities();
  // Por capacidad y no por rol: es lo mismo que el backend comprueba, y así no
  // hay dos definiciones de «quién edita la matriz» que puedan separarse.
  const puedeEditar = can('permissions.manage');
  // El directorio de personal es la excepción: el BFF lo gatea por rol ADMIN y no le declaró
  // capacidad propia. Inventarle una aquí sería declarar un permiso que nadie comprueba.
  const esAdmin = useHasAnyRole(['ADMIN']);

  const state = useAsync(async () => {
    const [roles, capabilities] = await Promise.all([
      permissionsApi.roles(),
      permissionsApi.capabilities(),
    ]);
    return { roles, capabilities };
  }, []);

  /**
   * La matriz **que el BFF aplica**, que no tiene por qué ser la que identity guarda.
   *
   * `roles` viene de identity-service —lo declarado— y esto de `PermissionsService` del BFF —lo
   * que de verdad se comprueba en cada petición, con su caché—. Normalmente coinciden; cuando no,
   * el síntoma es de los peores: la pantalla afirma que un rol puede algo y el servidor contesta
   * 403, o al revés. Se piden las dos y se marca la diferencia, en vez de elegir una y confiar.
   *
   * Va en su propia carga para que un fallo aquí no tire la pantalla: sin ella la matriz sigue
   * siendo legible, sólo pierde la comprobación.
   */
  const aplicada = useAsync(() => permissionsApi.matrix(), []);

  const [abierto, setAbierto] = useState<Role | null>(null);

  const enUsuarios = vista === 'usuarios';

  return (
    <div>
      <PageHeader
        title={TITULO[vista]}
        subtitle={SUBTITULO[vista]}
        actions={!enUsuarios && !puedeEditar
          ? <Badge tone="muted">Sólo lectura · falta permissions.manage</Badge>
          : undefined}
      />

      <Tabs
        value={vista}
        onChange={setVista}
        tabs={[
          ...(esAdmin ? [{ value: 'usuarios' as Vista, label: 'Usuarios', icon: '🪪' }] : []),
          { value: 'roles', label: 'Roles', icon: '🎫' },
          { value: 'permisos', label: 'Permisos', icon: '🔐' },
        ]}
      />

      {enUsuarios && (esAdmin
        ? <Usuarios editable />
        : (
          <Card>
            <b>Acceso restringido</b>
            <p className="bo-page-sub">
              El directorio de personal lo gatea el BFF por rol ADMIN. No es una capacidad que se
              pueda conceder desde la matriz: identity-service lo vuelve a comprobar con tu token.
            </p>
          </Card>
        ))}

      {!enUsuarios && (
      <Block state={state} emptyLabel="El backend no publicó ningún rol.">
        {({ roles, capabilities }) => (
          <>
            {vista === 'roles' ? (
              <RoleList
                roles={roles}
                mine={mine}
                puedeContarUsuarios={esAdmin}
                onOpen={setAbierto}
              />
            ) : (
              <Matrix
                roles={roles}
                capabilities={capabilities}
                mine={mine}
                aplicada={aplicada.data}
                errorAplicada={aplicada.error}
              />
            )}

            {abierto && (
              // `key` por rol: sin ella, abrir un rol distinto sin cerrar el
              // anterior reusa la misma instancia y `useState` conserva la
              // selección del rol previo. El síntoma es de los peores posibles
              // en una pantalla de permisos: se ofrece guardar las capacidades
              // de un rol sobre otro.
              <RoleModal
                key={abierto.code}
                role={abierto}
                todas={capabilities}
                editable={puedeEditar}
                onClose={() => setAbierto(null)}
                onSaved={() => { setAbierto(null); state.reload(); }}
              />
            )}
          </>
        )}
      </Block>
      )}

      {!enUsuarios && (
        <Footnote>
          El alcance de datos no lo da el rol sino el nodo de Estructura comercial al que la persona
          está adscrita, y lo resuelve el BFF con el claim de jerarquía —región, zona, sucursal,
          ejecutivo—, nunca el front. Un rol no puede llegar a un módulo que su matriz le niega:
          esconder la entrada del menú hace la consola usable, no segura.
        </Footnote>
      )}
    </div>
  );
}

/**
 * Las capacidades que **firman**: las que autorizan algo que mueve dinero o cambia a quién se le
 * presta. Es la columna que importa al repartir roles, y la que no se puede leer contando
 * capacidades — un rol con veinte de sólo lectura no firma nada y uno con dos puede firmarlo todo.
 */
const FIRMA: Partial<Record<Capability, string>> = {
  'applications.decide': 'Excepciones de crédito',
  'accounting.close': 'Cierre contable',
  'products.manage': 'Tasas y políticas',
  'permissions.manage': 'Configuración',
  'salesorg.manage': 'Estructura comercial',
  // Dictaminar una identidad habilita un desembolso o un depósito, y resolver una homonimia puede
  // bloquear a una persona: las dos son firmas aunque no muevan un peso por sí mismas.
  'compliance.review-identity': 'Identidad de personas',
  'compliance.adjudicate': 'Coincidencias en listas',
  'beneficiaries.review-identity': 'Identidad de beneficiarias',
};

/**
 * Los roles, en tabla y no en tarjetas.
 *
 * Las tarjetas se veían bien y no dejaban comparar: para saber cuál de dos roles firma, o cuál
 * tiene gente, había que leerlas una por una recorriendo la rejilla. La pregunta de esta pantalla
 * es comparativa —qué roles existen, quién los tiene, cuáles firman— y eso es una tabla.
 *
 * «Cuántos usuarios» sale del directorio de personal en **una** llamada, no una por rol. Sólo se
 * pide si quien mira es ADMIN: `/staff` está gateado por rol y pedirlo sin serlo devuelve 403, que
 * pintaría un error en una columna accesoria.
 */
function RoleList({ roles, mine, puedeContarUsuarios, onOpen }: {
  roles: Role[];
  mine: Set<Capability>;
  puedeContarUsuarios: boolean;
  onOpen: (r: Role) => void;
}) {
  const personal = useAsync(
    () => (puedeContarUsuarios ? staffApi.list() : Promise.resolve(null)),
    [puedeContarUsuarios],
  );

  const usuariosPorRol = useMemo(() => {
    const m = new Map<string, number>();
    (personal.data ?? []).forEach((s) => s.roles.forEach((r) => m.set(r, (m.get(r) ?? 0) + 1)));
    return m;
  }, [personal.data]);

  const firmantes = roles.filter((r) => r.capabilities.some((c) => FIRMA[c])).length;
  const sinCapacidades = roles.filter((r) => r.capabilities.length === 0).length;
  const sinNadie = personal.data ? roles.filter((r) => !usuariosPorRol.get(r.code)).length : null;

  const columns: Array<Column<Role>> = [
    {
      key: 'rol', header: 'Rol',
      render: (r) => (
        <div>
          <b>{r.name}</b>
          <div className="bo-tree-code">{r.code}</div>
        </div>
      ),
    },
    {
      key: 'que', header: 'Qué abre',
      render: (r) => (
        <div style={{ maxWidth: 420 }}>
          {r.capabilities.length === 0
            ? <span className="bo-sub">No abre ninguna pantalla</span>
            : (
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                {r.capabilities.slice(0, 4).map((c) => (
                  <span key={c} className={`bo-cap-chip${mine.has(c) ? ' mine' : ''}`}>{capLabel(c)}</span>
                ))}
                {r.capabilities.length > 4 && (
                  <span className="bo-cap-chip">+{r.capabilities.length - 4}</span>
                )}
              </div>
            )}
        </div>
      ),
    },
    {
      key: 'usuarios', header: 'Usuarios', align: 'right',
      render: (r) => {
        if (!puedeContarUsuarios) return <span className="bo-sub">—</span>;
        if (personal.loading) return <span className="bo-sub">…</span>;
        const n = usuariosPorRol.get(r.code) ?? 0;
        // Un rol sin nadie no es un error, pero sí es lo que se busca al limpiar la matriz: cuesta
        // mantenerlo y no protege a nadie.
        return n === 0
          ? <span className="bo-sub">sin nadie</span>
          : <b>{count(n)}</b>;
      },
    },
    {
      key: 'firma', header: 'Qué autoriza',
      render: (r) => {
        const firma = r.capabilities.map((c) => FIRMA[c]).filter(Boolean) as string[];
        return firma.length === 0
          ? <Badge tone="muted">No autoriza</Badge>
          : (
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              {firma.map((f) => <Chip key={f} tone="warn">{f}</Chip>)}
            </div>
          );
      },
    },
    {
      key: 'origen', header: 'Origen',
      render: (r) => (r.systemManaged
        ? <Badge tone="info">Del sistema</Badge>
        : <Badge tone="muted">Propio</Badge>),
    },
    {
      key: 'cambio', header: 'Último cambio',
      render: (r) => (r.updatedAt
        ? <span style={{ fontSize: 12.5 }}>{dateTime(r.updatedAt)}</span>
        : <span className="bo-sub">nunca</span>),
    },
  ];

  return (
    <>
      <Stats>
        <StatCard label="Roles definidos" value={count(roles.length)}
                  sub={`${count(roles.filter((r) => r.systemManaged).length)} los define el producto`} />
        <StatCard label="Con facultad de firma" value={count(firmantes)}
                  tone={firmantes > 0 ? 'warn' : undefined}
                  sub="autorizan algo que mueve dinero o crédito" />
        <StatCard label="Sin ninguna capacidad" value={count(sinCapacidades)}
                  tone={sinCapacidades > 0 ? 'warn' : undefined}
                  sub={sinCapacidades > 0 ? 'entran y no ven nada' : 'todos abren algo'} />
        <StatCard label="Sin usuarios asignados"
                  value={sinNadie == null ? '—' : count(sinNadie)}
                  tone={sinNadie ? 'warn' : undefined}
                  sub={sinNadie == null ? 'requiere ver el directorio' : 'candidatos a retirar'} />
      </Stats>

      <CardTitled
        title={`Roles${roles.length ? ` · ${count(roles.length)}` : ''}`}
        action={<span className="bo-page-sub">Abre uno para ver y editar sus capacidades</span>}
      >
        <DataTable
          columns={columns}
          rows={roles}
          rowKey={(r) => r.code}
          onRowClick={onOpen}
          emptyMessage="El backend no publicó ningún rol."
        />
      </CardTitled>
    </>
  );
}

/**
 * La matriz completa. Sirve para comparar roles entre sí, que es lo que la lista no deja ver.
 *
 * Cada celda cruza dos fuentes: lo que **identity declara** para el rol y lo que el **BFF aplica**
 * en cada petición. Coinciden casi siempre; cuando no, la celda se marca, porque una divergencia
 * ahí es la causa de los dos fallos más desconcertantes de una consola —un botón que existe y
 * responde 403, y una pantalla escondida a quien sí puede entrar— y hasta ahora no había forma de
 * verla sin leer los logs del servidor.
 */
function Matrix({ roles, capabilities, mine, aplicada, errorAplicada }: {
  roles: Role[]; capabilities: Capability[]; mine: Set<Capability>;
  /** Lo que el BFF comprueba. `null` mientras carga o si no se pudo leer. */
  aplicada: PermissionMatrix | null;
  errorAplicada: string | null;
}) {
  const [soloMias, setSoloMias] = useState(false);
  const [soloDiferencias, setSoloDiferencias] = useState(false);

  /** Las celdas donde lo declarado y lo aplicado no dicen lo mismo. */
  const divergentes = useMemo(() => {
    if (!aplicada) return new Set<string>();
    const fuera = new Set<string>();
    roles.forEach((r) => {
      const enforce = new Set(aplicada[r.code] ?? []);
      capabilities.forEach((c) => {
        if (r.capabilities.includes(c) !== enforce.has(c)) fuera.add(`${r.code}|${c}`);
      });
    });
    return fuera;
  }, [aplicada, roles, capabilities]);

  const mostradas = useMemo(() => {
    let cs = capabilities;
    if (soloMias) cs = cs.filter((c) => mine.has(c));
    if (soloDiferencias) cs = cs.filter((c) => roles.some((r) => divergentes.has(`${r.code}|${c}`)));
    return cs;
  }, [capabilities, soloMias, soloDiferencias, mine, roles, divergentes]);

  return (
    <CardTitled
      title="Matriz de capacidades"
      action={
        <div style={{ display: 'flex', gap: 8 }}>
          {divergentes.size > 0 && (
            <Button
              selected={soloDiferencias}
              onClick={() => setSoloDiferencias((v) => !v)}
              title="Celdas donde lo que identity declara y lo que el BFF aplica no coinciden"
            >
              Ver desajustes · {divergentes.size}
            </Button>
          )}
          <Button onClick={() => setSoloMias((v) => !v)}>
            {soloMias ? 'Ver todas' : `Ver sólo las mías (${mine.size})`}
          </Button>
        </div>
      }
    >
      {divergentes.size > 0 && (
        <div className="bo-card-pad" style={{ paddingBottom: 0 }}>
          <div className="bo-alert bo-huerfanos">
            <b>{divergentes.size} celdas no coinciden</b> entre lo que identity-service declara para
            el rol y lo que <b>channel-backoffice-service</b> comprueba en cada petición. Son las
            marcadas con un aspa. Mientras dure, manda el servidor: una capacidad declarada que el
            BFF no aplica es un botón que contesta 403.
          </div>
        </div>
      )}
      {errorAplicada && (
        <div className="bo-card-pad" style={{ paddingBottom: 0 }}>
          <span className="bo-page-sub">
            No se pudo leer la matriz que aplica el BFF ({errorAplicada}); abajo se ve sólo lo que
            identity declara, sin cotejar.
          </span>
        </div>
      )}
      <div className="bo-table-wrap">
        <table className="bo-table bo-matrix">
          <thead>
            <tr>
              <th>Capacidad</th>
              {roles.map((r) => <th key={r.code} className="num" title={r.code}>{r.name}</th>)}
            </tr>
          </thead>
          <tbody>
            {mostradas.length === 0 && (
              <tr>
                <td colSpan={roles.length + 1}>
                  <div className="bo-table-empty">
                    {soloDiferencias ? 'No hay desajustes con ese recorte.' : 'Ninguna capacidad con ese recorte.'}
                  </div>
                </td>
              </tr>
            )}
            {mostradas.map((cap) => (
              <tr key={cap}>
                <td>
                  <b style={{ fontSize: 12.5 }}>{capLabel(cap)}</b>
                  <div className="bo-tree-code">{cap}</div>
                </td>
                {roles.map((r) => {
                  const declarada = r.capabilities.includes(cap);
                  const desajuste = divergentes.has(`${r.code}|${cap}`);
                  if (desajuste) {
                    const enforce = (aplicada?.[r.code] ?? []).includes(cap);
                    return (
                      <td key={r.code} className="num">
                        <span
                          style={{ color: 'var(--bo-bad)', fontWeight: 700 }}
                          title={enforce
                            ? `${r.name}: identity NO lo declara, pero el BFF sí lo aplica`
                            : `${r.name}: identity lo declara, pero el BFF NO lo aplica — responderá 403`}
                        >
                          ✕
                        </span>
                      </td>
                    );
                  }
                  return (
                    <td key={r.code} className="num">
                      {declarada
                        ? <span className="bo-yes" title={`${r.name} puede ${capLabel(cap).toLowerCase()}`}>✓</span>
                        : <span className="bo-no">·</span>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </CardTitled>
  );
}

/**
 * Detalle de un rol y edición de sus capacidades.
 *
 * Se guarda el conjunto completo, no la diferencia: es lo que la pantalla enseña
 * y lo que el backend espera. Mientras no se guarde, lo marcado es una intención
 * —se ve qué cambió respecto de lo vigente— y salirse sin guardar no cambia nada.
 */
function RoleModal({ role, todas, editable, onClose, onSaved }: {
  role: Role; todas: Capability[]; editable: boolean;
  onClose: () => void; onSaved: () => void;
}) {
  const [sel, setSel] = useState<Set<Capability>>(new Set(role.capabilities));
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const original = useMemo(() => new Set(role.capabilities), [role]);
  const agregadas = [...sel].filter((c) => !original.has(c));
  const quitadas = [...original].filter((c) => !sel.has(c));
  const cambió = agregadas.length > 0 || quitadas.length > 0;

  const toggle = (c: Capability) => setSel((s) => {
    const n = new Set(s);
    if (n.has(c)) n.delete(c); else n.add(c);
    return n;
  });

  const guardar = async () => {
    setGuardando(true); setError(null);
    try {
      await permissionsApi.replaceCapabilities(role.code, [...sel]);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar');
    } finally {
      setGuardando(false);
    }
  };

  // Agrupadas por módulo: "applications.decide" y "applications.view" se deciden
  // juntas, y una lista alfabética de trece renglones las separa sin motivo.
  const porModulo = useMemo(() => {
    const g = new Map<string, Capability[]>();
    todas.forEach((c) => {
      const modulo = c.split('.')[0];
      g.set(modulo, [...(g.get(modulo) ?? []), c]);
    });
    return [...g.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [todas]);

  return (
    <Modal
      title={role.name}
      subtitle={`${role.code} · ${role.systemManaged ? 'rol del sistema' : 'rol propio'}`}
      onClose={onClose}
      actions={
        editable ? (
          <>
            {cambió && (
              <span className="bo-page-sub" style={{ marginRight: 6 }}>
                {agregadas.length > 0 && <b style={{ color: 'var(--bo-ok)' }}>+{agregadas.length} </b>}
                {quitadas.length > 0 && <b style={{ color: 'var(--bo-bad)' }}>−{quitadas.length}</b>}
              </span>
            )}
            <Button variant="primary" onClick={() => void guardar()} disabled={!cambió || guardando}>
              {guardando ? 'Guardando…' : 'Guardar'}
            </Button>
          </>
        ) : undefined
      }
    >
      {/* La descripción quedaba pegada al primer encabezado de módulo —«…no un rol de negocio.»
          seguido de «Solicitudes» sin aire—, y las dos líneas se leían como una sola. Separarla
          es lo que hace que el bloque de abajo se lea como una lista y no como continuación. */}
      <p className="bo-page-sub" style={{ margin: '0 0 16px' }}>
        {role.description ?? 'Sin descripción registrada.'}
      </p>

      {!editable && (
        <div className="bo-alert" style={{ marginBottom: 14 }}>
          Cambiar la matriz exige la capacidad <b>permissions.manage</b>. Aquí se ve lo que este rol puede hacer hoy.
        </div>
      )}

      {guardando ? <Spinner /> : (
        <div style={{ display: 'grid', gap: 16 }}>
          {porModulo.map(([modulo, caps]) => (
            <div key={modulo}>
              <div className="bo-grupo-cap">{moduloLabel(modulo)}</div>
              <div style={{ display: 'grid', gap: 6 }}>
                {caps.map((c) => {
                  const marcada = sel.has(c);
                  const nuevo = marcada && !original.has(c);
                  const fuera = !marcada && original.has(c);
                  return (
                    <label
                      key={c}
                      className={`bo-cap-row${nuevo ? ' added' : ''}${fuera ? ' removed' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={marcada}
                        disabled={!editable}
                        onChange={() => toggle(c)}
                      />
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <b style={{ fontSize: 13 }}>{capLabel(c)}</b>
                        <span className="bo-tree-code"> {c}</span>
                      </span>
                      {nuevo && <Badge tone="ok">se agrega</Badge>}
                      {fuera && <Badge tone="bad">se quita</Badge>}
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {error && <p style={{ color: 'var(--bo-bad)', fontSize: 13, marginTop: 12 }}>{error}</p>}
    </Modal>
  );
}

function moduloLabel(m: string): string {
  const map: Record<string, string> = {
    applications: 'Crédito', audit: 'Auditoría', clients: 'Clientes',
    dashboard: 'Tablero', portfolio: 'Cartera', products: 'Productos',
    salesorg: 'Estructura comercial', accounting: 'Contabilidad',
    // Faltaba, y el efecto no era sólo estético: el grupo salía titulado «permissions» en
    // minúscula entre encabezados en español, así que parecía un error de datos y no un módulo.
    permissions: 'Roles y permisos',
    // Sin estas, los grupos del rol salían titulados con el prefijo técnico entre encabezados en
    // español, que se lee como un error de datos y no como un módulo.
    compliance: 'Cumplimiento', beneficiaries: 'Beneficiarios', treasury: 'Bancos y tesorería',
  };
  return map[m] ?? m;
}

function capLabel(c: string): string {
  const map: Record<string, string> = {
    'applications.view': 'Ver solicitudes',
    'applications.analyze': 'Analizar (buró y score)',
    'applications.decide': 'Aprobar o rechazar',
    'applications.request-documents': 'Pedir documentos',
    // Faltaban las dos y el efecto no era sólo estético: la fila salía titulada «accounting.close»
    // con el mismo texto repetido debajo como código, que se lee como un fallo de la pantalla.
    // Van separadas porque son actos distintos: un auditor lee el mayor y no mueve el corte.
    'accounting.view': 'Consultar contabilidad',
    'accounting.close': 'Cerrar el período contable',
    'audit.view': 'Consultar auditoría',
    'clients.view': 'Ver clientes',
    'clients.assign-executive': 'Asignar ejecutivo',
    'dashboard.view': 'Ver tablero',
    'dashboard.commercial': 'Tablero comercial por unidad',
    'portfolio.view': 'Ver cartera',
    'products.manage': 'Administrar productos',
    'salesorg.view': 'Ver estructura comercial',
    'salesorg.manage': 'Editar estructura comercial',
    // Sin estas dos, la fila mostraba «permissions.manage» como nombre *y* como código debajo:
    // el mismo texto repetido, que se lee como un fallo de la pantalla.
    'permissions.view': 'Ver roles y permisos',
    'permissions.manage': 'Editar roles y permisos',
    // Las de cumplimiento y beneficiarios llegaron después y se quedaron sin nombre: la matriz las
    // mostraba con el código como título y otra vez debajo, justo en las filas que dicen quién
    // firma una identidad.
    'compliance.view': 'Ver la mesa de cumplimiento',
    'compliance.review-identity': 'Dictaminar identidad (KYC)',
    'compliance.adjudicate': 'Resolver coincidencias en listas',
    'beneficiaries.view': 'Ver colocaciones a beneficiarios',
    'beneficiaries.review-identity': 'Dictaminar identidad de beneficiarias',
    'treasury.view': 'Ver bancos y tesorería',
  };
  return map[c] ?? c;
}

export default App;
