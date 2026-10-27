import { StrictMode } from 'react';
import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import './index.css';
import { isTokenValid } from './api';
import Layout from './components/Layout';
import Home from './pages/Home';
import Profile from './pages/Profile';
import Dashboard from './pages/Dashboard';
import Build from './pages/Build';
import ScenarioDetail from './pages/ScenarioDetail';
import Practice from './pages/Practice';
import Review from './pages/Review';
import Call from './pages/Call';
import Login from './pages/Login';
import Settings from './pages/Settings';

function RequireAuth({ children }: { children: ReactNode }) {
  if (!isTokenValid()) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        {/* 主框架：顶部栏 + 底部 Tab + 内容区 */}
        <Route
          element={
            <RequireAuth>
              <Layout />
            </RequireAuth>
          }
        >
          <Route path="/" element={<Navigate to="/home" replace />} />
          <Route path="/home" element={<Home />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/build" element={<Build />} />
          <Route path="/scenario/:id" element={<ScenarioDetail />} />
          <Route path="/settings" element={<Settings />} />
        </Route>

        {/* 全屏沉浸页面（无顶部栏、无底部 Tab） */}
        <Route path="/login" element={<Login />} />
        <Route
          path="/practice/:sessionId"
          element={
            <RequireAuth>
              <Practice />
            </RequireAuth>
          }
        />
        <Route
          path="/review/:sessionId"
          element={
            <RequireAuth>
              <Review />
            </RequireAuth>
          }
        />
        <Route
          path="/call"
          element={
            <RequireAuth>
              <Call />
            </RequireAuth>
          }
        />

        <Route path="*" element={<Navigate to="/home" replace />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
