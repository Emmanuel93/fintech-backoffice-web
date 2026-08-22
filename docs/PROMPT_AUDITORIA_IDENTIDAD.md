# Prompt para `fintech-services` — identidad completa en la bitácora de auditoría

> Pegar en un agente trabajando sobre el repo `fintech-services`.
> Redactado desde un diagnóstico hecho contra el entorno local con datos reales
> (2,615 entradas) el 2026-08-13.

---

## Contexto

La bitácora de auditoría registra el identificador del actor pero casi nunca su
nombre. Medido contra el entorno local:

- **1,509 de 2,615 entradas (57%) tienen `actor_name` y `actor_email` en `NULL`.**
- De 78 actores distintos, **sólo uno se resuelve**: el admin de arranque
  (`00000000-0000-4000-8000-000000000001`). Los 77 restantes, nunca.
- Desglose por rol: `ADMIN` 1,106 con nombre / 0 sin. `OPS_SUPERVISOR`,
  `CREDIT_ANALYST`, `EXECUTIVE`, `PRODUCT_MANAGER`, `COMMERCIAL_MANAGER`,
  `CUSTOMER`, `SUPPORT`: **0 con nombre**, 590 sin.

Se necesita que la bitácora identifique plenamente a quien actúa, por obligación
regulatoria de trazabilidad:

| Tipo de actor | Datos exigidos |
|---|---|
| Colaborador (personal de backoffice) | nombre, **CURP**, correo |
| Cliente / distribuidor | nombre, **CURP**, correo, **teléfono** |

## Objetivo

Que toda entrada nueva de auditoría —de cualquier canal— congele la identidad
completa del actor según la tabla de arriba.

---

## Causa raíz (ya diagnosticada, no hace falta re-investigar)

### 1. El resolutor de personal usa el token del propio usuario contra un endpoint ADMIN-only

`AccessAuditInterceptor:65` llama a `StaffIdentityResolver.resolve(actor, bearer)`,
que va a `IdentityClient:186` → `GET /api/v1/staff/{id}` **con el bearer del
usuario que está actuando**.

En `identity-service/.../config/SecurityConfig.java:43`:

```java
.requestMatchers("/api/v1/staff/**").hasRole("ADMIN")
```

Un ejecutivo pidiendo **su propio** nombre recibe 403. El resolutor atrapa el
error, cachea negativo 30s y degrada a `null` en silencio.

**Verificado en vivo**: login como `ejecutivo@kredius.mx` → `GET /staff/{id}` con
su token → **HTTP 403** → sus entradas quedan con `actorName=null`.

### 2. El interceptor móvil ni siquiera lo intenta

`channel-mobile-service/.../MobileAccessAuditInterceptor.java:87` pasa literales:

```java
actor, null, null, roles,   // ← actorEmail, actorName hardcodeados en null
```

No existe resolutor del lado móvil. **Ningún cliente tendrá nombre jamás.**
La línea 93 pasa `null` en la posición de `resourceId` (0 de 12 entradas móviles
con UUID en la ruta lo tienen; el backoffice: 189 de 189).

### 3. `audit-service` no enriquece al consultar

`AuditService:57` sólo persiste lo que recibe; `AuditEntryResponse` sólo lo
devuelve. **La identidad se resuelve al escribir o no se resuelve nunca.**
Como la bitácora es inmutable, las 1,509 entradas existentes **no son
recuperables** — el alcance es de aquí en adelante.

---

## Dónde vive cada dato (esto es lo que condiciona el diseño)

Investigado; hay huecos reales que obligan a decidir:

### Colaborador — `StaffUser` (identity-service)

```
staffUserId, email, fullName, employeeType, distributorPartyId,
roles, status, lastLoginAt, ...
```

✅ nombre y correo · ❌ **CURP no existe** · ❌ teléfono no existe

`employeeType` distingue interno de externo, y `distributorPartyId` enlaza al
colaborador externo con su distribuidor (un `Party`).

### Cliente — repartido en dos servicios

`Party` (party-service): `firstName`, `lastName1`, `lastName2`, **`curp`**,
`rfc`, `dateOfBirth`, `prospectId` — ❌ **sin correo ni teléfono**.

`Prospect` (origination-service): `firstName`, `lastName1`, `lastName2`,
`curp`, `rfc`, **`phone`**, **`email`** — enlazado por `Party.prospectId`.

Es decir: **nombre y CURP salen de party-service; correo y teléfono sólo existen
en origination-service**, alcanzables saltando por `Party.prospectId`.

### Distribuidor

`sales-org-service/.../DistributorController` sólo mapea `code → UUID`. La
identidad del distribuidor es un `Party` (vía `StaffUser.distributorPartyId`),
así que hereda la misma limitación: CURP sí, contacto no.

---

## Decisiones que hay que tomar (no asumir)

1. **CURP del colaborador interno: no existe en ningún lado.** Elegir entre
   (a) agregar la columna a `staff_users` + captura en el alta de personal, o
   (b) aceptar que sólo los colaboradores externos tengan CURP, resolviéndola por
   `distributorPartyId → Party.curp`. La opción (a) es la que cumple el requisito
   como está enunciado; implica migración en identity-service y tocar el alta.

2. **Contacto del cliente exige una segunda llamada** (party → origination).
   Decidir si se hace en cadena al escribir la auditoría —con su costo y su modo
   de fallo— o si se promueve `phone`/`email` a `party-service` como parte del
   perfil, que es donde conceptualmente pertenecen.

---

## Trabajo a realizar

### A. Resolución de identidad del personal

Que el BFF resuelva con **credenciales de servicio**, no con el token del usuario.
Auditar quién actuó no puede depender de los permisos del que actuó — ése es el
defecto de fondo, y arreglarlo con `hasRole` más laxo abre el directorio de
personal a todo el mundo.

Alternativa mínima aceptable si no hay mecanismo servicio-a-servicio: permitir
que cada quien lea **su propio** registro (`#id == authentication.principal`),
que es el único caso que el interceptor necesita.

### B. Resolutor de identidad de cliente/distribuidor

Nuevo resolutor análogo a `StaffIdentityResolver` (mismo patrón: caché con TTL,
caché negativo corto, nunca lanza, degrada a sólo el UUID) que resuelva
`partyId → nombre + CURP + correo + teléfono` según la cadena de arriba.
Usarlo en `MobileAccessAuditInterceptor` **y** en el del backoffice, porque el
backoffice también actúa sobre clientes.

### C. Esquema

Nueva migración Liquibase siguiendo exactamente el patrón de
`audit-service/src/main/resources/db/changelog/audit/008-add-actor-identity.sql`
(leerla antes: fija la semántica de *snapshot* que hay que preservar) y
registrarla en `db.changelog-audit.xml`.

Campos nuevos sobre `audit.audit_entries`: CURP y teléfono del actor. Evaluar si
el "sujeto" sobre el que se actúa necesita los suyos propios —hoy `party_id` está
en `NULL` en el 91% de las entradas— porque *quién actuó* y *sobre quién* son
preguntas distintas y la auditoría regulatoria suele exigir las dos.

Propagar los campos por toda la cadena: `AccessAuditCommand` → `AuditEntry.access()`
→ `AuditEntryResponse` / `AuditEntryDetailResponse` → `RecordAccessRequest` y los
`AccessLog` de ambos canales.

### D. Tres defectos colaterales, en el mismo camino

1. **`correlation_id` vacío en el 100% de las 2,615 entradas.**
   `MdcCorrelationFilter:30-36` genera el id cuando el cliente no lo manda y lo
   deja en MDC y en la **respuesta**; `AccessAuditInterceptor:87` lo lee de la
   **petición**. El valor existe (sale en los logs como `corrId`), se lee del lado
   equivocado. Arreglo: leerlo del MDC.

2. **`domain_source` mal etiquetado.** `AuditEntry.java:90` escribe
   `"channel-backoffice-service"` fijo para *toda* entrada de acceso, venga del
   canal que venga. Las 33 entradas móviles están atribuidas al backoffice.
   Arreglo: recibir el canal real.

3. **`resourceId` móvil siempre nulo** (`MobileAccessAuditInterceptor:93`).
   El backoffice ya lo extrae bien de la ruta; replicar esa lógica.

---

## Restricciones que no se pueden romper

- **Auditar nunca rompe ni retrasa la operación.** El envío es fire-and-forget en
  `afterCompletion` y toda resolución degrada a sólo-UUID ante fallo. Añadir
  llamadas de red al camino de resolución **no puede** cambiar eso: cachear, y
  que un fallo pierda el nombre, nunca el hecho.
- **Semántica de snapshot.** Los valores se congelan al escribir: si el correo o
  el teléfono cambian después, el registro conserva los de entonces. Está
  documentado en la migración 008 y es deliberado.
- **Sin backfill.** La bitácora es inmutable; no intentar rellenar lo existente.
- **PII.** Esto mete CURP, teléfono y correo en un registro inmutable y de larga
  retención. Va acompañado de: control de acceso sobre quién puede leer el detalle
  de auditoría, revisión de la política de retención, y verificar que
  `PayloadSanitizer` siga cubriendo lo que corresponde. Es una decisión de
  cumplimiento consciente, no un efecto colateral de este cambio.

## Verificación esperada

1. Login con un rol **no-ADMIN** (`ejecutivo@kredius.mx`), navegar, y comprobar
   que sus entradas nuevas traen nombre, CURP y correo.
2. Una acción desde el canal móvil con un cliente, y comprobar nombre, CURP,
   correo y teléfono, con `domain_source` diciendo el canal real.
3. `correlation_id` poblado en entradas nuevas.
4. Cortar identity-service y comprobar que la navegación **sigue funcionando** y
   la entrada se escribe con el UUID pelado.
5. Pruebas al nivel del repo: unitarias de los resolutores (incluido el camino de
   fallo), `WebMvcTest` de los interceptores y Testcontainers para la migración.

---

## Archivos de referencia

| Qué | Dónde |
|---|---|
| Interceptor backoffice | `channel-backoffice-service/.../adapter/in/api/AccessAuditInterceptor.java` |
| Resolutor de personal | `channel-backoffice-service/.../adapter/in/api/StaffIdentityResolver.java` |
| Cliente de identity | `channel-backoffice-service/.../adapter/out/client/IdentityClient.java:186` |
| Seguridad de staff | `identity-service/.../infrastructure/config/SecurityConfig.java:43` |
| Interceptor móvil | `channel-mobile-service/.../adapter/in/api/MobileAccessAuditInterceptor.java:87,93` |
| Filtro de correlación | `channel-backoffice-service/.../adapter/in/api/MdcCorrelationFilter.java` |
| Entidad de auditoría | `audit-service/.../domain/AuditEntry.java:90` |
| Comando de acceso | `audit-service/.../application/AccessAuditCommand.java` |
| Migración de referencia | `audit-service/src/main/resources/db/changelog/audit/008-add-actor-identity.sql` |
| Modelo de personal | `identity-service/.../domain/StaffUser.java` |
| Modelo de cliente | `party-service/.../domain/Party.java` |
| Contacto de cliente | `origination-service/.../Prospect.java` (phone, email) |
