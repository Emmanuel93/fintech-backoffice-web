# mfe-salesorg — Estructura comercial  ·  `:5106`

La red entera en **una tabla** que se abre hacia abajo: región → zona → sucursal → ejecutivo →
cliente. Desde aquí se reasigna y se configura.

Dos pestañas, que son **dos atribuciones de la misma cartera**: por *ejecutivo actual* (el árbol) y
por *unidad de origen* (la colocación).

## Qué consume

`/sales-org/{levels,units,my-scope}` · `/units/{id}/{children,subtree,scope,assignments,parent}` ·
`/units/by-code/{code}/vat-rate` · `POST /sales-org/levels` ·
`/assignments/{tipo}/{id}[/history]` · `/dashboard/commercial?unitId=`

## Decisiones

**Una tabla y no dos paneles.** Eran la jerarquía a la izquierda y la cartera de lo seleccionado a
la derecha, y esa forma obligaba a dos lecturas para una sola pregunta: para saber de qué se componía
el número de una región había que elegirla, leer el total en el otro panel, elegir una zona, volver
a leer y sumar de cabeza. Ahora cada renglón lleva lo suyo y lo de todo lo que cuelga de él.

**Ver y mandar no es lo mismo.** Un auditor ve la red completa y no mueve una sola unidad; el aviso
de alcance lo dice antes de la tabla.

**El histórico de asignaciones no se borra.** Mover a alguien cierra la vigente y abre otra, así que
«dónde estaba en marzo» se puede contestar. «Sacar de la unidad» existe para bajas y licencias: deja
de contar en el árbol y su cartera pasa a la bolsa sin dueño, que es visible.

**Configurar la red vive detrás de un botón.** Insertar un escalón o fijar el IVA se hace una vez al
año; mover una sucursal, decenas de veces al mes. Mezclarlas en la misma tabla pondría lo raro y lo
peligroso al lado de lo cotidiano.

> **El IVA por unidad todavía no surte efecto.** Se guarda en la unidad, pero quien lo sella en el
> crédito es `credit-portfolio` al crearlo, y hoy originación no le resuelve la sucursal: cada
> crédito nace con el nacional. La pantalla lo advierte — una configuración que guarda y no aplica
> se descubre en un CFDI.

**Las dos atribuciones no tienen por qué coincidir, y la pantalla lo dice.** El árbol atribuye por
quién lleva la cartera hoy: si se reasigna, se mueve de rama. `by-origin-unit` atribuye por la
unidad que **colocó** el crédito, sellada al activarlo, que no se mueve nunca. Para pagar una
comisión o evaluar a una sucursal por lo que colocó, la buena es la segunda; para saber a quién
llamar hoy, la primera. Dos números distintos del mismo negocio, sin nada que los explique, se leen
como que uno está mal.

**La vista por origen se cuadra contra sí misma.** Cada cuenta se atribuye a una sola unidad de
origen, así que el total del subárbol es la suma exacta de sus ramas — a cualquier altura. Eso no
es cierto del árbol por ejecutivo, donde la cartera sin dueño queda fuera y por eso lleva su propio
aviso.
