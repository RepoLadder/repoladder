import { lazy } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Home, Settings } from './pages';
import Layout from '@/components/Layout';
import { Guard } from './components/Guard';
import { Billing } from './lazyPages';
import { SETTINGS_ROUTE, ROUTES } from './paths';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Profile = lazy(() => import('./pages/Profile'));
function Inline() { return null; }

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/old" element={<Navigate to="/" replace />} />
        <Route path={SETTINGS_ROUTE} element={<Guard><Settings /></Guard>} />
        <Route path={ROUTES.profile} element={<Profile />} />
        <Route path="/app" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="billing" element={<Guard><Billing /></Guard>}>
            <Route path=":invoiceId" lazy={() => import('./pages/Invoice')} />
          </Route>
          <Route element={<Guard><Layout /></Guard>}>
            <Route path="inline" element={<Inline />} />
          </Route>
        </Route>
        <Route path={`/computed/${1}`} element={<Home />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </BrowserRouter>
  );
}
