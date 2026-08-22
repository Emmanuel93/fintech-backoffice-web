#!/usr/bin/env node
// Genera los tipos del BFF desde su OpenAPI.
//
// `@bo/shared-types` se escribió a mano y por eso arrastra deriva contra el
// contrato real: campos que el BFF ya manda y el front no conoce, y al revés.
// Esto lo vuelve derivado — el contrato es el OpenAPI, no una copia.
//
//   npm run types:gen                 # contra el gateway local
//   BO_API=http://otro npm run types:gen
import { writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

// El subdominio va en la URL, no en un header: `fetch` de Node prohíbe fijar
// `Host`, y sin él el gateway no sabe a qué BFF enrutar (responde 404). Es la
// misma URL que usa el navegador.
const API = process.env.BO_API ?? 'http://backoffice.localhost:8090';
const EMAIL = process.env.BO_EMAIL ?? 'admin@kredius.mx';
const PASSWORD = process.env.BO_PASSWORD ?? 'Backoffice#2026';
const OUT = 'libs/shared-types/src/generated.ts';

// El OpenAPI del BFF va autenticado, como todo lo demás detrás del gateway.
const login = await fetch(`${API}/auth/staff/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});
if (!login.ok) {
  console.error(`No se pudo iniciar sesión contra ${API}: ${login.status}`);
  console.error('¿Está levantado el entorno? → npm run env:up');
  process.exit(1);
}
const { accessToken } = await login.json();

const res = await fetch(`${API}/v3/api-docs`, {
  headers: { Authorization: `Bearer ${accessToken}` },
});
if (!res.ok) {
  console.error(`/v3/api-docs respondió ${res.status}`);
  process.exit(1);
}

mkdirSync('tmp', { recursive: true });
writeFileSync('tmp/bo-openapi.json', await res.text());

const dts = execFileSync('node_modules/.bin/openapi-typescript', ['tmp/bo-openapi.json'], {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});

writeFileSync(
  OUT,
  `// GENERADO — no editar a mano.
// Origen: ${API}/v3/api-docs · regenerar con \`npm run types:gen\`.
// Los tipos escritos a mano viven en index.ts y sólo cubren lo que el OpenAPI
// no describe (vistas compuestas que arma el front).

${dts}`,
);
console.log(`✓ ${OUT} — ${(dts.length / 1024).toFixed(0)} KB`);
