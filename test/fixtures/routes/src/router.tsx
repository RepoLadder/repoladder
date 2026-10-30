import { createBrowserRouter } from 'react-router-dom';
import Layout from './components/Layout';
import NotFound from './pages/NotFound';

const nav = [{ path: '/help', label: 'Help' }]; // a menu, not routes

export const router = createBrowserRouter([
  {
    path: '/admin',
    Component: Layout,
    children: [
      { index: true, lazy: () => import('./pages/Dashboard') },
      { path: 'team', lazy: async () => { const { default: Component } = await import('./pages/Team'); return { Component }; } },
      { path: '/about', element: <NotFound /> },
    ],
  },
  { path: '*', Component: NotFound },
]);
export { nav };
