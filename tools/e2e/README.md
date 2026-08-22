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
persista y que el contraste aguante en ambos).

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
