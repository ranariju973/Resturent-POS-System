import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Manrope is a design token, so it ships with the bundle rather than via a CDN.
import '@fontsource/manrope/400.css';
import '@fontsource/manrope/500.css';
import '@fontsource/manrope/600.css';
import '@fontsource/manrope/700.css';
import '@fontsource/manrope/800.css';
import { App } from './App';
import { PosProvider } from './store';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PosProvider>
      <App />
    </PosProvider>
  </StrictMode>,
);
