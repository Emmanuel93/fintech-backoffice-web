import { lazy, type ComponentType } from 'react';
import { registerRemotes, loadRemote } from '@module-federation/runtime';

// The providers this consumer loads at runtime. Edit `entry` to point at a
// different URL (`remoteEntry.js` is what every supported bundler emits at dev
// + build time). `name` is the provider build's federation container name and
// must match the provider's federation `name`; `alias` is the key you pass to
// loadRemote()/lazyProvider().
const PROVIDERS: Array<{ alias: string; name: string; entry: string }> = [
  {
    alias: 'mfe-applications',
    name: 'mfe_applications',
    entry: 'http://localhost:5105/remoteEntry.js',
  },
  {
    alias: 'mfe-dashboard',
    name: 'mfe_dashboard',
    entry: 'http://localhost:5101/remoteEntry.js',
  },
  {
    alias: 'mfe-portfolio',
    name: 'mfe_portfolio',
    entry: 'http://localhost:5102/remoteEntry.js',
  },
  {
    alias: 'mfe-clients',
    name: 'mfe_clients',
    entry: 'http://localhost:5103/remoteEntry.js',
  },
  {
    alias: 'mfe-products',
    name: 'mfe_products',
    entry: 'http://localhost:5104/remoteEntry.js',
  },
  {
    alias: 'mfe-salesorg',
    name: 'mfe_salesorg',
    entry: 'http://localhost:5106/remoteEntry.js',
  },
  {
    alias: 'mfe-audit',
    name: 'mfe_audit',
    entry: 'http://localhost:5107/remoteEntry.js',
  },
  {
    alias: 'mfe-rbac',
    name: 'mfe_rbac',
    entry: 'http://localhost:5108/remoteEntry.js',
  },
  {
    alias: 'mfe-collections',
    name: 'mfe_collections',
    entry: 'http://localhost:5109/remoteEntry.js',
  },
  {
    alias: 'mfe-accounting',
    name: 'mfe_accounting',
    entry: 'http://localhost:5110/remoteEntry.js',
  },
];

// `type: 'module'` is required because the providers in this workspace are
// vite-built and emit ESM remoteEntry.js. The federation runtime would load
// it as a classic `<script>` tag otherwise and the browser would throw
// `Cannot use import statement outside a module` (#RUNTIME-001).
registerRemotes(PROVIDERS.map((remote) => ({ ...remote, type: 'module' })));

export function lazyProvider<Props = unknown>(
  alias: string,
  exposeName: string,
) {
  return lazy(async () => {
    const mod = await loadRemote<{ default: ComponentType<Props> }>(
      `${alias}/${exposeName}`,
    );
    return { default: mod!.default };
  });
}
