import type { ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { getStoredUser, getToken } from './api';
import Layout from './components/Layout';
import Login from './pages/Login';
import Appeals from './pages/Appeals';
import Personas from './pages/Personas';
import Scenarios from './pages/Scenarios';
import Paths from './pages/Paths';
import Supervisor from './pages/Supervisor';
import Executive from './pages/Executive';
import DataCenter from './pages/DataCenter';
import Exams from './pages/Exams';
import DataAssets from './pages/DataAssets';
import Pipeline from './pages/workshop/Pipeline';
import Rules from './pages/workshop/Rules';
import Regression from './pages/workshop/Regression';
import Observations from './pages/workshop/Observations';
import QuizQuestions from './pages/workshop/QuizQuestions';

/** 各角色的落地页（与 Login.tsx 的 homeOf 保持一致） */
function homeOf(role?: string): string {
  switch (role) {
    case 'supervisor':
      return '/supervisor';
    case 'executive':
      return '/executive';
    case 'admin':
    case 'platform':
      return '/appeals';
    default:
      return '/login';
  }
}

/** 登录守卫：无 token 时跳转登录页 */
function RequireAuth({ children }: { children: ReactNode }) {
  if (!getToken()) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

/** 角色守卫：role 不在 allow 内时跳回该角色的落地页；platform 角色全量放行 */
function RequireRole({ allow, children }: { allow: string[]; children: ReactNode }) {
  const role = getStoredUser()?.role;
  if (role !== 'platform' && (!role || !allow.includes(role))) {
    return <Navigate to={homeOf(role)} replace />;
  }
  return <>{children}</>;
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          element={
            <RequireAuth>
              <Layout />
            </RequireAuth>
          }
        >
          <Route path="/" element={<Navigate to={homeOf(getStoredUser()?.role)} replace />} />
          <Route
            path="/appeals"
            element={
              <RequireRole allow={['admin']}>
                <Appeals />
              </RequireRole>
            }
          />
          <Route
            path="/personas"
            element={
              <RequireRole allow={['admin']}>
                <Personas />
              </RequireRole>
            }
          />
          <Route
            path="/scenarios"
            element={
              <RequireRole allow={['admin']}>
                <Scenarios />
              </RequireRole>
            }
          />
          <Route
            path="/paths"
            element={
              <RequireRole allow={['admin']}>
                <Paths />
              </RequireRole>
            }
          />
          <Route
            path="/supervisor"
            element={
              <RequireRole allow={['supervisor']}>
                <Supervisor />
              </RequireRole>
            }
          />
          <Route
            path="/executive"
            element={
              <RequireRole allow={['executive']}>
                <Executive />
              </RequireRole>
            }
          />
          <Route
            path="/data-center"
            element={
              <RequireRole allow={['admin']}>
                <DataCenter />
              </RequireRole>
            }
          />
          <Route
            path="/exams-admin"
            element={
              <RequireRole allow={['admin']}>
                <Exams />
              </RequireRole>
            }
          />
          <Route
            path="/data-assets"
            element={
              <RequireRole allow={['admin']}>
                <DataAssets />
              </RequireRole>
            }
          />
          <Route
            path="/workshop/pipeline"
            element={
              <RequireRole allow={['admin']}>
                <Pipeline />
              </RequireRole>
            }
          />
          <Route
            path="/workshop/rules"
            element={
              <RequireRole allow={['admin']}>
                <Rules />
              </RequireRole>
            }
          />
          <Route
            path="/workshop/regression"
            element={
              <RequireRole allow={['admin']}>
                <Regression />
              </RequireRole>
            }
          />
          <Route
            path="/workshop/observations"
            element={
              <RequireRole allow={['admin']}>
                <Observations />
              </RequireRole>
            }
          />
          <Route
            path="/workshop/quiz-questions"
            element={
              <RequireRole allow={['admin']}>
                <QuizQuestions />
              </RequireRole>
            }
          />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
