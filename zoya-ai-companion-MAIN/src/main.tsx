import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import CompanionApp from './CompanionApp.tsx';
import './index.css';

const isCompanionWindow = new URLSearchParams(window.location.search).get('companion') === '1';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isCompanionWindow ? <CompanionApp /> : <App />}
  </StrictMode>,
);
