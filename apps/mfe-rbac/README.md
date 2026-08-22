# mfe-rbac — Administración  ·  `:5108`

Tres pantallas con ruta propia: **Usuarios** (`/usuarios`), **Roles** (`/roles`) y **Permisos**
(`/permisos`).

## Qué consume

`/staff[/{id}]` · `PUT /staff/{id}/{roles,password,suspend,reactivate}` · `DELETE /staff/{id}` ·
`/permissions/{roles,capabilities,matrix}` · `PUT /permissions/roles/{code}/capabilities` ·
`/sales-org/{my-scope,units}` + `/units/{raíz}/scope` para la columna «Adscrito a»

## Decisiones

**Roles y Permisos son dos pantallas, no una con pestañas.** «Qué roles existen y quién los tiene»
se consulta al dar de alta a alguien; «qué puede hacer cada rol» al auditar o al conceder. Juntas
obligaban a entrar por una para llegar a la otra.

**Roles es una tabla, no una rejilla de tarjetas.** Las tarjetas se veían bien y no dejaban
comparar: para saber cuál de dos roles firma, o cuál tiene gente, había que leerlas una por una.

**La matriz coteja dos fuentes.** `roles` viene de identity —lo declarado— y `/permissions/matrix`
del BFF —lo que de verdad se comprueba—. Cuando no coinciden, la celda se marca: es la causa de un
botón que existe y responde 403, y de una pantalla escondida a quien sí puede entrar.

**«Adscrito a» sale en una llamada, no una por fila.** `scope` de la raíz devuelve las asignaciones
vigentes de todo el subárbol; preguntar por renglón serían sesenta y dos peticiones para pintar una
columna.

**Las capacidades se guardan como conjunto completo, no como altas sueltas.** Con operaciones
incrementales, dos personas editando el mismo rol acaban con la unión de sus dos intenciones.

> **Usuarios exige rol `ADMIN`**, no una capacidad: así lo gatea el BFF, e identity lo vuelve a
> comprobar con el token de quien pide. Suspender revoca las sesiones en identity, pero el gateway
> valida la firma localmente: el token que esa persona ya tiene sirve hasta 15 minutos más. Por eso
> la pantalla dice «suspendido» y no «revocado».
