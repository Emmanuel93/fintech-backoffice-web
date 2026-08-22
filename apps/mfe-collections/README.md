# mfe-collections — Cobranza  ·  `:5109`

Cinco pantallas: **Bandeja de casos**, **Promesas de pago**, **Contacto y gestión**, **Convenios
por autorizar** y **Reportes a buró**.

## Qué consume

`/collections/cases[/{id}]` · `/agreements/awaiting-authorization` ·
`PUT /agreements/{id}/{accept,reject,authorize}` · `/cases/{id}/{contact-attempts,payment-promises,agreements,request-write-off,write-offs}` ·
`/bureau-reports` · `/config` · `/dashboard/stats?groupBy=dpdBucket`

## Decisiones

**La bandeja se pagina en el servidor.** La alternativa —listar cuentas morosas desde cartera y
preguntarle a cobranza el caso de cada renglón— es una llamada por fila, y se degrada justo cuando
la mora crece, que es cuando la pantalla importa.

**El saldo en mora lo agrega la base.** Se derivaba de las 25 filas de la página con una nota que lo
advertía; la nota no basta, porque un número grande en una tarjeta se transcribe a una junta sin
leer el pie.

**Los tramos del agregado y los del caso no son los mismos.** `credit-portfolio` agrupa en cinco
escalones (`CURRENT`, `1-30`, `31-60`, `61-90`, `90+`) y `collections` maneja siete, porque a partir
de los 90 días la estrategia cambia tres veces. `TRAMO_FILTRO` traduce entre las dos escalas, y por
eso «Más de 90 días» filtra por días mínimos y no por bucket.

**Pulsar un tramo mueve también los campos del filtro.** Si sólo cambiara la consulta, el formulario
diría una cosa y la tabla otra, y el siguiente «Buscar» desharía en silencio lo elegido.

**Los límites se piden al arrancar para deshabilitar con la razón a la vista.** Un 422 llega cuando
el gestor ya redactó la promesa.

**Reestructuras y quitas comparten bandeja:** las separa el tipo, no el flujo, y quien firma revisa
las dos en la misma sesión.

**Promesas y gestiones cruzan casos; capturarlas no.** Sólo se veían abriendo un caso, así que «qué
vence hoy» exigía abrirlos uno por uno. La consulta transversal la resuelve `collections` con su
índice. Pero **registrar** una promesa o una gestión sigue haciéndose desde el caso, que es donde
están los topes contra los que se valida.

**La ventana de contacto viene con la respuesta, no de la pantalla.** Es una regla —de qué hora a
qué hora se puede llamar y cuántos intentos caben al día—, no una sugerencia visual. Por eso la
tabla de promesas dice **por qué** no se puede llamar ahora en vez de dejar intentar: un 422 llega
cuando el gestor ya redactó la gestión.

**Una promesa no cambia el tramo ni libera estimación.** Suspende la escalada mientras esté
vigente; al romperse, el caso retoma la estrategia que le tocaba por días de atraso. Por eso el
tramo se muestra al lado del estado y no en su lugar.
