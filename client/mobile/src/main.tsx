import { StrictMode, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import './index.css';
import { isTokenValid } from './api.ts';
import Layout from './components/Layout.tsx';
import Login from './pages/Login.tsx';
import Register from './pages/Register.tsx';
import Home from './pages/Home.tsx';
import PracticeList from './pages/PracticeList.tsx';
import Discover from './pages/Discover.tsx';
import Profile from './pages/Profile.tsx';
import RoleDetail from './pages/RoleDetail.tsx';
import ModeSelect from './pages/ModeSelect.tsx';
import TextSession from './pages/TextSession.tsx';
import VoiceSession from './pages/VoiceSession.tsx';
import VoiceCall from './pages/VoiceCall.tsx';
import EndConfirm from './pages/EndConfirm.tsx';
import ReportGenerating from './pages/ReportGenerating.tsx';
import Review from './pages/Review.tsx';
import RoleSpace from './pages/RoleSpace.tsx';
import RoleProfile from './pages/RoleProfile.tsx';
import RoleCustomize from './pages/RoleCustomize.tsx';
import MyAbility from './pages/MyAbility.tsx';
import MyConfig from './pages/MyConfig.tsx';
import DiscoverDetail from './pages/DiscoverDetail.tsx';
import Sandbox from './pages/Sandbox.tsx';
import MyAbilities from './pages/MyAbilities.tsx';
import AbilityDetail from './pages/AbilityDetail.tsx';
import About from './pages/About.tsx';

/** 鉴权守卫：token 不存在或已过期则跳转登录页 */
function RequireAuth({ children }: { children: ReactNode }) {
  if (!isTokenValid()) {
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

        {/* 四 Tab 主页 */}
        <Route element={<RequireAuth><Layout /></RequireAuth>}>
          <Route path="/" element={<Home />} />
          <Route path="/practice" element={<PracticeList />} />
          <Route path="/discover" element={<Discover />} />
          <Route path="/profile" element={<Profile />} />
        </Route>

        {/* 二级页面（无底部 Tab） */}
        <Route path="/role/:scenarioId" element={<RequireAuth><RoleDetail /></RequireAuth>} />
        <Route path="/mode/:scenarioId" element={<RequireAuth><ModeSelect /></RequireAuth>} />
        <Route path="/session/text/:sessionId" element={<RequireAuth><TextSession /></RequireAuth>} />
        <Route path="/session/voice/:sessionId" element={<RequireAuth><VoiceSession /></RequireAuth>} />
        <Route path="/session/call/:sessionId" element={<RequireAuth><VoiceCall /></RequireAuth>} />
        <Route path="/session/:sessionId/end" element={<RequireAuth><EndConfirm /></RequireAuth>} />
        <Route path="/session/:sessionId/report" element={<RequireAuth><ReportGenerating /></RequireAuth>} />
        <Route path="/session/:sessionId/review" element={<RequireAuth><Review /></RequireAuth>} />
        <Route path="/space/:scenarioId" element={<RequireAuth><RoleSpace /></RequireAuth>} />
        <Route path="/space/:scenarioId/profile" element={<RequireAuth><RoleProfile /></RequireAuth>} />
        <Route path="/space/:scenarioId/customize" element={<RequireAuth><RoleCustomize /></RequireAuth>} />
        <Route path="/space/:scenarioId/ability" element={<RequireAuth><MyAbility /></RequireAuth>} />
        <Route path="/space/:scenarioId/detail" element={<RequireAuth><AbilityDetail /></RequireAuth>} />
        <Route path="/space/:scenarioId/sandbox" element={<RequireAuth><Sandbox /></RequireAuth>} />
        <Route path="/config" element={<RequireAuth><MyConfig /></RequireAuth>} />
        <Route path="/my-abilities" element={<RequireAuth><MyAbilities /></RequireAuth>} />
        <Route path="/discover/:id" element={<RequireAuth><DiscoverDetail /></RequireAuth>} />
        <Route path="/about" element={<RequireAuth><About /></RequireAuth>} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>
);
