// 主管看板：数据口径仅认证考核结果，练习明细对主管不可见。
// 设计稿 UI-Manager.png，数据来自 GET /supervisor/overview 与 /supervisor/members。
import { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import api from '../api';

interface HeatCell {
  value: number;
  tone: 'deep' | 'light' | 'orange' | 'pink';
}

interface OverviewHeatCell {
  teamId: string;
  skillPointId: string;
  passRate: number;
  avgScore: number;
  sampleSize: number;
}

interface Overview {
  heatmap: OverviewHeatCell[];
  attention: { userId: string; userName: string; reason: string }[];
  weakSkills: { skillPointId: string; skillPointName: string; avgScore: number }[];
  coachingTopics: string[];
}

interface Member {
  id: string;
  name: string;
  teamId: string | null;
  certStatus: string;
  weakestSkillName: string | null;
  examCount: number;
  attention: string | null;
}

interface MemberDetail {
  user: { id: string; name: string };
  timeline: {
    sessionId: string;
    at: string;
    scenarioName: string;
    totalScore: number | null;
    passed: boolean | null;
  }[];
  skillDetails: {
    skillPointId: string;
    name: string;
    latestScore: number | null;
    level: number;
  }[];
  coachingTopics: string[];
}

const toneOf = (v: number): HeatCell['tone'] =>
  v >= 80 ? 'deep' : v >= 65 ? 'light' : v >= 45 ? 'orange' : 'pink';

const TONE_CLASS: Record<HeatCell['tone'], string> = {
  deep: 'bg-[#2e9e77] text-white',
  light: 'bg-[#8fc7b8] text-[#17191F]',
  orange: 'bg-[#E85C62] text-[#F7F7FA]',
  pink: 'bg-[#e08a97] text-white',
};

const barColor = (score: number) =>
  score >= 70 ? 'bg-[#2e9e77]' : score >= 50 ? 'bg-[#f0a030]' : 'bg-[#d43a4e]';

const loadError = (e: unknown) =>
  axios.isAxiosError(e) && e.response?.status === 403
    ? '当前账号无权查看主管看板（需要 supervisor 或 admin 角色）'
    : '加载失败，请确认后端服务已启动';

function LockIcon() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
      />
    </svg>
  );
}

function BulbIcon() {
  return (
    <svg className="h-4 w-4 text-orange-500" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 18v-5.25m0 0a6.01 6.01 0 001.5-.189m-1.5.189a6.01 6.01 0 01-1.5-.189m3.75 7.478a12.06 12.06 0 01-4.5 0m3.75 2.383a14.406 14.406 0 01-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 10-7.517 0c.85.493 1.509 1.333 1.509 2.316V18"
      />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
      />
    </svg>
  );
}

export default function Supervisor() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [skillNames, setSkillNames] = useState<Record<string, string>>({});
  const [teamNames, setTeamNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<MemberDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError('');
      try {
        const [overviewRes, membersRes, skillPointsRes] = await Promise.all([
          api.get<Overview>('/supervisor/overview'),
          api.get<Member[]>('/supervisor/members'),
          api.get<{ skillPoints: { id: string; name: string }[] }>('/skill-points'),
        ]);
        setOverview(overviewRes.data);
        setMembers(membersRes.data);
        setSkillNames(
          Object.fromEntries(skillPointsRes.data.skillPoints.map((sp) => [sp.id, sp.name]))
        );
        // 团队名：/teams 仅 admin 可见，supervisor 角色 403 时退化为 teamId
        try {
          const teamsRes = await api.get<{
            organizations: { teams: { id: string; name: string }[] }[];
          }>('/teams');
          setTeamNames(
            Object.fromEntries(
              teamsRes.data.organizations.flatMap((o) => o.teams.map((t) => [t.id, t.name]))
            )
          );
        } catch {
          setTeamNames({});
        }
      } catch (e) {
        setError(loadError(e));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // 默认选中第一个需关注成员，否则第一个成员
  useEffect(() => {
    if (selectedId || members.length === 0) return;
    setSelectedId(members.find((m) => m.attention)?.id ?? members[0].id);
  }, [members, selectedId]);

  const loadDetail = useCallback(async (userId: string) => {
    setDetailLoading(true);
    try {
      const res = await api.get<MemberDetail>(`/supervisor/members/${userId}`);
      setDetail(res.data);
    } catch {
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedId) loadDetail(selectedId);
    else setDetail(null);
  }, [selectedId, loadDetail]);

  const teamName = (teamId: string) => teamNames[teamId] ?? teamId;
  const skillName = (skillPointId: string) => skillNames[skillPointId] ?? skillPointId;

  // 热力图：行 = 团队（按返回顺序），列 = 技能点（按技能点列表顺序），值 = 达标率 %
  const heatmap = useMemo(() => {
    const cells = overview?.heatmap ?? [];
    const columnIds = Object.keys(skillNames).length
      ? Object.keys(skillNames).filter((id) => cells.some((c) => c.skillPointId === id))
      : [...new Set(cells.map((c) => c.skillPointId))];
    const rowIds = [...new Set(cells.map((c) => c.teamId))];
    const byKey = new Map(cells.map((c) => [`${c.teamId}::${c.skillPointId}`, c]));
    return {
      columns: columnIds,
      rows: rowIds.map((teamId) => ({
        teamId,
        cells: columnIds.map((skillPointId) => {
          const cell = byKey.get(`${teamId}::${skillPointId}`);
          const value = cell ? Math.round(cell.passRate * 100) : null;
          return { value, tone: toneOf(value ?? 0) };
        }),
      })),
    };
  }, [overview, skillNames]);

  // 页头标题：成员均属同一团队时显示团队名
  const title = useMemo(() => {
    const teamIds = [...new Set(members.map((m) => m.teamId).filter((t) => t !== null))];
    if (teamIds.length === 1) return `${teamName(teamIds[0])} · 团队总览`;
    return '团队总览';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members, teamNames]);

  // 辅导建议卡：薄弱技能专项辅导 + 需关注成员 1v1
  const coachingCards = useMemo(() => {
    if (!overview) return [];
    const cards = [
      ...overview.coachingTopics.map((topic) => ({
        title: '专项辅导',
        body: topic,
        cls: 'bg-[#fdf1e0]',
      })),
      ...overview.attention.map((a) => ({
        title: `1v1：${a.userName}`,
        body: a.reason,
        cls: 'bg-[#e3edee]',
      })),
    ];
    return cards.slice(0, 3);
  }, [overview]);

  const weakSkills = overview?.weakSkills ?? [];
  const detailSkills = (detail?.skillDetails ?? []).filter((s) => s.latestScore !== null);
  const lastExam = detail?.timeline[detail.timeline.length - 1];

  if (loading) {
    return <p className="py-20 text-center text-sm text-gray-400">加载中…</p>;
  }
  if (error) {
    return <p className="py-20 text-center text-sm text-red-600">{error}</p>;
  }

  return (
    <div className="space-y-4">
      {/* 页头 */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#17191F]">{title}</h1>
          <p className="mt-1 text-sm text-gray-500">数据口径：认证考核结果（练习明细不可见）</p>
        </div>
        <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-[#e2eaef] px-3.5 py-1.5 text-xs text-gray-600">
          <LockIcon />
          练习模式数据对主管不可见
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* 团队技能热力图 */}
        <section className="rounded-2xl bg-white p-5 shadow-sm lg:col-span-2">
          <h2 className="mb-5 text-base font-bold text-[#17191F]">团队技能热力图（达标率 %）</h2>
          {heatmap.rows.length === 0 ? (
            <p className="py-10 text-center text-sm text-gray-400">暂无考核数据</p>
          ) : (
            <div
              className="grid items-center gap-x-2 gap-y-2"
              style={{
                gridTemplateColumns: `72px repeat(${heatmap.columns.length}, minmax(0, 1fr))`,
              }}
            >
              <span className="text-xs text-gray-500">小组</span>
              {heatmap.columns.map((c) => (
                <span key={c} className="text-center text-xs text-gray-500">
                  {skillName(c)}
                </span>
              ))}
              {heatmap.rows.map((row) => (
                <div key={row.teamId} className="contents">
                  <span className="text-sm font-medium text-[#17191F]">{teamName(row.teamId)}</span>
                  {row.cells.map((cell, i) => (
                    <div
                      key={i}
                      className={`flex h-12 items-center justify-center rounded-lg text-sm font-semibold ${
                        cell.value === null ? 'bg-gray-100 text-gray-300' : TONE_CLASS[cell.tone]
                      }`}
                    >
                      {cell.value ?? '—'}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
          {weakSkills.length > 0 && (
            <p className="mt-4 text-xs text-gray-500">
              团队薄弱 Top{weakSkills.length}：
              {weakSkills.map((w) => `${w.skillPointName} ${w.avgScore}`).join(' / ')}
            </p>
          )}
        </section>

        {/* 本周辅导建议卡 */}
        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="mb-4 flex items-center gap-1.5 text-base font-bold text-[#17191F]">
            <BulbIcon />
            本周辅导建议卡
          </h2>
          {coachingCards.length === 0 ? (
            <p className="py-6 text-center text-sm text-gray-400">暂无辅导建议</p>
          ) : (
            <div className="space-y-3">
              {coachingCards.map((card, i) => (
                <div key={i} className={`rounded-xl p-3.5 ${card.cls}`}>
                  <p className="text-sm font-semibold text-[#17191F]">{card.title}</p>
                  <p className="mt-1.5 text-xs leading-relaxed text-gray-600">{card.body}</p>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 成员列表 */}
        <section className="rounded-2xl bg-white p-5 shadow-sm lg:col-span-2">
          <h2 className="mb-4 text-base font-bold text-[#17191F]">成员列表</h2>
          {members.length === 0 ? (
            <p className="py-10 text-center text-sm text-gray-400">暂无团队成员</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-400">
                  <th className="pb-2 font-medium">成员</th>
                  <th className="pb-2 font-medium">认证状态</th>
                  <th className="pb-2 font-medium">最弱技能点</th>
                  <th className="pb-2 font-medium">考核次数</th>
                  <th className="pb-2 font-medium">关注</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => {
                  const selected = m.id === selectedId;
                  return (
                    <tr
                      key={m.id}
                      onClick={() => setSelectedId(m.id)}
                      className={`cursor-pointer ${selected ? 'bg-[#e6efec]' : 'border-t border-gray-100 hover:bg-gray-50'}`}
                    >
                      <td
                        className={`py-3 pr-4 font-medium text-[#17191F] ${selected ? 'rounded-l-lg' : ''}`}
                      >
                        <span className={selected ? 'pl-3' : ''}>{m.name}</span>
                      </td>
                      <td className="py-3 pr-4 text-gray-700">{m.certStatus}</td>
                      <td className="py-3 pr-4 text-gray-700">{m.weakestSkillName ?? '—'}</td>
                      <td className="py-3 pr-4 text-gray-700">{m.examCount}</td>
                      <td className={`py-3 ${selected ? 'rounded-r-lg' : ''}`}>
                        {m.attention ? (
                          <span className="flex items-center gap-1 text-xs font-medium text-[#d43a4e]">
                            <AlertIcon />
                            {m.attention}
                          </span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>

        {/* 成员详情 */}
        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="text-base font-bold text-[#17191F]">
            成员详情{detail ? ` · ${detail.user.name}` : ''}
          </h2>
          <p className="mt-1 text-xs text-gray-500">只显示考核成绩与技能明细，不含任何练习记录。</p>
          {detailLoading && <p className="py-10 text-center text-sm text-gray-400">加载详情…</p>}
          {!detailLoading && !detail && (
            <p className="py-10 text-center text-sm text-gray-400">
              {selectedId ? '加载详情失败' : '从成员列表选择一名成员'}
            </p>
          )}
          {!detailLoading && detail && (
            <>
              {detailSkills.length === 0 ? (
                <p className="mt-4 text-sm text-gray-400">暂无技能数据</p>
              ) : (
                <div className="mt-4 space-y-3">
                  {detailSkills.map((s) => (
                    <div key={s.skillPointId} className="flex items-center gap-3">
                      <span className="w-16 shrink-0 text-xs text-gray-600">{s.name}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100">
                        <div
                          className={`h-full rounded-full ${barColor(s.latestScore!)}`}
                          style={{ width: `${s.latestScore}%` }}
                        />
                      </div>
                      <span className="w-7 shrink-0 text-right text-xs font-semibold text-[#17191F]">
                        {s.latestScore}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {lastExam && lastExam.totalScore !== null && (
                <p className="mt-4 text-xs text-gray-500">
                  最近考核：{lastExam.scenarioName} · {lastExam.totalScore} 分 ·{' '}
                  {lastExam.passed ? '达标' : '未达标'}
                </p>
              )}
              {detail.coachingTopics.length > 0 && (
                <div className="mt-5 rounded-xl bg-[#fdf1e0] p-3.5">
                  <p className="text-sm font-semibold text-[#17191F]">建议辅导话题</p>
                  {detail.coachingTopics.map((topic, i) => (
                    <p key={i} className="mt-1.5 text-xs leading-relaxed text-gray-600">
                      {topic}
                    </p>
                  ))}
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
