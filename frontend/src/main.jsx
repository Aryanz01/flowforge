// main.jsx — React 18 entry point.

import React from 'react';
import { createRoot } from 'react-dom/client';

import 'reactflow/dist/style.css';
import './theme.css';
import './nodes/nodes.css';

import App from './App.jsx';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
