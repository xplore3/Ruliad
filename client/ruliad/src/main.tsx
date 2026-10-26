import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import './index.css';
import Layout from './components/Layout';
import Home from './pages/Home';
import Sessions from './pages/Sessions';
import Discover from './pages/Discover';
import Profile from './pages/Profile';
import Dashboard from './pages/Dashboard';
import Build from './pages/Build';
import ScenarioDetail from './pages/ScenarioDetail';
import Practice from './pages/Practice';
import Review from './pages/Review';
import Call from './pages/Call';
import Admin from './pages/Admin';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        {/* 主框架：顶部栏 + 底部 Tab + 内容区 */}
        <Route element={<Layout />}>
          <Route path="/" element={<Navigate to="/home" replace />} />
          <Route path="/home" element={<Home />} />
          <Route path="/sessions" element={<Sessions />} />
          <Route path="/discover" element={<Discover />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/build" element={<Build />} />
          <Route path="/scenario/:id" element={<ScenarioDetail />} />
          <Route path="/admin" element={<Admin />} />
        </Route>

        {/* 全屏沉浸页面（无顶部栏、无底部 Tab） */}
        <Route path="/practice/:sessionId" element={<Practice />} />
        <Route path="/practice/new" element={<Practice />} />
        <Route path="/review/:sessionId" element={<Review />} />
        <Route path="/call" element={<Call />} />

        <Route path="*" element={<Navigate to="/home" replace />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
