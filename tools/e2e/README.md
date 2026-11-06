# Pruebas end-to-end del backoffice

Dos suites que se complementan y no se sustituyen:

- **curl** (`0*.sh`) — comprueba el contrato: qué responde el BFF, con qué permisos, y si el
  crédito recorre su ciclo completo. Es lo que puede correr en CI sin navegador.
- **navegador** (`browser/*.spec.ts`) — comprueba que la consola *muestre* ese recorrido, con
  vídeo y traza de cada rol. Es lo que sirve para revisar el modelo de permisos con alguien más
  sin volver a ejecutarlo.

```bash
./run.sh                # todo
./run.sh --no-browser   # solo curl
./run.sh --browser      # solo navegador (el backend ya está sembrado)
```

Evidencia en `.artifacts/`: vídeos por prueba, trazas, el log de todas las llamadas HTTP y el
estado de la última corrida del journey.

## Los dos planos de llamadas

La distinción gobierna todo el harness y no es cosmética.

| | quién | por dónde | para qué |
|---|---|---|---|
| **Verificación** | la consola | gateway → BFF de backoffice | **afirmar** lo que se ve |
| **Simulación** | el cliente y los jobs | gateway → BFF móvil, y la red interna | **provocar** que algo pase |

Ninguna aserción sale del plano de simulación. Si una prueba comprobara un dato leyéndolo del
servicio de dominio, pasaría aunque el BFF no lo expusiera — que es justo el fallo que se busca.

Los servicios de dominio no publican puerto fuera de la red de Docker: esa es la garantía de que
el navegador no puede saltarse el BFF. Por eso `svc()` entra por un contenedor efímero en la
misma red en vez de por `localhost`.

## Qué cubre cada script

**`01-seed.sh`** — un empleado por rol y el catálogo. Un usuario por rol, no uno con todos: la
única forma de comprobar que un permiso *falta* es tener a alguien que no lo tenga. Es idempotente
(un 409 cuenta como éxito), porque un seed que exige base vacía deja de correrse.

**`02-rbac.sh`** — la matriz de permisos desde los dos lados. Que la ruta responda a quien tiene
el rol es la mitad fácil; que devuelva 403 a quien no lo tiene es la que se rompe en silencio al
añadir un endpoint y olvidar el matcher. Incluye que un token del canal móvil no abra la consola.

**`03-journey.sh`** — el ciclo completo:

```
solicitud → scoring → autorización → contrato → desembolso
         → consulta → devengo → pagos aplicados → liquidación → tablero
```

El backoffice solo interviene donde de verdad interviene: **autorizando**. Todo lo demás lo
provocan el cliente y los procesos batch, y la consola lo observa. El tiempo se mueve con los
endpoints `/internal/test-support` de charges y cartera; sin eso, ver un crédito devengar y
liquidarse tomaría meses reales.

**`browser/`** — `rbac.spec.ts` (un recorrido grabado por rol), `journey.spec.ts` (la cuenta en
cartera, su calendario, sus pagos y el tablero movido), `theme.spec.ts` (claro/oscuro, que
persista y que el contraste aguante en ambos), `regresion-estados-de-cuenta.spec.ts` (los estados de
cuenta desde el expediente de un cliente y de un distribuidor: la lista, «Ver» dentro de la ficha,
«Descargar» el PDF de statement-service con su nombre, tiempos de la lista y de la descarga, y que un
estado de otro titular conteste 404 aunque se pida a mano). Elige al cliente y al distribuidor por la
API —el primero con estados—, así que corre sobre cualquier siembra. `regresion-balanza-por-producto.spec.ts`
(la balanza del último mes cerrado, producto por producto: cada uno cuadra por sí mismo, «Institución» reúne el
fondeo y el capital, y las partes suman la balanza cuenta por cuenta; el esquema contable de cada producto suma sus
pares; en pantalla, el selector «Producto» filtra la balanza, trae el esquema y oculta la ecuación, que es de toda la
institución; con tiempos por balanza).

**`browser/regresion-*.spec.ts`** — los actos del video que arma el orquestador de
`fintech-services/tools/regresion-e2e`. Cada uno marca sus momentos con `historia(clave)` y señala
el dato con `senala()`. Los de la **demo completa** —`colocaciones`, `region`, `contabilidad`,
`tesoreria`, `iam`— siguen a la colocación por detrás: son de sólo lectura salvo `region`, que
asigna ejecutivo a la distribuidora y por eso sólo corre con `RE2E_DISTRIBUIDORA` explícita. Lo que
falte en los datos lo dejan como `##AVISO##` y siguen: un video entero no se tira por una póliza
que todavía no llegó.

## Detalles que explican el código

**Las esperas son `wait_for`, no `sleep`.** La cadena es asíncrona por Kafka: aprobar no activa la
cuenta en el mismo instante. Reintentar reconoce que el sistema es eventual; un `sleep` fijo largo
además hace la prueba lenta cuando todo va bien.

**El login reintenta ante un 429.** El gateway limita los intentos por minuto. Encadenar logins de
doce roles lo dispara, y ahí un 429 es la política funcionando, no un defecto.

**La matriz de roles está escrita dos veces**, en `02-rbac.sh` y en `browser/fixtures.ts`, y
ninguna importa de `nav.ts`. Si la importaran, cambiar los permisos cambiaría la prueba con ellos
y seguiría en verde.

**El navegador va al final.** Comprueba que la consola muestre lo que los pasos anteriores
crearon; correrlo primero probaría una pantalla vacía y pasaría sin haber verificado nada.

## Configuración

Por variable de entorno, con estos valores por defecto:

```
GATEWAY_HOST=localhost      GATEWAY_PORT=8090
BO_HOST=backoffice.localhost   MOBILE_HOST=mobile.localhost
DOCKER_NETWORK=fintech-services_fintech-network
ADMIN_EMAIL=admin@kredius.mx   ADMIN_PASSWORD / STAFF_PASSWORD=Backoffice#2026
BO_BASE_URL=http://localhost:4200
```

Requisitos: `curl`, `jq`, `docker`, y los contenedores arriba (`docker compose up -d` en
`fintech-services`). `run.sh` levanta los servidores de Vite si no los encuentra.
