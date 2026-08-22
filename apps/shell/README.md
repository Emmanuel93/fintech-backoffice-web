# shell — host de la consola  ·  `:4200`

Lo único que no es un dominio: login, menú, router, gating y carga de los remotes. No tiene
pantallas de negocio propias.

## Qué vive aquí

| Archivo | Qué decide |
|---|---|
| `src/nav.ts` | Las ocho secciones, sus pantallas, su ruta, la `vista` que abren y la capacidad que exigen |
| `src/layout/AppFrame.tsx` | La barra lateral plegable, la barra superior y el «Salir» que cierra sesión en identity |
| `src/App.tsx` | Rutas, `CapabilitiesProvider`, y el `RemoteBoundary` que aísla un remote caído |
| `src/mf.ts` | Registro de los diez remotes (`type: 'module'` — son ESM) |
| `src/layout/Buzon.tsx` | La campana: buzón del empleado en sesión, con su indicador de no leídas |
| `src/pages/LoginPage.tsx` | Acceso, con atajos por rol cuando hay `VITE_DEV_PASSWORD` |

## Reglas que no son obvias

**El menú se deriva del backend.** `GET /permissions/me` una vez por sesión; cada entrada declara
qué capacidad exige. La excepción es `/staff/**`, que el BFF gatea por rol `ADMIN` — para eso
`NavItem` acepta `roles`, en vez de inventarle una capacidad que nadie comprueba.

**La `vista` viaja como prop, no como `key`.** Remontar el módulo al cambiar de pantalla tiraría lo
que vale para todas: el período contable, por ejemplo. Volver de «Balanza» a «Pólizas» reabriría en
el mes por defecto a media conciliación.

**Un remote por alias, no por ruta.** Contabilidad tiene cuatro pantallas y un solo contenedor
federado; con una entrada por ruta se creaban cuatro `lazy()` del mismo contenedor.

**Lo pendiente de conectar cuelga del permiso de su sección.** Una entrada marcada `pendiente` no
tiene capacidad propia todavía; sin esa regla, a quien no puede ver originación le aparecería una
sección con un único renglón apagado que no le incumbe.

**`RemoteBoundary` saca el puerto del propio error.** El mensaje llevaba el rango escrito a mano y
envejeció dos veces, mandando a revisar puertos que no eran el del módulo que falló.

**El buzón se pide al abrir, no en bucle.** Un sondeo cada treinta segundos por cada pestaña
multiplica la carga del servicio por el número de pestañas para enterarse de algo que casi nunca
cambia. Y distingue «sin avisos» de «no pudimos preguntar»: el BFF nunca falla esa llamada —si
notifications no responde manda `degraded: true`—, y confundir las dos hace que alguien deje de
revisar algo que sí tenía.
