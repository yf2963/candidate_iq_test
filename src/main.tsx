import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './index.css';
import App from './pages/App';
import AdminPage from './pages/AdminPage';
import CandidatePage from './pages/CandidatePage';
import LoginPage from './pages/LoginPage';

const router = createBrowserRouter([
  { path: '/', element: <App /> },
  { path: '/login', element: <LoginPage /> },
  { path: '/admin', element: <AdminPage /> },
  { path: '/test/:token', element: <CandidatePage /> },
  { path: '*', element: <Navigate to="/" replace /> },
]);

const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById('app')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>
);
