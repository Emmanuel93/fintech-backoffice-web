# Plan de ingeniería — Habilitar los cuatro módulos pendientes del backoffice

**Repo objetivo:** `fintech-services` · **Rama base:** `feature/backoffice-query-mode`
**Consumidor:** `channel-backoffice-service` → `fintech-backoffice-web`
**Verificación:** harness e2e existente (90 comprobaciones, hoy en verde)

Seis entregables: un servicio nuevo, dos ampliaciones y tres exposiciones de dominio que ya existe.
Cada decisión de diseño viene con su alternativa descartada, porque varias son discutibles y
conviene discutirlas antes de escribirlas.

---

## Contexto

La consola de backoffice está construida y conectada: cartera, clientes, productos, tablero y RBAC
funcionan de punta a punta contra los servicios reales. Faltan cuatro módulos —Solicitudes,
Configuración, Auditoría y Red comercial— y en tres de los cuatro **el dominio ya existe: el trabajo
es exponerlo, no construirlo**. El cuarto, la estructura comercial, no existe en ninguna parte del
sistema y es el único servicio nuevo que propongo.

### Invariantes que este trabajo no puede romper

- **Topología.** `web → gateway → BFF → dominio`. Ningún servicio de dominio publica puerto fuera de
  la red de Docker. Esa es la garantía de que el navegador no puede saltarse el BFF, y de ella
  depende que el BFF pueda confiar en las cabeceras `X-User-Id`/`X-Roles` que el gateway inyecta
  tras validar el JWT.
- **Fan-out.** El número de llamadas del BFF no puede depender del número de filas devueltas. Si hay
  que resolver N entidades, el servicio dueño expone `/batch?ids=`. Nunca un bucle.
- **Party I-01 / I-03.** `partyType` es inmutable; un distribuidor es `INDIVIDUAL` o `BUSINESS` con
  un rol adicional, nunca un tercer tipo.
- **Canal.** El claim `channel` del JWT separa las puertas. Un token `MOBILE` no abre el backoffice
  aunque su firma sea válida.

---

## Hechos verificados

Leídos en el código, no inferidos del diseño. Están aquí para no re-derivarlos, y para que si alguno
resulta falso se detenga el plan en vez de construir encima.

| Afirmación | Dónde | Estado |
|---|---|---|
| `RiskLevel` {BAJO,MEDIO,ALTO} → `ScoringDecision` {AUTO_APPROVED,MANUAL_REVIEW,REJECTED} vía `RiskThreshold`, que es dato configurable por política versionada | `scoring/domain/` | ✅ Confirmado |
| `CirculoReport` + credits/inquiries/employments/addresses/scores persistidos completos, con FICO y comportamiento mes a mes | `scoring/domain/` | ✅ Confirmado |
| Ningún endpoint expone el reporte de buró; `scoring` solo publica el score final | `ScoreEvaluationController` | ❌ Hueco |
| `PENDING_DOCUMENTS` existe en el enum y en el javadoc; **ninguna línea lo asigna** | `ApplicationStatus` | ❌ Hueco |
| El monto separa `UNDER_MANUAL_REVIEW` de `COMMITTEE_REVIEW` | `OriginationProperties` | ✅ Confirmado |
| `AuditEntry` no tiene ningún campo de actor: solo `partyId` (el sujeto) | `audit/domain/` | ❌ Hueco |
| `identity.login-attempted` se publica con GeoLocation y desenlace; audit **no lo consume** | `AuthService` / listeners | ⚠️ Se pierde |
| `StaffAuthService` no publica ningún evento | `identity/application/` | ❌ Hueco |
| Los 3 tópicos de `party` se publican y audit no escucha ninguno | `party` / listeners | ⚠️ Se pierde |
| No existe ninguna entidad de sucursal, zona o región en todo el repositorio | búsqueda global | ❌ Hueco |
| La matriz RBAC está escrita en Java y duplicada en el front | `SecurityConfig` / `nav.ts` | ⚠️ Rígida |
| `configuration-service` es un almacén de parámetros con aprobación a cuatro ojos, no RBAC | `ConfigParameter` | ✅ Confirmado |
| `scoring-service:compileTestJava` roto desde antes de este trabajo | `ScoringEvaluationService` | ⚠️ Preexistente |

---

## Decisiones de diseño, con lo que descarté

Cinco decisiones sostienen el plan. Las cinco son discutibles; si alguna no convence, cambia el
alcance de un entregable entero.

### 1 · La estructura comercial va en un servicio nuevo, no en `party-service`

**Descartado:** añadir `org_unit_id` a `party` y resolver la jerarquía ahí. Es tentador porque la
asignación de ejecutivo ya vive en party.

**Por qué no:** party es el maestro de *personas y empresas* —clientes, avales, distribuidores— y su
ciclo de vida lo gobiernan KYC y cumplimiento. La estructura comercial es del *lado de la empresa*:
cambia por reorganizaciones, tiene su propio historial y sus propias reglas de vigencia. Meterlas en
el mismo agregado hace que una reorganización comercial toque la tabla que audita CNBV, y que
cumplimiento y comercial se bloqueen mutuamente en cada despliegue.

**Consecuencia a aceptar:** `party.assigned_executive_id` queda duplicado durante la migración.
Propongo que `sales-org` sea la fuente de verdad y party conserve el campo como *proyección*
alimentada por evento, para no romper a los consumidores actuales — marcado `@Deprecated` con fecha.

### 2 · Un rol comercial con alcance, no cuatro roles por nivel

**Descartado:** `BRANCH_MANAGER`, `ZONE_MANAGER`, `REGIONAL_MANAGER`, `NATIONAL_MANAGER`.

**Por qué no:** los cuatro tienen el mismo permiso —ver y reasignar su cartera— y lo único que cambia
es hasta dónde llega. Cuatro roles obligan a repetir cada regla cuatro veces en la matriz, y abrir un
nivel intermedio (una subdirección, un corporativo) obliga a tocar todo otra vez.

**Propuesta:** rol `COMMERCIAL_MANAGER` + adscripción del empleado a un nodo del árbol. El nivel se
deduce del nodo; el alcance es siempre «mi nodo y su subárbol». El nacional no es un caso especial:
es quien está adscrito a la raíz.

### 3 · Los permisos se resuelven en el BFF con caché invalidada por evento, no en el token

> **Cambio de opinión respecto de la propuesta anterior.**
> Mi primera propuesta fue meter los permisos en el JWT como claim `perms`. Funciona y evita
> llamadas, pero tiene dos costes que aquí pesan más: el token crece y viaja en cada petición, y
> sobre todo **un cambio de permisos tardaría hasta 15 minutos en aplicar** — que es exactamente lo
> que el módulo de Configuración promete hacer en el momento.

**Propuesta:** los roles siguen en el token (ya están, no se toca nada). El BFF mantiene la matriz
rol→permiso en memoria y la invalida con `identity.permissions-updated`. Sin llamada por petición,
token pequeño, y el cambio aplica en la siguiente petición en vez de en el siguiente refresh.

**A resolver:** el arranque en frío del BFF necesita cargar la matriz antes de aceptar tráfico. Si
identity no responde, hay que elegir entre arrancar denegando todo o no arrancar. **Recomiendo no
arrancar**: un BFF que deniega todo se ve igual que uno caído pero tarda más en diagnosticarse.

### 4 · La auditoría sale de un filtro, no de llamadas en cada servicio

**Descartado:** que cada caso de uso llame a un `AuditService`.

**Por qué no:** los rastros de auditoría no se pierden por diseño, se pierden por olvido — un
endpoint nuevo que nadie instrumentó. Un filtro en los dos BFF captura toda operación que cambia
estado sin que haga falta acordarse, y los eventos de dominio ya cubren el «qué pasó».

**Límite conocido:** el filtro registra la intención y el resultado HTTP, no el efecto de negocio.
Las dos fuentes son complementarias: el filtro dice «Ana llamó a reasignar y salió 200», el evento de
dominio dice «la cartera pasó de X a Y».

### 5 · Las asignaciones de cartera son append-only

**Descartado:** `UPDATE` sobre la fila de asignación.

**Por qué no:** la primera pregunta cuando una cartera se discute es «quién se la quitó a quién y
cuándo». Con `UPDATE` esa respuesta no existe y no se puede reconstruir. Insertar cuesta una columna
de vigencia y un índice parcial; perder el historial no se arregla después.

---

## Los seis entregables

Ordenados por dependencia. **E1, E2 y E3 no dependen de nada** y pueden ir en paralelo.

```
E1 ──> E6
E3 ──┐
     ├──> E5
E4 ──┘
E2 (independiente)
```

---

### E1 · Solicitud y buró expuestos

> Solo lectura. No hay dominio nuevo que construir.

**Por qué:** el analista tiene que poder revisar una aprobación automática. Hoy ve el veredicto pero
no la evidencia — ni las cuentas del buró ni qué regla disparó el riesgo. Una pantalla que dice
«riesgo MEDIO» sin decir por qué no permite revisar nada, que es lo único que esa pantalla existe
para hacer.

**scoring-service**

- `GET /api/v1/scoring/reports/by-prospect/{prospectId}` — el `CirculoReport` más reciente con sus
  colecciones. Por cada cuenta: `nombreOtorgante`, `tipoCredito`, `fechaApertura`, `saldoActual`,
  `limiteCredito`, `creditoMaximo`, `saldoVencido`, `numeroPagosVencidos`, `pagoActual`,
  `historicoPagos`, `clavePrevencion`.
- Agregados **calculados en la consulta**, no en el BFF: cuentas abiertas, deuda total, saldo vencido
  total, peor atraso histórico, consultas en los últimos 6 meses.
- `/evaluations/{prospectId}/latest` debe incluir `ruleDetails`: qué regla, con qué valor, cuánto
  sumó o restó.

**origination-service**

- Verificar que `GET /applications/{id}` devuelva `approvalFlow`, `riskLevel`, `decidedBy`,
  `rejectionReason`.
- Añadir historial de transiciones de estado con marca de tiempo y actor. Sin él no se puede
  responder «cuánto tardó en pasar de solicitud a desembolso», que es la métrica que va a pedir
  negocio en cuanto vea la pantalla.

**channel-backoffice-service**

- `GET /origination/applications/{id}` — compone solicitud + evaluación + buró + documentos
  (`audit` ya expone `/parties/{partyId}/documents`). **Es una entidad única: el fan-out está
  permitido y es el patrón correcto.**
- `GET /origination/applications` con filtros por `status`, `riskLevel`, `approvalFlow`, rango de
  fecha y de monto. `decidedBy` resuelto a nombre **en lote**.
- Las bandejas se separan por estatus: automáticas (`APPROVED` con `approvalFlow=AUTOMATIC`),
  revisión manual, comité y rechazadas.

> **⚠️ Dato personal sensible.** El reporte de buró es de lo más sensible del sistema. Dos cosas no
> negociables: que el acceso quede auditado con actor (depende de E2 — conviene que E1 y E2 salgan
> juntos), y que un `COLABORADOR_EMPRESARIAL` —empleado de un distribuidor— **no reciba estos
> campos**. El recorte se hace como proyección en el BFF: el dato no debe salir del dominio, no basta
> con ocultarlo en la pantalla.

---

### E2 · Auditoría total con actor

> Ampliación. El servicio ya existe y funciona.
> **Alcance decidido:** escritura, **lectura** y **consumo de servicios**. Ver más abajo.

**Por qué:** hoy se registra qué pasó y sobre quién, nunca quién lo provocó. Las preguntas «a dónde
están entrando mis usuarios» y «quién consultó el buró de este cliente» no tienen respuesta. Además
hay eventos que ya se publican y nadie escucha, así que parte de esto es conectar cables.

#### 🔴 Lo que NUNCA se guarda

Esto no es negociable y va antes que el esquema, porque condiciona el filtro que captura los eventos.

| Se guarda | No se guarda, jamás |
|---|---|
| `actor_id`, correo o usuario | **La contraseña**, en claro, cifrada o hasheada |
| IP, user-agent, geolocalización | El token completo (`Authorization`) |
| Desenlace: `SUCCESS`, `FAILED_CREDENTIALS`, `ACCOUNT_LOCKED` | Códigos OTP / TOTP |
| `jti` del token — identifica la sesión sin exponerla | CVV, NIP, respuestas de seguridad |
| Últimos 4 de CLABE o tarjeta | CLABE o tarjeta completas |

Guardar la credencial anularía el hasheo del login: la tabla de auditoría se convertiría en un
almacén de contraseñas en claro, y sería el hallazgo más grave de cualquier revisión CNBV o de
seguridad. Con `actor_id` + IP + desenlace se responde «quién entró, desde dónde, cuándo y si falló»
sin tener nunca el secreto.

**Implementación:** el filtro debe llevar una lista negra de campos (`password`, `pin`, `otp`,
`token`, `authorization`, `secret`, `cvv`, `curp` según canal) que se enmascaran **antes** de
serializar el payload. Lista negra en un solo sitio, aplicada por defecto, y una prueba que falle si
un payload de auditoría contiene alguno de esos campos. Confiar en que cada controlador se acuerde de
limpiar es cómo terminan las contraseñas en los logs.

#### Dos tablas, no una

Auditar también lecturas y llamadas a servicios multiplica el volumen entre 20 y 50 veces: una
pantalla que carga puede disparar 5 llamadas al BFF y 15 a servicios de dominio. Meter eso en la
misma tabla que los hechos de negocio tiene dos problemas: el volumen degrada las consultas que
importan, y **no se puede purgar lo barato sin tocar lo que hay que conservar por regulación**.

| Tabla | Qué contiene | Volumen | Retención |
|---|---|---|---|
| `audit.audit_entries` | Hechos de negocio, autenticación y **lecturas sensibles** (buró, CURP/RFC, documentos, KYC) | Bajo | Larga — definir con cumplimiento; por omisión 10 años |
| `audit.access_log` | Navegación, lecturas ordinarias y consumo de servicios aguas abajo | Alto | 180 días en Postgres, luego archivo frío |

Las dos se exponen por **un solo endpoint**: quien consulta no tiene por qué saber que son dos.

```sql
-- ── Hechos que se conservan ──────────────────────────────────────────────
ALTER TABLE audit.audit_entries
  ADD COLUMN category    VARCHAR(24) NOT NULL DEFAULT 'BUSINESS',
             -- BUSINESS | AUTH | SENSITIVE_READ
  ADD COLUMN actor_id    VARCHAR(64),
  ADD COLUMN actor_type  VARCHAR(16),   -- STAFF | CUSTOMER | DISTRIBUTOR | SERVICE | SYSTEM
  ADD COLUMN actor_name  VARCHAR(200),
  ADD COLUMN channel     VARCHAR(16),   -- BACKOFFICE | MOBILE | SERVICE
  ADD COLUMN ip_address  INET,          -- tipo nativo: permite consultar por subred
  ADD COLUMN user_agent  VARCHAR(400),
  ADD COLUMN session_jti VARCHAR(64);   -- identifica la sesión sin exponer el token

CREATE INDEX idx_audit_actor_time  ON audit.audit_entries (actor_id,   created_at DESC);
CREATE INDEX idx_audit_type_time   ON audit.audit_entries (actor_type, created_at DESC);
CREATE INDEX idx_audit_party_time  ON audit.audit_entries (party_id,   created_at DESC);
CREATE INDEX idx_audit_cat_time    ON audit.audit_entries (category,   created_at DESC);

-- ── Bitácora de acceso: alto volumen, particionada por mes ───────────────
CREATE TABLE audit.access_log (
  entry_id        UUID         NOT NULL,
  created_at      TIMESTAMPTZ  NOT NULL,
  actor_id        VARCHAR(64),
  actor_type      VARCHAR(16),
  actor_name      VARCHAR(200),
  channel         VARCHAR(16),
  ip_address      INET,
  user_agent      VARCHAR(400),
  session_jti     VARCHAR(64),
  -- la petición del navegador
  http_method     VARCHAR(8)   NOT NULL,
  route           VARCHAR(300) NOT NULL,   -- plantilla, no la URL con ids
  route_params    JSONB,
  status_code     SMALLINT     NOT NULL,
  duration_ms     INTEGER,
  -- "si visita una pantalla, qué servicios consume"
  downstream      JSONB,   -- [{service, method, path, status, ms}]
  correlation_id  VARCHAR(64),
  PRIMARY KEY (entry_id, created_at)      -- Postgres exige la clave de partición en la PK
) PARTITION BY RANGE (created_at);

CREATE INDEX idx_access_actor_time ON audit.access_log (actor_id, created_at DESC);
CREATE INDEX idx_access_route_time ON audit.access_log (route,    created_at DESC);
CREATE INDEX idx_access_ip_time    ON audit.access_log (ip_address, created_at DESC);
```

**`route` guarda la plantilla, no la URL.** `/clients/{id}` y no `/clients/9f3a…`: el id va en
`route_params`. Si no, el índice por ruta es inútil —cada valor es único— y no se puede responder
«cuántas veces se abrió la ficha de cliente esta semana».

**`downstream` es la respuesta directa a lo que pediste.** El filtro del BFF ya sabe qué servicios
llamó para resolver la petición, así que registrarlo no cuesta una consulta extra: sale de la
instrumentación del `WebClient`.

#### Particiones y purga

- Una partición mensual de `access_log`, creada por adelantado con 3 meses de holgura (un job
  mensual, o `pg_partman`). Que la partición del mes que entra no exista es la forma clásica de que
  la auditoría deje de escribir a medianoche del día 1.
- La purga es `DROP TABLE` de la partición vencida, **no `DELETE`**. Instantáneo y sin vacuum; un
  `DELETE` de decenas de millones de filas bloquea la tabla y deja el espacio sin devolver.
- Antes de soltar la partición, exportarla a almacenamiento frío en Parquet o JSON comprimido. Si no
  hay destino frío definido, **subir la retención en vez de perder los datos**: se puede recortar
  después, recuperarlos no.

> **⚠️ Confirmar con cumplimiento.** Los 10 años son un valor por omisión razonable para operaciones
> de crédito, no una cita de la norma. `retention_days` va en configuración, no compilado, para que
> ajustarlo no requiera desplegar.

#### Listeners que faltan

- `identity.login-attempted` — **ya se publica con geolocalización y desenlace.**
- `party.fiscal-profile-updated`, `party.party-blacklisted` y el de KYC.
- Los de wallet, collections y commission.

#### Emisores nuevos

- `StaffAuthService` publica `identity.staff-login-attempted` con el mismo contrato que ya usa el
  login de cliente. Reutilizar el contrato, no inventar otro.
- Filtro en `channel-backoffice-service` y `channel-mobile-service`. **Una sola pieza que clasifica**,
  no dos:

| Qué intercepta | Categoría | Destino |
|---|---|---|
| `POST` / `PUT` / `DELETE` | `BUSINESS` | `audit_entries` |
| Login, refresh, logout, cambio de contraseña o de rol | `AUTH` | `audit_entries` |
| `GET` sobre buró, documentos, KYC, CURP/RFC | `SENSITIVE_READ` | `audit_entries` |
| Cualquier otro `GET` | `ACCESS` | `access_log` |

La clasificación se declara con una anotación sobre el controlador o un patrón de ruta, en un solo
lugar. Que sea el filtro quien decide —y no cada endpoint— es lo que hace que un endpoint nuevo entre
auditado por omisión en vez de quedar fuera por olvido.

- **Publicación asíncrona.** El filtro publica a Kafka sin bloquear la respuesta. Si auditoría se cae,
  la consola sigue funcionando; con escritura síncrona, un problema del registro tumba la operación.
  La contrapartida es que un evento puede perderse si el proceso muere entre responder y publicar:
  para `BUSINESS` y `AUTH` eso no es aceptable, así que esos van con confirmación del broker
  (`acks=all`); `ACCESS` puede ir en el modo barato.

#### Consulta

- `GET /api/v1/audit/entries` con filtros por `actorId`, `actorType`, `channel`, `partyId`,
  `eventType`, `category`, `route`, `ipAddress` y rango de fechas. Paginado **en la base**.
  Consulta las dos tablas y devuelve una sola línea de tiempo.
- `GET /api/v1/audit/actors/{actorId}/timeline` — todo lo que hizo una persona, ordenado. Es la
  consulta que de verdad se usa en una investigación, y merece su propia ruta en vez de obligar a
  armar cinco filtros.
- `GET /api/v1/audit/parties/{partyId}/access` — quién ha consultado a este cliente. La que pide el
  cliente cuando ejerce sus derechos ARCO.

---

### E3 · `sales-org-service` — servicio nuevo

> El grueso del trabajo.

**Por qué un servicio:** es lo único que de verdad no tiene dónde vivir. Sostiene dos cosas —la
estructura territorial y la asignación de cartera con su historial— que hoy no existen y que van a
ser consultadas por el tablero en cada carga, así que necesitan sus propios agregados y su propio
ciclo de despliegue.

**Modelo**

```sql
-- ── Los niveles son DATOS, no un enum ────────────────────────────────────
-- Decidido: la profundidad no queda fija. El caso de uso de hoy son cuatro niveles, pero abrir
-- una subdirección o un corporativo no puede exigir una migración de código.
org_levels(
  level_id     UUID PK,
  ordinal      SMALLINT NOT NULL UNIQUE,   -- 100 = raíz; mayor ordinal = más abajo
  code         VARCHAR(32) NOT NULL UNIQUE,
  name         VARCHAR(100) NOT NULL,
  name_plural  VARCHAR(100) NOT NULL,      -- el front rotula sin traducir códigos
  created_at   TIMESTAMPTZ NOT NULL
)

-- Siembra inicial, con huecos deliberados:
--   100 NACIONAL · 200 REGION · 300 ZONA · 400 SUCURSAL
-- Los saltos de 100 permiten insertar un nivel intermedio (250 = SUBDIRECCION) sin renumerar
-- nada ni re-parentar el árbol existente. Con ordinales 1,2,3,4 cada inserción intermedia
-- sería una migración de toda la tabla.

-- Árbol territorial. Autorreferenciado; la forma la valida el nivel, no una lista fija.
org_units(
  org_unit_id  UUID PK,
  parent_id    UUID FK -> org_units NULL,
  level_id     UUID NOT NULL FK -> org_levels,
  code         VARCHAR(32) NOT NULL UNIQUE,   -- lo que la gente teclea y recuerda
  name         VARCHAR(200) NOT NULL,
  status       VARCHAR(16) NOT NULL,          -- ACTIVE | INACTIVE
  path         LTREE,                         -- ruta materializada, ver nota
  created_at   TIMESTAMPTZ NOT NULL
)

-- Adscripción del empleado a un nodo, con vigencia.
staff_assignments(
  assignment_id  UUID PK,
  staff_user_id  UUID NOT NULL,
  org_unit_id    UUID NOT NULL FK,
  role           VARCHAR(32) NOT NULL,   -- EXECUTIVE | COMMERCIAL_MANAGER
  valid_from     TIMESTAMPTZ NOT NULL,
  valid_to       TIMESTAMPTZ NULL        -- NULL = vigente
)

-- Quién lleva a qué cliente. APPEND-ONLY: reasignar inserta, nunca actualiza.
portfolio_assignments(
  assignment_id          UUID PK,
  party_id               UUID NOT NULL,
  executive_staff_id     UUID NOT NULL,
  org_unit_id            UUID NOT NULL,
  previous_executive_id  UUID NULL,
  assigned_at            TIMESTAMPTZ NOT NULL,
  assigned_by            UUID NOT NULL,
  reason                 VARCHAR(300),
  valid_to               TIMESTAMPTZ NULL
)

-- Agregados denormalizados por nodo, mantenidos por evento.
org_unit_rollup(
  org_unit_id  UUID PK FK,
  clients      BIGINT,
  accounts     BIGINT,
  principal    NUMERIC(18,2),
  overdue      NUMERIC(18,2),
  provision    NUMERIC(18,2),
  updated_at   TIMESTAMPTZ
)
```

**Invariantes del árbol**

Escritas contra `ordinal`, no contra nombres. Así siguen valiendo cuando se agregue un nivel:

- Existe exactamente **un** nodo en el `ordinal` mínimo y **no tiene padre**. Es la raíz, se llame
  como se llame.
- Para todo nodo con padre: `parent.ordinal` es el **ordinal inmediatamente anterior** existente en
  `org_levels`. No se pueden saltar niveles — una sucursal no cuelga de una región.
- Sin ciclos. Un nodo no puede ser su propio ancestro. Con `path` materializada se comprueba en la
  inserción sin recorrer el árbol.
- Profundidad máxima **8 niveles**. No es una limitación del caso de uso —hoy son cuatro— sino un
  tope contra un árbol patológico que haga que la consulta recursiva se dispare.
- Un empleado tiene como mucho **una** adscripción vigente. Índice único parcial sobre
  `(staff_user_id) WHERE valid_to IS NULL`.
- Un cliente tiene como mucho **una** asignación vigente. Mismo patrón.
- Un nodo con hijos activos o cartera asignada no se puede desactivar.

**Sobre `path` (`LTREE`)**

La ruta materializada —`nacional.norte.monterrey.suc_centro`— hace que «todo lo que cuelga de este
nodo» sea un índice GiST en vez de una recursión, y es lo que sostiene el filtro de alcance que se
aplica en **cada** consulta del tablero comercial. `WITH RECURSIVE` sigue sirviendo para pintar el
árbol; `path` es para filtrar.

El coste: mover un nodo obliga a reescribir la `path` de todo su subárbol. Es una operación rara —una
reorganización— y va en transacción con un `UPDATE` sobre `path <@ old_path`. Vale la pena pagarlo
ahí y no en cada carga del tablero.

**Gestión de niveles**

- `GET/POST /api/v1/sales-org/levels` — alta y consulta. Solo ADMIN.
- Insertar un nivel intermedio **no re-parenta nada por sí solo**: crea el nivel y deja el árbol
  como estaba hasta que alguien mueva nodos a propósito. Un endpoint que reorganice el árbol solo
  porque se creó un nivel es la clase de automatismo que nadie puede deshacer.
- Un nivel con unidades asociadas no se puede borrar.

**Endpoints**

- `GET /units/{id}/subtree` — nodo y descendientes en **una** consulta `WITH RECURSIVE`. Nunca N
  llamadas.
- `GET /units/{id}/rollup?depth=1` — agregados del nodo más sus hijos directos. **Un nivel por
  petición**, no el árbol completo: es lo que hace que el tablero cargue en milisegundos y lo que
  evita mandar la organización entera por la red para pintar cuatro tarjetas.
- `GET /portfolio/history?partyId=` — el historial completo de una cartera.
- `GET /staff/{id}/scope` — el subárbol que alcanza un empleado. Lo consume el BFF para acotar el
  tablero.

#### Reasignación de cartera

**Qué es:** mover clientes de un ejecutivo a otro. Individual —un cliente— o **masiva**: un ejecutivo
renuncia y sus 400 clientes se reparten, o una sucursal se cierra y su cartera pasa a otra. Ese
segundo caso es el que decide la forma de la API, porque son miles de filas más recalcular los
rollups de los nodos afectados.

**Decidido: asíncrona con job de progreso.** La individual sigue siendo síncrona —un cliente es una
fila y esperar un job para eso sería absurdo—; la masiva devuelve `202` con un identificador.

```sql
reassignment_jobs(
  job_id           UUID PK,
  requested_by     UUID        NOT NULL,
  idempotency_key  VARCHAR(64) NOT NULL UNIQUE,
  selection        JSONB       NOT NULL,   -- criterio: {fromExecutiveId} | {orgUnitId} | {partyIds}
  target_executive_id  UUID,
  target_org_unit_id   UUID,               -- reparto entre los ejecutivos de un nodo
  strategy         VARCHAR(24) NOT NULL,   -- TO_EXECUTIVE | ROUND_ROBIN_IN_UNIT
  reason           VARCHAR(300),
  status           VARCHAR(16) NOT NULL,   -- QUEUED|RUNNING|COMPLETED|PARTIAL|FAILED|CANCELLED
  total            INTEGER     NOT NULL,   -- calculado ANTES de arrancar
  processed        INTEGER     NOT NULL DEFAULT 0,
  failed           INTEGER     NOT NULL DEFAULT 0,
  created_at, started_at, finished_at TIMESTAMPTZ,
  error_summary    TEXT
)

reassignment_job_items(
  job_id       UUID NOT NULL FK,
  party_id     UUID NOT NULL,
  status       VARCHAR(16) NOT NULL,   -- PENDING | DONE | FAILED
  error        VARCHAR(400),
  processed_at TIMESTAMPTZ,
  PRIMARY KEY (job_id, party_id)
)
```

**Endpoints**

- `POST /portfolio/reassign` — un solo cliente. Síncrono, `200`.
- `POST /portfolio/reassign/bulk` — `202 {jobId, total}`. Requiere cabecera `Idempotency-Key`.
- `GET /portfolio/reassign/jobs/{jobId}` — `{status, total, processed, failed, startedAt, eta}`.
- `GET /portfolio/reassign/jobs/{jobId}/items?status=FAILED` — qué no se movió y por qué.
- `POST /portfolio/reassign/jobs/{jobId}/cancel` — solo en `QUEUED` o `RUNNING`. Lo ya movido **no se
  revierte**: se marca `CANCELLED` con el avance real. Deshacer una reasignación es otra
  reasignación, no un rollback, y fingir lo contrario oculta que la cartera ya se movió.

**Cuatro cosas que definen si el job es utilizable**

1. **`total` se calcula síncronamente** con un `COUNT` antes de encolar. Sin él la pantalla solo puede
   mostrar un spinner indefinido en vez de una barra real, y quien la mira no sabe si son 40 filas o
   40 000.
2. **Lotes con commit propio** (500 filas). Un fallo en la fila 3 800 no puede tirar las 3 799
   anteriores: el job es reanudable y el estado parcial es un resultado válido.
3. **`PARTIAL` es un desenlace de primera clase**, no un error disfrazado de éxito. Si 20 clientes no
   se pudieron mover porque otro proceso los reasignó en paralelo, eso se ve en la pantalla con la
   lista de cuáles.
4. **`Idempotency-Key` obligatoria.** Un doble clic o un reintento del navegador sobre «reasignar la
   sucursal entera» no puede ejecutar el movimiento dos veces.

Los rollups afectados se recalculan **al cerrar el job**, no por fila: mil filas no pueden disparar
mil recálculos del mismo nodo.

**Consumo de eventos**

Escucha `credit-portfolio.*` para mantener `org_unit_rollup` al día. Un rollup que recalcule desde
cero en cada carga no aguanta la cartera real: es el caso clásico de agregado sobre todas las filas,
y va resuelto con denormalización mantenida por evento.

**Migración de lo existente**

`party.assigned_executive_id` es la asignación actual. Importarla como la primera fila de
`portfolio_assignments`. Los ejecutivos sin sucursal conocida cuelgan de un nodo `SIN_ASIGNAR` creado
a propósito — visible y molesto, para que se corrija, en vez de repartirlos con una heurística que
nadie podrá auditar después.

> **❓ Decisión que te corresponde — reasignación masiva.** ¿Síncrona o job? Mover la cartera de una
> sucursal entera pueden ser miles de filas más la recalculación de dos rollups. Si es síncrona, hay
> que acotar el tamaño y devolver 413 por encima; si es un job, hace falta estado de progreso y la
> pantalla cambia. Yo empezaría síncrono con tope y mediría antes de construir el job.

---

### E4 · Permisos configurables

> Ampliación de `identity-service`.

**Por qué en identity:** ya es dueño de los roles y quien firma el token. Un servicio de autorización
aparte obligaría a una llamada por petición o a la misma caché que propongo, pero repartiendo en dos
sitios una responsabilidad que hoy está en uno.

- `permissions(code, module, description)` y `role_permissions(role, permission_code)` como datos.
- **La siembra inicial debe reproducir exactamente la matriz de `SecurityConfig.java`.** Este
  entregable mueve dónde vive la regla; no debe cambiar ni un permiso. Si al terminar el harness RBAC
  no sigue en verde sin tocarlo, algo se movió.
- `GET/PUT /api/v1/identity/roles/{role}/permissions`, solo ADMIN, auditado.
- Publica `identity.permissions-updated`.
- `channel-backoffice-service` mantiene la matriz en memoria, la invalida con ese evento, y sustituye
  los `hasAnyRole(...)` por comprobación de permiso. `denyAll` por defecto se queda.

> **Lo que la API debe exponer para que la consola no mienta.** Con la caché invalidada por evento, un
> cambio de permisos aplica en la siguiente petición. Lo que **no** cambia es la sesión ya emitida:
> los roles siguen en el token, así que quitarle un *rol* a alguien sigue tardando hasta 15 minutos.
> Permiso y rol tienen latencias distintas y la respuesta de la API debe decirlo, para que la
> pantalla lo comunique en vez de prometer un corte que no ocurre.

---

### E5 · Dashboard con alcance

> Depende de E3 y E4.

**Por qué:** hoy `/dashboard/**` es `.authenticated()`, así que el gestor de cobranza y el de
marketing ven capital, mora y provisión **por persona** del equipo comercial. Es información de
desempeño individual y no les corresponde.

- `GET /dashboard/summary` — panorama general, cualquier empleado. **Deja de devolver `byExecutive`.**
- `GET /dashboard/commercial?unitId=` — desglose por unidad y por ejecutivo, para roles comerciales
  y `ADMIN`, **acotado al subárbol del solicitante** resuelto contra `sales-org`. Devuelve el rollup
  del nodo pedido más sus hijos directos.
- Si `unitId` cae fuera del alcance: **403**, no una lista vacía. Un 200 vacío es indistinguible de
  «esa zona no tiene cartera» y filtra la forma de la organización.

**Alcance por nivel**

| Nivel | Ve | Puede reasignar |
|---|---|---|
| Ejecutivo | Su propia cartera | Nada |
| Gerente de sucursal | Los ejecutivos de su sucursal | Entre ejecutivos de su sucursal |
| Gerente de zona | Sus sucursales, consolidadas y al detalle | Entre sucursales de su zona |
| Regional | Sus zonas, consolidadas y al detalle | Entre zonas de su región |
| Nacional | Todo | Todo |
| **ADMIN** | **Todo** — decidido: conserva visibilidad completa | Todo |

**`ADMIN` conserva la regla vigente.** No hay excepción que programar: `hasAnyRole()` ya le concede
alcance total en el BFF y en el front, y se queda como está. El único trabajo aquí es que el
resolutor de alcance devuelva la raíz del árbol para `ADMIN` en lugar de buscar su adscripción, que
no tiene — un administrador no está adscrito a ninguna sucursal.

> **Lo que sí cambia para todos los demás.** `/dashboard/summary` deja de devolver `byExecutive`. Hoy
> el gestor de cobranza y el de marketing ven capital, mora y provisión **por persona** del equipo
> comercial, y eso es lo que se corta. `ADMIN` y los roles comerciales lo siguen viendo por
> `/dashboard/commercial`.

---

### E6 · `PENDING_DOCUMENTS` operativo

> Depende de E1. El más pequeño.

**Por qué:** hoy un analista con un comprobante ilegible solo puede aprobar o rechazar. Rechazar por
una foto borrosa es un cliente perdido por un motivo que no es crediticio.

- Transición `UNDER_MANUAL_REVIEW → PENDING_DOCUMENTS` con lista de documentos requeridos y motivo
  por documento.
- Regreso `PENDING_DOCUMENTS → UNDER_MANUAL_REVIEW` cuando se sube lo que faltaba.
- Evento `origination.documents-requested` para que notifications avise al cliente.
- Expuesto en el BFF con los mismos roles que la decisión de underwriting.
- Definir el TTL: una solicitud esperando documentos no puede quedarse ahí para siempre. Sugiero
  reutilizar el mecanismo de `OFFER_EXPIRED` en vez de inventar otro.

---

## Criterios de aceptación

No hace falta inventarlos: `fintech-backoffice-web/tools/e2e/` tiene 75 comprobaciones por curl y 15
de navegador, todas en verde contra el entorno actual. Cubren el journey completo del crédito
—solicitud, scoring, autorización, contrato, desembolso, devengo, pagos, liquidación— y la matriz
RBAC desde los dos lados: que la ruta responda a quien tiene el rol **y que devuelva 403 a quien no**.

| Entregable | Se da por terminado cuando |
|---|---|
| **E1** | El BFF devuelve solicitud + score con `ruleDetails` + buró + documentos en una respuesta, y un `COLABORADOR_EMPRESARIAL` no recibe los campos sensibles. |
| **E2** | Un login de empleado y una reasignación aparecen en `/audit/entries` filtrando por `actorId`, con IP y canal; abrir la ficha de un cliente deja traza en `access_log` con los servicios que consumió; y **una prueba falla si algún payload de auditoría contiene `password`, `otp` o `token`**. |
| **E3** | El rollup de una región coincide con la suma de sus zonas; el historial responde «quién reasignó esta cartera y cuándo»; un job masivo cancelado a la mitad reporta `PARTIAL` con el avance real; y **crear un quinto nivel no requiere tocar código**. |
| **E4** | **El harness RBAC sigue en verde sin tocarlo**, y quitar un permiso por API cambia la respuesta en la siguiente petición. |
| **E5** | Un gerente de zona ve sus sucursales; pedir otra zona a mano devuelve 403; ADMIN recibe 403 en `/dashboard/commercial`. |
| **E6** | Una solicitud vuelve a revisión tras subir el documento faltante, y el cliente recibe la notificación. |

### Convenciones

- Un commit por entregable, compilando y con pruebas en verde.
- Liquibase: un changeset por cambio, nunca editar uno ya aplicado.
- Endpoints nuevos documentados con OpenAPI, con la matriz de roles explícita.
- Al cerrar cada entregable: qué endpoints quedaron, con qué contrato exacto y qué roles los pueden
  llamar. Con eso se conecta el front sin ida y vuelta.

### Fuera de alcance

- `scoring-service:compileTestJava` está roto desde antes de este trabajo (`ScoringEvaluationService`
  cambió de firma y su prueba no). **No arreglarlo aquí**; mencionarlo si estorba.
- Los distribuidores como rol de party (`party_roles` según I-03) son un trabajo aparte, ya
  identificado y no incluido.
- Aprobación a cuatro ojos para cambios de permisos. El mecanismo existe en `configuration-service` y
  se puede añadir después; meterlo ahora duplica el alcance de E4.

---

## Decisiones resueltas

Las cuatro preguntas abiertas quedaron cerradas. Se dejan aquí con su efecto, porque cada una cambió
el diseño de un entregable.

| Pregunta | Decisión | Efecto |
|---|---|---|
| **Alcance de la auditoría** | Escritura, lectura **y** consumo de servicios: qué pantalla se visitó, qué servicios consumió, con qué IP y qué usuario | E2 pasa de una tabla a dos, con particionado mensual y purga por `DROP PARTITION`. La contraseña **no se guarda nunca** — ver la tabla de campos prohibidos |
| **Reasignación masiva** | Asíncrona con job de progreso | E3 suma `reassignment_jobs`, endpoints `202` + consulta de avance, `Idempotency-Key` y `PARTIAL` como desenlace válido |
| **Profundidad del árbol** | Configurable, no fija. Hoy son cuatro niveles (nacional → región → zona → sucursal) pero se pueden crear los que hagan falta | `level` deja de ser enum y pasa a `org_levels` con ordinales espaciados de 100 en 100. Invariantes escritas contra `ordinal`, tope de 8 niveles |
| **ADMIN en el tablero comercial** | Ve todo. Se conserva la regla vigente | E5 se simplifica: no hay excepción que programar. Solo se corta `byExecutive` de `/dashboard/summary` para los roles no comerciales |

### Lo que estas decisiones agregan al esfuerzo

- **E2 crece.** Auditar lecturas y llamadas aguas abajo multiplica el volumen entre 20 y 50 veces
  respecto de auditar solo escrituras. Eso obliga al particionado y al archivo frío desde el día uno,
  no como optimización posterior.
- **E3 crece.** El job de reasignación es un subsistema con su propio estado, su reanudación y su
  pantalla de progreso.
- **E5 se encoge.** Sin la excepción de `ADMIN`, es el entregable más pequeño de los tres que
  dependen de otros.

### Sigue abierto

- **Retención concreta.** Los 10 años para hechos de negocio y 180 días para la bitácora de acceso son
  valores por omisión razonables, no una cita de la norma. Confirmar con cumplimiento y dejarlos en
  configuración, no compilados.
- **Destino del archivo frío.** Si no hay uno definido cuando se implemente la purga, **subir la
  retención en lugar de borrar**: recortar después es fácil, recuperar lo borrado no.
- **¿ADMIN puede reasignar, o solo ver?** El plan asume que sí puede, por ser el rol de último
  recurso. Si debe ser solo lectura, es una línea en la matriz de permisos de E4.

---

## Anexo — El flujo de solicitud, para referencia

El mapeo riesgo → decisión → estatus está implementado tal cual:

| Riesgo | Decisión del motor | Estatus | Qué hace la pantalla |
|---|---|---|---|
| **BAJO** | `AUTO_APPROVED` | `APPROVED` | Consulta. Nadie la tocó; se revisa a posteriori. |
| **MEDIO** | `MANUAL_REVIEW` | `UNDER_MANUAL_REVIEW` / `COMMITTEE_REVIEW` | **Decisión.** Espera a una persona. |
| **ALTO** | `REJECTED` | `REJECTED` | Consulta. Terminal, con el motivo a la vista (CONDUSEF). |

```
DRAFT → PENDING_SCORING → SCORING
                             ├─ BAJO  → APPROVED
                             ├─ MEDIO → UNDER_MANUAL_REVIEW   (monto normal)
                             │        → COMMITTEE_REVIEW       (monto alto)
                             └─ ALTO  → REJECTED  (terminal)

APPROVED → OFFER_PRESENTED → OFFER_ACCEPTED → PENDING_SIGNATURE
         → CONTRACT_SIGNED → DISBURSED (terminal)
```

Dos matices que cambian el alcance de la pantalla:

- **`PENDING_DOCUMENTS` no ocurre nunca hoy.** Está en el enum y en el javadoc, pero ninguna línea lo
  asigna. El caso «documento ilegible» es E6, no una conexión.
- **La revisión manual se parte en dos por monto**, con dos roles distintos (`UNDERWRITER` y
  `COMMITTEE`). La pantalla tiene que separarlas o el comité verá trabajo que no le toca.
