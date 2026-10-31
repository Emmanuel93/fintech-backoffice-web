import type { Capability, Role } from '@bo/shared-types';

/**
 * El menú de la consola, agrupado por el momento del negocio.
 *
 * Antes eran diez entradas sueltas en una sola columna. Con veintitantas pantallas eso obliga a
 * leer la lista entera para encontrar la balanza, y no dice nada de cómo se relacionan: «Cobranza»
 * y «Contabilidad» parecían del mismo orden que «Roles y permisos». Agrupado por originar, seguir,
 * cobrar, definir el producto, contabilizar, organizar la red y administrar, se llega por
 * eliminación y el modelo operativo queda a la vista.
 *
 * Cada pantalla es una **ruta propia** —`/contabilidad/balanza`, no una pestaña sin dirección—.
 * Eso es lo que permite mandar un enlace a un compañero y que abra donde uno estaba, y lo que hace
 * que el botón de atrás del navegador signifique algo dentro de un módulo. La ruta se traduce a la
 * `vista` que el remote abre; las pestañas siguen existiendo dentro del módulo, pero ya no son la
 * única forma de llegar.
 *
 * Qué se ve lo decide el backend, no esta lista:
 * - `capability` — lo que `GET /permissions/me` publica para esta sesión.
 * - `roles` — para lo que el BFF todavía gatea por rol y no por capacidad (`/staff/**` exige ADMIN
 *   y no tiene capacidad propia; declararle una aquí sería inventarse un permiso que nadie
 *   comprueba).
 *
 * Ocultar un módulo hace la consola usable, no segura: quien tenga el token puede pedir la ruta a
 * mano, y quien manda entonces es el servidor.
 */
export interface NavItem {
  /** Ruta completa. La primera de cada sección es la raíz del módulo. */
  to: string;
  label: string;
  /** Alias de federación en `src/mf.ts`. */
  alias: string;
  /** Qué pantalla abre el remote. Sin valor, la de entrada del módulo. */
  vista?: string;
  capability?: Capability;
  /** Gate por rol, sólo donde el BFF todavía autoriza por rol. */
  roles?: Role[];
  /**
   * Está en el modelo operativo pero no tiene de dónde leer todavía. Se pinta apagado y con la
   * razón al posarse encima: esconderlo haría que la consola pareciera no contemplarlo, y ponerlo
   * activo mandaría a una pantalla vacía sin explicación.
   */
  pendiente?: string;
}

export interface NavSection {
  key: string;
  title: string;
  icon: string;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    key: 'panorama',
    title: 'Panorama',
    icon: '📊',
    items: [
      { to: '/', label: 'Panorama', alias: 'mfe-dashboard', capability: 'dashboard.view' },
    ],
  },
  {
    key: 'originacion',
    title: 'Originación',
    icon: '📝',
    items: [
      // Una sola entrada para el ciclo entero —captura, mesa de análisis, decisión, oferta,
      // contrato y desembolso—. «Por decidir» estuvo aquí como entrada propia y se retiró: no es
      // una pantalla, es el filtro por los estados que esperan a una persona, y vive como botón
      // dentro de la bandeja. Un menú que ofrece la lista y un recorte de la misma lista obliga a
      // elegir entre dos puertas al mismo sitio antes de saber cuál lleva a lo que se busca.
      // Originar es dos cosas: captar una solicitud —el embudo entero, de la captura al
      // desembolso— o captar al beneficiario de una colocación, donde lo único que valida la
      // financiera es su identidad. Misma sección, dos alcances distintos.
      { to: '/solicitudes', label: 'Solicitudes de crédito', alias: 'mfe-applications', vista: 'bandeja', capability: 'applications.view' },
      { to: '/beneficiarios', label: 'Beneficiarios · KYC', alias: 'mfe-applications', vista: 'beneficiarios', capability: 'beneficiaries.view' },
      // La compuerta común a los dos: identidad y listas por persona. Va en Originación porque es
      // donde detiene algo —sin ella no se dispone ni se coloca—, no en Administración.
      { to: '/cumplimiento', label: 'Cumplimiento · identidad y listas', alias: 'mfe-applications', vista: 'cumplimiento', capability: 'compliance.view' },
    ],
  },
  {
    key: 'cartera',
    // «Cartera» a secas, y el renglón de las cuentas se llama «Cuentas de crédito». Antes la
    // sección se llamaba «Seguimiento de cartera» y su primer renglón «Cartera»: la misma palabra
    // dos veces, una encima de la otra, sin decir en qué se diferencian.
    title: 'Cartera',
    icon: '💼',
    items: [
      { to: '/cartera', label: 'Cuentas de crédito', alias: 'mfe-portfolio', capability: 'portfolio.view' },
      // «Clientes» y no «Clientes y KYC»: el estado del expediente es una columna de la tabla, no
      // media identidad de la pantalla.
      { to: '/clientes', label: 'Clientes', alias: 'mfe-clients', vista: 'personas', capability: 'clients.view' },
      { to: '/clientes/distribuidores', label: 'Distribuidores', alias: 'mfe-clients', vista: 'distribuidores', capability: 'clients.view' },
      {
        to: '/cartera/contratos', label: 'Contratos', alias: 'mfe-portfolio',
        pendiente: 'El contrato y su tabla de amortización se leen hoy dentro de la ficha de la cuenta; el BFF no publica todavía una consulta de contratos por sí sola.',
      },
    ],
  },
  {
    key: 'cobranza',
    title: 'Cobranza',
    icon: '📞',
    items: [
      { to: '/cobranza', label: 'Bandeja de casos', alias: 'mfe-collections', vista: 'bandeja', capability: 'portfolio.view' },
      // Reestructuras y quitas son los dos tipos de convenio y se autorizan en el mismo sitio: los
      // separa el tipo, no el flujo, y quien firma revisa las dos en la misma sesión.
      { to: '/cobranza/convenios', label: 'Convenios por autorizar', alias: 'mfe-collections', vista: 'autorizar', capability: 'portfolio.view' },
      { to: '/cobranza/buro', label: 'Reportes a buró', alias: 'mfe-collections', vista: 'buro', capability: 'portfolio.view' },
      { to: '/cobranza/promesas', label: 'Promesas de pago', alias: 'mfe-collections', vista: 'promesas', capability: 'portfolio.view' },
      { to: '/cobranza/contacto', label: 'Contacto y gestión', alias: 'mfe-collections', vista: 'gestion', capability: 'portfolio.view' },
    ],
  },
  {
    key: 'credito',
    title: 'Crédito',
    icon: '📦',
    items: [
      { to: '/productos', label: 'Productos y tasas', alias: 'mfe-products', vista: 'catalogo', capability: 'products.manage' },
      { to: '/productos/politicas', label: 'Políticas de scoring', alias: 'mfe-products', vista: 'politicas', capability: 'products.manage' },
    ],
  },
  {
    key: 'contabilidad',
    title: 'Contabilidad',
    icon: '📒',
    items: [
      { to: '/contabilidad', label: 'Resumen general', alias: 'mfe-accounting', vista: 'resumen', capability: 'accounting.view' },
      { to: '/contabilidad/polizas', label: 'Pólizas', alias: 'mfe-accounting', vista: 'polizas', capability: 'accounting.view' },
      { to: '/contabilidad/facturas', label: 'Facturas', alias: 'mfe-accounting', vista: 'facturas', capability: 'accounting.view' },
      { to: '/contabilidad/balanza', label: 'Balanza', alias: 'mfe-accounting', vista: 'balanza', capability: 'accounting.view' },
      // Va en Contabilidad porque se concilia contra ella —la póliza de egreso contra el SPEI que
      // de verdad salió—, pero con su propia capacidad: operación contesta «¿ya le llegó?» con la
      // clave de rastreo, y para eso no necesita leer el mayor.
      { to: '/contabilidad/tesoreria', label: 'Bancos y tesorería', alias: 'mfe-accounting', vista: 'tesoreria', capability: 'treasury.view' },
    ],
  },
  {
    key: 'red',
    title: 'Red comercial',
    icon: '🎯',
    items: [
      { to: '/estructura', label: 'Estructura comercial', alias: 'mfe-salesorg', vista: 'arbol', capability: 'salesorg.view' },
      // La misma red por quién **colocó** el crédito, no por quién la lleva hoy. Dos preguntas
      // distintas de la misma cartera; separarlas evita que sus cifras se lean como contradicción.
      { to: '/estructura/origen', label: 'Colocación por origen', alias: 'mfe-salesorg', vista: 'origen', capability: 'salesorg.view' },
    ],
  },
  {
    key: 'admin',
    title: 'Administración',
    icon: '🔐',
    items: [
      // `/staff/**` lo gatea el BFF por rol ADMIN y no por capacidad; aquí se declara igual para no
      // ofrecer una pantalla que va a contestar 403.
      { to: '/usuarios', label: 'Usuarios', alias: 'mfe-rbac', vista: 'usuarios', roles: ['ADMIN'] },
      // Roles y permisos son **dos pantallas**, no una con pestañas. Son dos preguntas distintas y
      // de dos momentos distintos: «qué roles existen y quién los tiene» se consulta al dar de alta
      // a alguien; «qué puede hacer cada rol en cada módulo» se consulta al auditar o al conceder.
      // Juntas obligaban a entrar por una para llegar a la otra, y ninguna de las dos tenía
      // dirección propia que mandar por enlace.
      { to: '/roles', label: 'Roles', alias: 'mfe-rbac', vista: 'roles', capability: 'permissions.view' },
      { to: '/permisos', label: 'Permisos', alias: 'mfe-rbac', vista: 'permisos', capability: 'permissions.view' },
      // «Auditoría» y no «Bitácora»: es el nombre con el que la pantalla se presenta, y un enlace
      // que se llama distinto que la pantalla a la que lleva hace dudar de si son la misma.
      { to: '/auditoria', label: 'Auditoría', alias: 'mfe-audit', capability: 'audit.view' },
    ],
  },
];

/** Todas las entradas navegables, en el orden del menú. Es de donde salen las rutas. */
export const NAV_ITEMS: NavItem[] = NAV_SECTIONS
  .flatMap((s) => s.items)
  .filter((i) => !i.pendiente);

/** Los remotes que hay que instanciar: uno por alias, no uno por ruta. */
export const NAV_ALIASES: string[] = [...new Set(NAV_ITEMS.map((i) => i.alias))];

/**
 * La entrada que corresponde a una ruta.
 *
 * La coincidencia es exacta y no por prefijo: `/clientes` y `/clientes/distribuidores` son dos
 * pantallas, y con prefijo la segunda se resolvería como la primera.
 */
export function itemDe(pathname: string): NavItem | undefined {
  return NAV_ITEMS.find((i) => i.to === pathname);
}

/** La sección de la que cuelga una ruta, para abrirla al entrar por enlace directo. */
export function seccionDe(pathname: string): NavSection | undefined {
  return NAV_SECTIONS.find((s) => s.items.some((i) => i.to === pathname));
}

// Aquí vivía «Próximamente», con Comisiones y Configuración. Las dos se retiraron:
// Configuración porque ya existe repartida en Usuarios, Roles y Permisos, y Comisiones porque se
// aborda por otra vía y no va a ser un módulo de esta consola.
//
// Con eso el menú deja de prometer. Un rótulo apagado que nunca se enciende enseña a ignorar la
// última sección de la columna, y entonces también se ignora el día que ahí aparezca algo real.
