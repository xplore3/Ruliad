import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import './index.css';
import { getToken } from './api.ts';
import Layout from './components/Layout.tsx';
import Login from './pages/Login.tsx';
import Register from './pages/Register.tsx';
import Tasks from './pages/Tasks.tsx';
import Session from './pages/Session.tsx';
import Review from './pages/Review.tsx';
import Growth from './pages/Growth.tsx';
import Exams from './pages/Exams.tsx';

/** 登录守卫：无 token 时跳转登录页 */
function RequireAuth({ children }: { children: ReactNode }) {
  if (!getToken()) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/" element={<Navigate to="/tasks" replace />} />
        <Route
          element={
            <RequireAuth>
              <Layout />
            </RequireAuth>
          }
        >
          <Route path="/tasks" element={<Tasks />} />
          <Route path="/practice" element={<Tasks />} />
          <Route path="/exams" element={<Exams />} />
          <Route path="/growth" element={<Growth />} />
        </Route>
        <Route
          path="/session/:scenarioId"
          element={
            <RequireAuth>
              <Session />
            </RequireAuth>
          }
        />
        <Route
          path="/session/:id/review"
          element={
            <RequireAuth>
              <Review />
            </RequireAuth>
          }
        />
      </Routes>
    </BrowserRouter>
  </StrictMode>
);
