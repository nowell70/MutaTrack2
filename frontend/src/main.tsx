import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { AuthProvider } from './context/AuthContext';
import { installAuthFetch } from './services/api';
import './index.css';

// Harus dipasang sebelum komponen mana pun memanggil fetch('/api/...').
installAuthFetch();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </React.StrictMode>
);
