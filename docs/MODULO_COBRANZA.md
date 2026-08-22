# Módulo de cobranza — qué se construyó y qué quedó fuera

> Ejecutado el 2026-08-13 contra la especificación D8. Verificado de punta a punta
> con el backend local (4 casos reales).

## Estado contra el backlog de la especificación

La especificación listaba diez puntos de backend, con los tres primeros marcados como
bloqueantes duros. Quedan así:

| # | Qué faltaba | Estado |
|---|---|---|
| 1 | `CollectionsController` en el BFF | ✅ Hecho |
| 2 | `GET /collections/cases` paginado con filtros | ✅ Hecho |
| 3 | Listados por caso (contactos, promesas, convenios, quebranto) | ✅ Hecho |
| 4 | Conteo de intentos de hoy | ✅ Hecho — viaja con la lista de contactos |
| 5 | `GET /collections/agreements?status=ACCEPTED` | ✅ Hecho como `/agreements/awaiting-authorization` |
| 6 | Persistir la solicitud de quebranto | ❌ **No hecho** — ver abajo |
| 7 | `GET /collections/config` | ✅ Hecho |
| 8 | Asignación de agente / agencia externa | ❌ **No hecho** |
| 9 | Capacidades propias y maker≠checker en servidor | ❌ **No hecho** |
| 10 | Catálogo de canales de contacto | 🟡 Parcial — fijado en el cliente, el servidor sigue aceptando texto libre |

## Cambios en `fintech-services`

### `collections-service`

- **`CollectionCaseRepository.search(...)`** — búsqueda paginada por estado, bucket, producto,
  gestor y mora mínima. Se resuelve en SQL con guardas `:x IS NULL OR …`, siguiendo el patrón que
  ya usa `CreditAccountRepository`.
- **`CollectionAgreementRepository`** — dos consultas derivadas: historial por caso y bandeja de
  `ACCEPTED`.
- **`CaseTimelineUseCase` / `CaseTimelineService`** (nuevos) — sólo lectura. Reúne contactos,
  promesas, convenios y acta de quebranto. El conteo de intentos de hoy usa **el mismo corte de
  día** que `ContactService` aplica al validar CT-03; duplicar el criterio con otra zona horaria
  haría que la pantalla dijera «1 de 3» mientras el backend rechaza por tope.
- **`CollectionsController`** — nueve endpoints de lectura nuevos, incluido `/config`.
- **DTOs nuevos** — `ContactAttemptsResponse` (lista + cupo del día) y `CollectionsConfigResponse`.

### `channel-backoffice-service`

- **`CollectionsClient`** (nuevo) — todos los verbos, reenviando `X-User-Id`/`X-Roles`/`X-Channel`.
  Importa más que en una consulta: el agente que queda registrado en un contacto o una promesa sale
  de esas cabeceras, no del cuerpo.
- **`CollectionsController`** (nuevo) — las rutas `/collections/**`, en plural y sin versionar.

  > La especificación advertía de esta trampa y es real: el matcher de seguridad declarado es
  > `/collections/**`. Una ruta en singular no casa con él, cae en el `anyRequest().authenticated()`
  > final y responde igual de bien, pero sin comprobar capacidad.

  Hidrata la bandeja resolviendo nombres **en lote** (dos llamadas a party como máximo por página,
  no una por fila) y el detalle con los saldos reales de cartera. Cada pieza secundaria se degrada
  sola: si party o cartera no contestan, la ficha pierde el nombre o los saldos pero conserva el caso.

### Documentación

- `docs/modules/collections/README.md` reescrito contra el código. Lo anterior describía cuatro
  buckets (`B91_PLUS`, que no existe) y un umbral de quebranto de 91 días; son siete buckets y 181
  días. Incluye ahora la superficie de API y los seis pendientes conocidos.

## Cambios en el frontend

- **`libs/api-client/src/lib/collections.ts`** — tipos y cliente.
- **`apps/mfe-collections/`** — módulo nuevo en el puerto 5109. Tres vistas (bandeja, por autorizar,
  buró) y un expediente con cuatro pestañas (resumen, gestión, convenios, quebranto).
- **`apps/shell/src/nav.ts` y `mf.ts`** — «Cobranza» pasa de *Próximamente* a módulo real en
  `/cobranza`.
- **`run-dev.sh`** — el remote nuevo entra en la lista que el supervisor vigila.

## Decisiones que conviene conocer

**El saldo que se muestra es el de cartera, no el del caso.** `totalDebt` del caso es una proyección
local por eventos y va un instante por detrás. Se conserva únicamente para calcular el máximo
condonable, porque es contra ese número que valida el dominio: ofrecer un tope calculado con el
saldo de cartera produce quitas que el backend rechaza por centavos.

**Las reglas se muestran como bloqueo con su razón, no como error después de intentar.** La ventana
CONDUSEF, el tope de intentos, el umbral de quebranto y el estado del caso deshabilitan el control y
dicen por qué. `COLLECTIONS_INVALID_CASE_STATE` cubre seis situaciones distintas con el mismo
código, así que cuando el 422 igual llega se muestra su `detail` tal cual: es lo único que dice cuál
de las seis fue.

**El expediente recarga entero después de cada acción** en vez de parchear estado local. Es una
llamada de más y a cambio la pantalla no miente: registrar un contacto mueve el cupo del día,
aceptar un convenio cambia qué botones existen, y un job nocturno puede haber movido el caso
mientras estaba abierto.

**La fecha de promesa se valida en el cliente.** El backend no comprueba que sea futura, y una
promesa para ayer nace rota: el job de las 08:00 la marca así al día siguiente.

## Lo que no se puede construir todavía

- **Bandeja del comité de quebranto.** `request-write-off` devuelve 202 y no persiste nada: la
  intención sólo viaja como evento Kafka. La pantalla lo dice explícitamente en vez de simular una
  solicitud que nadie podrá consultar.
- **Filtro «mis casos» y reparto de trabajo.** `assignedAgentId` y `externalAgencyId` son siempre
  nulos. El filtro por gestor está implementado de punta a punta y no devolverá nada hasta que algo
  invoque `assignAgent()`.
- **Control real de cuatro ojos.** El formulario pide quién autoriza y con qué acta, y queda el
  rastro — pero el dominio no compara ese valor contra quien propuso. Cualquiera puede autorizar lo
  que él mismo propuso.
- **Capacidades separadas.** El módulo se gatea con `portfolio.view`, que es lo que el BFF declara.
  Gatearlo en el cliente con `collections.authorize` escondería botones sin cerrar la puerta.

## Verificación realizada

Con el backend local y sesión de administrador:

- Las cuatro rutas nuevas del BFF responden 200; `/config` devuelve los siete parámetros.
- La bandeja trae 4 casos reales con nombres resueltos en lote.
- El detalle hidrata saldos de cartera, cupo de contactos, promesas, convenios y quebranto.
- `POST` de promesa devuelve 201, queda con el agente resuelto del token y aparece en el detalle;
  la segunda promesa sobre el mismo caso devuelve 422 `COLLECTIONS_INVALID_CASE_STATE`.
- En navegador: el módulo aparece en el menú, la bandeja pinta 4 filas y las cuatro pestañas del
  expediente renderizan sin errores de consola. Las tres reglas gatearon correctamente — ventana de
  contacto fuera de horario, caso `OPEN` sin convenios, y quebranto pidiendo 181 días sobre 128.

**No verificado:** el flujo completo de convenio (proponer → aceptar → autorizar) y el de quebranto,
porque ningún caso sembrado está en un estado que los permita — todos están `OPEN` y por debajo del
umbral. Las rutas responden; la secuencia de negocio no se ejecutó extremo a extremo.
