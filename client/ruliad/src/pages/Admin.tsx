import { useState } from 'react';

type AdminTab = 'teachers' | 'students' | 'classes' | 'ai';

const TABS: { key: AdminTab; label: string }[] = [
  { key: 'teachers', label: '老师管理' },
  { key: 'students', label: '学生管理' },
  { key: 'classes', label: '班级管理' },
  { key: 'ai', label: 'AI 管理' },
];

export default function Admin() {
  const [activeTab, setActiveTab] = useState<AdminTab>('teachers');

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-ink">业务管理</h1>
          <p className="text-sm text-ink-secondary mt-1">管理平台教师、学生、班级与 AI 资源配置</p>
        </div>
      </div>

      {/* Tab 切换 */}
      <div className="flex gap-1 mb-6 bg-white rounded-xl p-1 border border-gray-100 w-fit">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
              activeTab === tab.key
                ? 'bg-coral text-white shadow-md shadow-coral/25'
                : 'text-ink-secondary hover:bg-gray-50 hover:text-ink'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* 内容区 */}
      {activeTab === 'teachers' && <TeachersPanel />}
      {activeTab === 'students' && <StudentsPanel />}
      {activeTab === 'classes' && <ClassesPanel />}
      {activeTab === 'ai' && <AIManagePanel />}
    </div>
  );
}

// ====== 老师管理 ======

const MOCK_TEACHERS = [
  { id: 't-001', name: '李明华', phone: '138****1234', email: 'liminghua@example.com', subject: '销售技巧', students: 24, status: 'active' as const, joinedAt: '2026-08-15' },
  { id: 't-002', name: '张薇', phone: '139****5678', email: 'zhangwei@example.com', subject: '谈判策略', students: 18, status: 'active' as const, joinedAt: '2026-09-02' },
  { id: 't-003', name: '王建国', phone: '137****9012', email: 'wangjg@example.com', subject: '客户关系', students: 31, status: 'active' as const, joinedAt: '2026-07-20' },
  { id: 't-004', name: '陈思琪', phone: '136****3456', email: 'chensq@example.com', subject: '产品知识', students: 0, status: 'inactive' as const, joinedAt: '2026-10-01' },
  { id: 't-005', name: '赵大伟', phone: '135****7890', email: 'zhaodw@example.com', subject: '异议处理', students: 15, status: 'active' as const, joinedAt: '2026-06-10' },
];

function TeachersPanel() {
  const [search, setSearch] = useState('');

  const filtered = MOCK_TEACHERS.filter(
    (t) => t.name.includes(search) || t.subject.includes(search)
  );

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-50 overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-50">
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-secondary" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索老师姓名/专长..."
            className="pl-9 pr-4 py-2 bg-warm-white rounded-full text-sm border border-transparent focus:border-coral/30 focus:outline-none transition-all w-72"
          />
        </div>
        <button className="px-5 py-2 bg-coral text-white rounded-full text-sm font-medium hover:bg-coral-hover transition-colors shadow-md shadow-coral/25">
          + 添加老师
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-warm-white/50 text-xs text-ink-secondary font-medium">
              <th className="text-left px-6 py-3 font-medium">姓名</th>
              <th className="text-left px-6 py-3 font-medium">联系方式</th>
              <th className="text-left px-6 py-3 font-medium">专长领域</th>
              <th className="text-center px-6 py-3 font-medium">学员数</th>
              <th className="text-center px-6 py-3 font-medium">状态</th>
              <th className="text-left px-6 py-3 font-medium">加入时间</th>
              <th className="text-right px-6 py-3 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((teacher) => (
              <tr key={teacher.id} className="border-t border-gray-50 hover:bg-warm-white/50 transition-colors">
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-cat-ground/20 to-cat-ground/10 flex items-center justify-center text-cat-ground font-semibold text-sm">
                      {teacher.name.charAt(0)}
                    </div>
                    <span className="font-medium text-ink text-sm">{teacher.name}</span>
                  </div>
                </td>
                <td className="px-6 py-4 text-sm text-ink-secondary">
                  <div>{teacher.phone}</div>
                  <div className="text-xs text-ink-secondary/60 mt-0.5">{teacher.email}</div>
                </td>
                <td className="px-6 py-4">
                  <span className="px-2.5 py-1 bg-coral/10 text-coral text-xs rounded-full font-medium">{teacher.subject}</span>
                </td>
                <td className="px-6 py-4 text-center font-din text-sm font-semibold text-ink">{teacher.students}</td>
                <td className="px-6 py-4 text-center">
                  <span className={`px-2.5 py-1 text-xs rounded-full font-medium ${teacher.status === 'active' ? 'bg-success/10 text-success' : 'bg-gray-100 text-ink-secondary'}`}>
                    {teacher.status === 'active' ? '在岗' : '未激活'}
                  </span>
                </td>
                <td className="px-6 py-4 text-sm text-ink-secondary">{teacher.joinedAt}</td>
                <td className="px-6 py-4 text-right">
                  <button className="text-xs text-ink-secondary hover:text-coral transition-colors mr-3">编辑</button>
                  <button className="text-xs text-ink-secondary hover:text-red-500 transition-colors">移除</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 分页 */}
      <div className="flex items-center justify-between px-6 py-4 border-t border-gray-50">
        <span className="text-xs text-ink-secondary">共 {filtered.length} 位老师</span>
        <div className="flex gap-1">
          <button className="px-3 py-1 text-xs rounded-lg bg-coral text-white">1</button>
        </div>
      </div>
    </div>
  );
}

// ====== 学生管理 ======

const MOCK_STUDENTS = [
  { id: 'st-001', name: '林小雨', phone: '150****1111', class: '销售精英1班', teacher: '李明华', sessions: 12, avgScore: 78, status: 'active' as const },
  { id: 'st-002', name: '周子轩', phone: '151****2222', class: '销售精英1班', teacher: '李明华', sessions: 8, avgScore: 65, status: 'active' as const },
  { id: 'st-003', name: '吴俊杰', phone: '152****3333', class: '谈判进阶班', teacher: '张薇', sessions: 5, avgScore: 72, status: 'active' as const },
  { id: 'st-004', name: '郑浩然', phone: '153****4444', class: '销售精英2班', teacher: '王建国', sessions: 15, avgScore: 88, status: 'active' as const },
  { id: 'st-005', name: '孙悦', phone: '154****5555', class: '异议处理班', teacher: '赵大伟', sessions: 3, avgScore: 0, status: 'inactive' as const },
  { id: 'st-006', name: '刘文博', phone: '155****6666', class: '销售精英2班', teacher: '王建国', sessions: 20, avgScore: 91, status: 'active' as const },
];

function StudentsPanel() {
  const [search, setSearch] = useState('');

  const filtered = MOCK_STUDENTS.filter(
    (s) => s.name.includes(search) || s.class.includes(search)
  );

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-50 overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-50">
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-secondary" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索学生姓名/班级..."
            className="pl-9 pr-4 py-2 bg-warm-white rounded-full text-sm border border-transparent focus:border-coral/30 focus:outline-none transition-all w-72"
          />
        </div>
        <div className="flex gap-2">
          <button className="px-4 py-2 bg-warm-white text-ink-secondary rounded-full text-sm font-medium hover:bg-gray-100 transition-colors border border-gray-100">
            批量导入
          </button>
          <button className="px-5 py-2 bg-coral text-white rounded-full text-sm font-medium hover:bg-coral-hover transition-colors shadow-md shadow-coral/25">
            + 添加学生
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-warm-white/50 text-xs text-ink-secondary font-medium">
              <th className="text-left px-6 py-3 font-medium">姓名</th>
              <th className="text-left px-6 py-3 font-medium">联系方式</th>
              <th className="text-left px-6 py-3 font-medium">所属班级</th>
              <th className="text-left px-6 py-3 font-medium">辅导老师</th>
              <th className="text-center px-6 py-3 font-medium">练习次数</th>
              <th className="text-center px-6 py-3 font-medium">平均分数</th>
              <th className="text-center px-6 py-3 font-medium">状态</th>
              <th className="text-right px-6 py-3 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((student) => (
              <tr key={student.id} className="border-t border-gray-50 hover:bg-warm-white/50 transition-colors">
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-gradient-to-br from-cat-ground/20 to-cat-ground/10 flex items-center justify-center text-cat-ground font-semibold text-sm">
                      {student.name.charAt(0)}
                    </div>
                    <span className="font-medium text-ink text-sm">{student.name}</span>
                  </div>
                </td>
                <td className="px-6 py-4 text-sm text-ink-secondary">{student.phone}</td>
                <td className="px-6 py-4">
                  <span className="px-2.5 py-1 bg-cat-ground/10 text-cat-ground text-xs rounded-full font-medium">{student.class}</span>
                </td>
                <td className="px-6 py-4 text-sm text-ink-secondary">{student.teacher}</td>
                <td className="px-6 py-4 text-center font-din text-sm font-semibold text-ink">{student.sessions}</td>
                <td className="px-6 py-4 text-center">
                  <span className={`font-din text-sm font-semibold ${student.avgScore >= 80 ? 'text-success' : student.avgScore >= 60 ? 'text-warning' : student.avgScore === 0 ? 'text-ink-secondary' : 'text-coral'}`}>
                    {student.avgScore === 0 ? '-' : student.avgScore}
                  </span>
                </td>
                <td className="px-6 py-4 text-center">
                  <span className={`px-2.5 py-1 text-xs rounded-full font-medium ${student.status === 'active' ? 'bg-success/10 text-success' : 'bg-gray-100 text-ink-secondary'}`}>
                    {student.status === 'active' ? '活跃' : '未激活'}
                  </span>
                </td>
                <td className="px-6 py-4 text-right">
                  <button className="text-xs text-ink-secondary hover:text-coral transition-colors mr-3">详情</button>
                  <button className="text-xs text-ink-secondary hover:text-coral transition-colors mr-3">编辑</button>
                  <button className="text-xs text-ink-secondary hover:text-red-500 transition-colors">移除</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between px-6 py-4 border-t border-gray-50">
        <span className="text-xs text-ink-secondary">共 {filtered.length} 名学生</span>
        <div className="flex gap-1">
          <button className="px-3 py-1 text-xs rounded-lg bg-coral text-white">1</button>
        </div>
      </div>
    </div>
  );
}

// ====== 班级管理 ======

const MOCK_CLASSES = [
  { id: 'c-001', name: '销售精英1班', teacher: '李明华', students: 24, startDate: '2026-09-01', endDate: '2026-12-01', status: 'active' as const, progress: 45 },
  { id: 'c-002', name: '销售精英2班', teacher: '王建国', students: 18, startDate: '2026-09-15', endDate: '2026-12-15', status: 'active' as const, progress: 30 },
  { id: 'c-003', name: '谈判进阶班', teacher: '张薇', students: 16, startDate: '2026-10-01', endDate: '2026-12-31', status: 'active' as const, progress: 15 },
  { id: 'c-004', name: '异议处理班', teacher: '赵大伟', students: 12, startDate: '2026-08-01', endDate: '2026-10-31', status: 'completed' as const, progress: 100 },
  { id: 'c-005', name: '新人训练营', teacher: '李明华', students: 30, startDate: '2026-11-01', endDate: '2027-01-31', status: 'upcoming' as const, progress: 0 },
];

function ClassesPanel() {
  const [search, setSearch] = useState('');

  const filtered = MOCK_CLASSES.filter(
    (c) => c.name.includes(search) || c.teacher.includes(search)
  );

  const getProgressColor = (p: number) => {
    if (p >= 80) return 'bg-success';
    if (p >= 40) return 'bg-cat-ground';
    if (p > 0) return 'bg-warning';
    return 'bg-gray-200';
  };

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-50 overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-50">
        <div className="relative">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-secondary" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索班级名称/老师..."
            className="pl-9 pr-4 py-2 bg-warm-white rounded-full text-sm border border-transparent focus:border-coral/30 focus:outline-none transition-all w-72"
          />
        </div>
        <button className="px-5 py-2 bg-coral text-white rounded-full text-sm font-medium hover:bg-coral-hover transition-colors shadow-md shadow-coral/25">
          + 创建班级
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="bg-warm-white/50 text-xs text-ink-secondary font-medium">
              <th className="text-left px-6 py-3 font-medium">班级名称</th>
              <th className="text-left px-6 py-3 font-medium">辅导老师</th>
              <th className="text-center px-6 py-3 font-medium">学员数</th>
              <th className="text-left px-6 py-3 font-medium">开课日期</th>
              <th className="text-left px-6 py-3 font-medium">结课日期</th>
              <th className="text-center px-6 py-3 font-medium">进度</th>
              <th className="text-center px-6 py-3 font-medium">状态</th>
              <th className="text-right px-6 py-3 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((cls) => (
              <tr key={cls.id} className="border-t border-gray-50 hover:bg-warm-white/50 transition-colors">
                <td className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-coral/15 to-coral/5 flex items-center justify-center">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FF6F61" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>
                    </div>
                    <span className="font-medium text-ink text-sm">{cls.name}</span>
                  </div>
                </td>
                <td className="px-6 py-4 text-sm text-ink-secondary">{cls.teacher}</td>
                <td className="px-6 py-4 text-center font-din text-sm font-semibold text-ink">{cls.students}</td>
                <td className="px-6 py-4 text-sm text-ink-secondary">{cls.startDate}</td>
                <td className="px-6 py-4 text-sm text-ink-secondary">{cls.endDate}</td>
                <td className="px-6 py-4">
                  <div className="flex items-center gap-2 justify-center">
                    <div className="w-20 h-1.5 bg-warm-white rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${getProgressColor(cls.progress)}`} style={{ width: `${cls.progress}%` }} />
                    </div>
                    <span className="text-xs font-din text-ink-secondary w-8 text-right">{cls.progress}%</span>
                  </div>
                </td>
                <td className="px-6 py-4 text-center">
                  <span className={`px-2.5 py-1 text-xs rounded-full font-medium ${
                    cls.status === 'active' ? 'bg-success/10 text-success' :
                    cls.status === 'completed' ? 'bg-cat-ground/10 text-cat-ground' :
                    'bg-ink-secondary/10 text-ink-secondary'
                  }`}>
                    {cls.status === 'active' ? '进行中' : cls.status === 'completed' ? '已结业' : '待开课'}
                  </span>
                </td>
                <td className="px-6 py-4 text-right">
                  <button className="text-xs text-ink-secondary hover:text-coral transition-colors mr-3">管理</button>
                  <button className="text-xs text-ink-secondary hover:text-coral transition-colors mr-3">编辑</button>
                  <button className="text-xs text-ink-secondary hover:text-red-500 transition-colors">删除</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between px-6 py-4 border-t border-gray-50">
        <span className="text-xs text-ink-secondary">共 {filtered.length} 个班级</span>
        <div className="flex gap-1">
          <button className="px-3 py-1 text-xs rounded-lg bg-coral text-white">1</button>
        </div>
      </div>
    </div>
  );
}

// ====== AI 管理 ======

const MOCK_AI_RESOURCES = [
  { id: 'ai-001', name: '销售对话引擎 v3.2', type: 'LLM' as const, provider: 'DeepSeek', model: 'deepseek-chat', status: 'active' as const, usageCount: 1280, costPerCall: 0.02 },
  { id: 'ai-002', name: '语音合成服务', type: 'TTS' as const, provider: '阿里云', model: 'cosyvoice-v2', status: 'active' as const, usageCount: 3450, costPerCall: 0.005 },
  { id: 'ai-003', name: '语音识别服务', type: 'ASR' as const, provider: '讯飞', model: 'iFlyTek Realtime', status: 'active' as const, usageCount: 2100, costPerCall: 0.003 },
  { id: 'ai-004', name: '情绪识别模型', type: 'NLP' as const, provider: '开源', model: 'Emotion-BERT-v2', status: 'active' as const, usageCount: 890, costPerCall: 0 },
  { id: 'ai-005', name: 'GPT-4o 备用', type: 'LLM' as const, provider: 'OpenAI', model: 'gpt-4o', status: 'inactive' as const, usageCount: 0, costPerCall: 0.03 },
];

const MOCK_AGENTS = [
  { id: 'ag-001', name: '销售场景 Agent', scenario: '首次电话邀约', aiResource: '销售对话引擎 v3.2', status: 'active' as const, version: 'v2.1' },
  { id: 'ag-002', name: '谈判专家 Agent', scenario: '价格异议化解', aiResource: '销售对话引擎 v3.2', status: 'active' as const, version: 'v1.8' },
  { id: 'ag-003', name: '破冰助手 Agent', scenario: '地推破冰', aiResource: 'GPT-4o 备用', status: 'inactive' as const, version: 'v1.2' },
];

function AIManagePanel() {
  const [subTab, setSubTab] = useState<'resources' | 'agents'>('resources');

  return (
    <div>
      {/* 子 Tab */}
      <div className="flex gap-2 mb-5">
        <button
          onClick={() => setSubTab('resources')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            subTab === 'resources' ? 'bg-coral/10 text-coral border border-coral/20' : 'border border-gray-100 text-ink-secondary hover:bg-gray-50'
          }`}
        >
          AI 资源
        </button>
        <button
          onClick={() => setSubTab('agents')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            subTab === 'agents' ? 'bg-coral/10 text-coral border border-coral/20' : 'border border-gray-100 text-ink-secondary hover:bg-gray-50'
          }`}
        >
          Agent 配置
        </button>
      </div>

      {subTab === 'resources' && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-50 overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-50">
            <h3 className="text-sm font-semibold text-ink">AI 资源列表</h3>
            <button className="px-5 py-2 bg-coral text-white rounded-full text-sm font-medium hover:bg-coral-hover transition-colors shadow-md shadow-coral/25">
              + 添加资源
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-warm-white/50 text-xs text-ink-secondary font-medium">
                  <th className="text-left px-6 py-3 font-medium">资源名称</th>
                  <th className="text-left px-6 py-3 font-medium">类型</th>
                  <th className="text-left px-6 py-3 font-medium">提供商</th>
                  <th className="text-left px-6 py-3 font-medium">模型</th>
                  <th className="text-center px-6 py-3 font-medium">调用量</th>
                  <th className="text-center px-6 py-3 font-medium">单价(¥)</th>
                  <th className="text-center px-6 py-3 font-medium">状态</th>
                  <th className="text-right px-6 py-3 font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {MOCK_AI_RESOURCES.map((res) => (
                  <tr key={res.id} className="border-t border-gray-50 hover:bg-warm-white/50 transition-colors">
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cat-inquiry/15 to-cat-inquiry/5 flex items-center justify-center">
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#5DC7A3" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/><line x1="8" y1="16" x2="8" y2="16"/><line x1="16" y1="16" x2="16" y2="16"/></svg>
                        </div>
                        <span className="font-medium text-ink text-sm">{res.name}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2.5 py-1 text-xs rounded-full font-medium ${
                        res.type === 'LLM' ? 'bg-coral/10 text-coral' :
                        res.type === 'TTS' ? 'bg-cat-ground/10 text-cat-ground' :
                        res.type === 'ASR' ? 'bg-cat-inquiry/10 text-cat-inquiry' :
                        'bg-cat-deal/10 text-cat-deal'
                      }`}>{res.type}</span>
                    </td>
                    <td className="px-6 py-4 text-sm text-ink-secondary">{res.provider}</td>
                    <td className="px-6 py-4 text-sm text-ink-secondary font-mono text-xs">{res.model}</td>
                    <td className="px-6 py-4 text-center font-din text-sm font-semibold text-ink">{res.usageCount.toLocaleString()}</td>
                    <td className="px-6 py-4 text-center font-din text-sm text-ink-secondary">{res.costPerCall.toFixed(3)}</td>
                    <td className="px-6 py-4 text-center">
                      <span className={`px-2.5 py-1 text-xs rounded-full font-medium ${res.status === 'active' ? 'bg-success/10 text-success' : 'bg-gray-100 text-ink-secondary'}`}>
                        {res.status === 'active' ? '启用' : '停用'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button className="text-xs text-ink-secondary hover:text-coral transition-colors mr-3">配置</button>
                      <button className="text-xs text-ink-secondary hover:text-red-500 transition-colors">停用</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {subTab === 'agents' && (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-50 overflow-hidden">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-50">
            <h3 className="text-sm font-semibold text-ink">Agent 配置</h3>
            <button className="px-5 py-2 bg-coral text-white rounded-full text-sm font-medium hover:bg-coral-hover transition-colors shadow-md shadow-coral/25">
              + 创建 Agent
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4 p-6">
            {MOCK_AGENTS.map((agent) => (
              <div key={agent.id} className={`rounded-2xl border p-5 transition-all hover:shadow-md ${agent.status === 'active' ? 'border-success/20 bg-success/5' : 'border-gray-100 bg-warm-white/30'}`}>
                <div className="flex items-start justify-between mb-4">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-coral to-coral-hover flex items-center justify-center text-white font-bold text-sm">
                    AI
                  </div>
                  <span className={`px-2.5 py-1 text-xs rounded-full font-medium ${agent.status === 'active' ? 'bg-success/10 text-success' : 'bg-gray-100 text-ink-secondary'}`}>
                    {agent.status === 'active' ? '运行中' : '已停用'}
                  </span>
                </div>
                <h4 className="font-semibold text-ink text-sm mb-1">{agent.name}</h4>
                <p className="text-xs text-ink-secondary mb-3">场景：{agent.scenario}</p>
                <div className="flex items-center justify-between text-xs text-ink-secondary">
                  <span>模型：{agent.aiResource}</span>
                  <span className="font-mono">{agent.version}</span>
                </div>
                <div className="flex gap-2 mt-4 pt-4 border-t border-gray-100">
                  <button className="flex-1 py-1.5 text-xs text-ink-secondary bg-warm-white rounded-lg hover:bg-gray-100 transition-colors">编辑</button>
                  <button className="flex-1 py-1.5 text-xs text-coral bg-coral/10 rounded-lg hover:bg-coral/20 transition-colors">试演</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
