import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

// Demo data matching prototype-v3/index.html
const SCENES = [
  {
    id: 'sc-001',
    name: '向谨慎的采购总监报价',
    category: '电话销售',
    categoryColor: '#FF6B5B',
    difficulty: '进阶',
    duration: '约 8 分钟',
    description: '王总对价格极度敏感，习惯用竞品压价，需要在 5 分钟内讲清差异化价值。',
    persona: '王建国',
    personaRole: '制造业采购总监',
    tags: ['谨慎', '重数据', '爱压价'],
    image: 'man-3.jpg',
    practiced: false,
    score: null,
  },
  {
    id: 'sc-002',
    name: '接住主动上门的咨询',
    category: '客户主动咨询',
    categoryColor: '#4B7BEC',
    difficulty: '初级',
    duration: '约 5 分钟',
    description: '林女士来电询问课程报价，需求模糊。目标：3 个问题内确认真实需求与决策人。',
    persona: '林晓雯',
    personaRole: '培训机构负责人',
    tags: ['爽快', '需求模糊'],
    image: 'woman-1.jpg',
    practiced: true,
    score: 82,
  },
  {
    id: 'sc-003',
    name: '临门一脚：合同条款博弈',
    category: '成交谈判',
    categoryColor: '#F5A623',
    difficulty: '挑战',
    duration: '约 12 分钟',
    description: '赵总认可产品，但要求账期延长 + 独家折扣，否则"再考虑考虑"。练习让步策略与截止时间管理。',
    persona: '赵铭',
    personaRole: '连锁餐饮创始人',
    tags: ['精明', '强势', '善拖延'],
    image: 'man-2.jpg',
    practiced: false,
    score: null,
  },
  {
    id: 'sc-004',
    name: '商场里 30 秒破冰',
    category: '地推破冰',
    categoryColor: '#2FAE7B',
    difficulty: '初级',
    duration: '约 4 分钟',
    description: '陈姐在赶时间，对推销天然戒备。练习开场白设计与第一句钩子，争取到加微信。',
    persona: '陈丽',
    personaRole: '商场路过顾客',
    tags: ['戒备', '赶时间'],
    image: 'woman-2.jpg',
    practiced: false,
    score: null,
  },
  {
    id: 'sc-005',
    name: '客户拿着竞品方案来比价',
    category: '客户主动咨询',
    categoryColor: '#4B7BEC',
    difficulty: '进阶',
    duration: '约 10 分钟',
    description: '周工已拿到竞品详细报价单，开门见山问"你们贵在哪"。练习不诋毁竞品的对比表达。',
    persona: '周立群',
    personaRole: 'IT 技术主管',
    tags: ['理性', '技术导向', '已比价'],
    image: 'man-1.jpg',
    practiced: false,
    score: null,
  },
  {
    id: 'sc-006',
    name: '被前台拦截后的突围',
    category: '电话销售',
    categoryColor: '#FF6B5B',
    difficulty: '进阶',
    duration: '约 8 分钟',
    description: '吴主管拒绝转接决策人。练习在不冒犯的前提下拿到关键人联系方式或约到回电时间。',
    persona: '吴敏',
    personaRole: '行政主管',
    tags: ['程式化', '防火墙'],
    image: 'woman-3.jpg',
    practiced: true,
    score: 64,
  },
  {
    id: 'sc-007',
    name: '展会摊位前的驻足转化',
    category: '地推破冰',
    categoryColor: '#2FAE7B',
    difficulty: '挑战',
    duration: '约 6 分钟',
    description: '孙总路过展位扫了一眼就要走。用一句行业洞察让他停下来，并约到展后详谈。',
    persona: '孙鹏',
    personaRole: '经销商老板',
    tags: ['见多识广', '时间碎'],
    image: 'man-4.jpg',
    practiced: false,
    score: null,
  },
  {
    id: 'sc-008',
    name: '续约涨价 10% 怎么谈',
    category: '成交谈判',
    categoryColor: '#F5A623',
    difficulty: '进阶',
    duration: '约 10 分钟',
    description: '老客户郑经理对续约涨价抵触，拿去年服务小事故说事。练习先修复信任再谈价格。',
    persona: '郑海燕',
    personaRole: '客户成功对接人',
    tags: ['念旧情', '会翻旧账'],
    image: 'woman-4.jpg',
    practiced: true,
    score: 91,
  },
];

const CATEGORIES = [
  { label: '全部', value: '' },
  { label: '电话销售', value: '电话销售', color: '#FF6B5B' },
  { label: '客户主动咨询', value: '客户主动咨询', color: '#4B7BEC' },
  { label: '成交谈判', value: '成交谈判', color: '#F5A623' },
  { label: '地推破冰', value: '地推破冰', color: '#2FAE7B' },
];

// Hero recommendation
const HERO = {
  name: '客户嫌贵？向谨慎的采购总监报价',
  description: '对方以"预算有限、竞品更便宜"连续施压。练习目标：不降价的前提下重构价值表达，争取二次面谈。',
  persona: '王建国',
  personaRole: '制造业采购总监',
  image: 'man-3.jpg',
  tag: '为你推荐 · 针对弱项「异议处理」',
};

export default function Home() {
  const navigate = useNavigate();
  const [activeCategory, setActiveCategory] = useState('');

  const filteredScenes = activeCategory
    ? SCENES.filter((s) => s.category === activeCategory)
    : SCENES;

  return (
    <div style={{ background: '#F7F7F8', minHeight: '100vh' }}>
      {/* Search Row */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', margin: '22px 0 14px' }}>
        <div style={{
          flex: 1, display: 'flex', alignItems: 'center', gap: 8,
          background: '#fff', border: '1px solid #EBEBEF',
          borderRadius: 999, padding: '10px 18px', maxWidth: 520,
        }}>
          <span style={{ color: '#9CA1AB' }}>🔍</span>
          <input
            placeholder="搜索场景、角色或行业，如「报价」「医美」"
            style={{ border: 'none', outline: 'none', flex: 1, background: 'none', fontSize: 14 }}
          />
        </div>
        <button className="btn ghost sm" style={{ flex: 'none' }}>筛选 ⌄</button>
      </div>

      {/* Category Chips */}
      <div style={{ display: 'flex', gap: 10, overflowX: 'auto', padding: '4px 0 12px', scrollbarWidth: 'none' }}>
        {CATEGORIES.map((cat) => (
          <span
            key={cat.value}
            onClick={() => setActiveCategory(cat.value)}
            style={{
              flex: 'none', padding: '8px 16px', fontSize: 13.5, cursor: 'pointer',
              borderRadius: 999, fontWeight: 600,
              background: activeCategory === cat.value ? '#1F2329' : '#F1F2F4',
              color: activeCategory === cat.value ? '#fff' : '#6B7280',
              transition: '.15s',
            }}
          >
            {cat.value && (
              <span style={{
                display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
                background: cat.color, marginRight: 5,
              }} />
            )}
            {cat.label}
          </span>
        ))}
      </div>

      {/* Hero Recommendation */}
      <section style={{
        display: 'flex', gap: 22, alignItems: 'center', padding: '24px 28px', margin: '8px 0 26px',
        background: 'linear-gradient(120deg, #FFF0EE 0%, #fff 60%)',
        borderRadius: 16,
      }}>
        <div style={{
          width: 84, height: 84, borderRadius: '50%', flex: 'none',
          border: '2.5px solid #fff', boxShadow: '0 8px 20px -6px rgba(31,35,41,.25)',
          overflow: 'hidden',
        }}>
          <img src={`/avatars/${HERO.image}`} alt={HERO.persona} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center 25%' }}
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <span className="chip chip-coral" style={{ marginBottom: 6, display: 'inline-flex' }}>{HERO.tag}</span>
          <h2 style={{ fontSize: 19, marginBottom: 4, color: '#1F2329' }}>{HERO.name}</h2>
          <p style={{ color: '#6B7280', fontSize: 13.5 }}>{HERO.description}</p>
        </div>
        <button className="btn primary" style={{ flex: 'none' }} onClick={() => navigate('/practice/new')}>立即开练</button>
      </section>

      {/* Section Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <h2 style={{ fontSize: 18, color: '#1F2329', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 4, height: 15, borderRadius: 2, background: '#FF6B5B', display: 'inline-block' }} />
          热门场景
        </h2>
        <span style={{ fontSize: 13, color: '#6B7280' }}>按你的行业智能排序</span>
      </div>

      {/* Masonry Card Grid */}
      <div style={{ columnCount: 4, columnGap: 18 }}>
        {filteredScenes.map((scene) => (
          <div
            key={scene.id}
            onClick={() => navigate(`/scenario/${scene.id}`)}
            style={{
              breakInside: 'avoid', marginBottom: 18, cursor: 'pointer',
              background: '#fff', borderRadius: 16, overflow: 'hidden',
              boxShadow: '0 1px 2px rgba(16,24,40,.04), 0 10px 30px -14px rgba(16,24,40,.12)',
              transition: 'transform .2s ease-out, box-shadow .2s ease-out',
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLDivElement).style.transform = 'translateY(-4px)';
              (e.currentTarget as HTMLDivElement).style.boxShadow = '0 2px 4px rgba(16,24,40,.05), 0 18px 40px -16px rgba(16,24,40,.18)';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLDivElement).style.transform = 'translateY(0)';
              (e.currentTarget as HTMLDivElement).style.boxShadow = '0 1px 2px rgba(16,24,40,.04), 0 10px 30px -14px rgba(16,24,40,.12)';
            }}
          >
            {/* Cover Image */}
            <div style={{ position: 'relative' }}>
              <img
                src={`/avatars/${scene.image}`}
                alt={scene.name}
                style={{
                  width: '100%', height: 170, objectFit: 'cover', objectPosition: 'center 20%', display: 'block',
                }}
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                  (e.target as HTMLImageElement).parentElement!.style.background = `linear-gradient(160deg, ${scene.categoryColor}22, #fff)`;
                }}
              />
              {/* Category chip */}
              <span style={{
                position: 'absolute', top: 10, left: 10, zIndex: 1,
                background: scene.categoryColor + '22', color: scene.categoryColor,
                padding: '4px 12px', borderRadius: 999, fontSize: 12, fontWeight: 600,
                display: 'inline-flex', alignItems: 'center', gap: 5,
              }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: scene.categoryColor }} />
                {scene.category}
              </span>
              {/* Difficulty */}
              <span style={{
                position: 'absolute', bottom: 10, right: 10, zIndex: 1,
                fontSize: 11, color: '#1F2329', background: 'rgba(255,255,255,.92)',
                padding: '2px 9px', borderRadius: 999,
              }}>
                {scene.difficulty} · {scene.duration}
              </span>
              {/* Practiced badge */}
              {scene.practiced && scene.score !== null && (
                <span style={{
                  position: 'absolute', top: 10, right: 10, zIndex: 1,
                  background: 'rgba(255,255,255,.94)', color: '#FF6B5B', fontSize: 11.5, fontWeight: 700,
                  padding: '4px 10px', borderRadius: 999, boxShadow: '0 1px 4px rgba(16,24,40,.08)',
                }}>
                  已练习 · {scene.score} 分
                </span>
              )}
            </div>
            {/* Card Body */}
            <div style={{ padding: '12px 14px 14px' }}>
              <h3 style={{ fontSize: 15, marginBottom: 4, color: '#1F2329' }}>{scene.name}</h3>
              <p style={{ fontSize: 12.5, color: '#6B7280', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                {scene.description}
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 12.5, color: '#6B7280' }}>
                <div style={{
                  width: 20, height: 20, borderRadius: '50%', overflow: 'hidden', flex: 'none',
                }}>
                  <img src={`/avatars/${scene.image}`} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                </div>
                {scene.persona} · {scene.personaRole}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
                {scene.tags.map((tag) => (
                  <span key={tag} style={{ fontSize: 11, color: '#6B7280', background: '#F3F4F6', padding: '2px 8px', borderRadius: 6 }}>
                    {tag}
                  </span>
                ))}
              </div>
              {scene.practiced && (
                <button
                  style={{ marginTop: 10, fontSize: 12.5, color: '#FF6B5B', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                  onClick={(e) => { e.stopPropagation(); navigate('/practice/new'); }}
                >
                  再练一次 →
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
