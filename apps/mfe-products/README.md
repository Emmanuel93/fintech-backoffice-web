# mfe-products — Producto  ·  `:5104`

Dos pantallas: **Productos y tasas** (qué se cobra) y **Políticas de scoring** (a quién se le
presta).

## Qué consume

`/products[/{id}]` · `PUT /products/{id}/activate|retire` · `/scoring/policies` ·
`/scoring/rule-types` · `/scoring/no-history-requirements` · `POST /scoring/policies`

## Decisiones

**Separadas porque son dos preguntas de gobierno distintas.** El catálogo se compara por tasa y
plazo; las políticas, por qué queda cubierto y qué no. Pero viven en el mismo módulo porque un
producto sin política se autoriza sólo contra su score mínimo, sin mirar el buró — y eso no se nota
hasta que se aprueban solicitudes que no debían. Por eso crear un producto encadena el alta de su
política.

**Las políticas no se esconden dentro de cada producto.** Desde la ficha sólo se ve la de ese
producto, y la pregunta de gobierno —cuáles existen y qué queda sin cubrir— no se contesta abriendo
productos uno por uno.

**Quien no tiene historial en buró se decide en la política de su producto.** Se le asigna un
score —0 por defecto— que pasa por la misma matriz, y si cae en revisión se le pueden pedir datos
adicionales (constancia de estudios para un producto de estudiantes, un aval). El formulario dice
en qué banda cae mientras se edita y no deja guardar lo que el motor rechazaría: sin historial no
se aprueba en automático, y pedir datos a quien de todos modos se rechaza no lo revisaría nadie.

**Leer el catálogo es abierto; publicar exige `products.manage`.** Cartera y clientes lo consultan
para resolver nombres y tasas. Cambiar un umbral cambia a quién se le presta, igual que cambiar la
tasa.
