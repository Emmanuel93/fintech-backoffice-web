import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ensureThemeStyles } from '@bo/design-system';
import { App } from './App';

ensureThemeStyles();

const container = document.getElementById('root');
if (!container) throw new Error('#root element not found');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
