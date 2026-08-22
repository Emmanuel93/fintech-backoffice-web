# mfe-products — Producto  ·  `:5104`

Dos pantallas: **Productos y tasas** (qué se cobra) y **Políticas de scoring** (a quién se le
presta).

## Qué consume

`/products[/{id}]` · `PUT /products/{id}/activate|retire` · `/scoring/policies` ·
`/scoring/rule-types` · `POST /scoring/policies`

## Decisiones

**Separadas porque son dos preguntas de gobierno distintas.** El catálogo se compara por tasa y
plazo; las políticas, por qué queda cubierto y qué no. Pero viven en el mismo módulo porque un
producto sin política se autoriza sólo contra su score mínimo, sin mirar el buró — y eso no se nota
hasta que se aprueban solicitudes que no debían. Por eso crear un producto encadena el alta de su
política.

**Las políticas no se esconden dentro de cada producto.** Desde la ficha sólo se ve la de ese
producto, y la pregunta de gobierno —cuáles existen y qué queda sin cubrir— no se contesta abriendo
productos uno por uno.

**Leer el catálogo es abierto; publicar exige `products.manage`.** Cartera y clientes lo consultan
para resolver nombres y tasas. Cambiar un umbral cambia a quién se le presta, igual que cambiar la
tasa.
