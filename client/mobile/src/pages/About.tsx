import { useNavigate } from 'react-router-dom';
import StatusBar from '../components/StatusBar';

interface GuideItem {
  icon: string;
  title: string;
  desc: string;
  detail: string[];
}

const GUIDES: GuideItem[] = [
  {
    icon: '🏠',
    title: '首页 · 发现陪练员',
    desc: '左右滑动卡片，选择适合你的陪练员',
    detail: [
      '首页展示所有可用的陪练员卡片，左右滑动浏览',
      '卡片上半部分展示陪练员形象，下半部分展示画像信息',
      '点击「去对练」进入陪练员详情页，开始对练',
    ],
  },
  {
    icon: '🎯',
    title: '对练模式',
    desc: '文字对话、语音对话、语音通话三种模式',
    detail: [
      '文字对话：专注逻辑与话术，适合反复练习',
      '语音对话：一轮一轮说，先校对再发送',
      '语音通话：实时开口，可插话，接近真实场景',
    ],
  },
  {
    icon: '🔮',
    title: '推演沙盘',
    desc: '在正式对练前，进行沙盘推演',
    detail: [
      '输入或语音描述你的场景条件：环境、客户、自身情况',
      'AI 自动提取结构化信息，确认后开始推演',
      '推演结果包括：阶段分析、预测异议、关键时刻、核心建议',
      '帮助你提前预判客户反应，制定应对策略',
    ],
  },
  {
    icon: '📊',
    title: '多维能力',
    desc: '查看你的全维度技能画像',
    detail: [
      '雷达图展示六大维度能力：需求挖掘、价值表达、异议处理、推进成交、倾听共情、表达清晰',
      '训练趋势：查看最近训练得分变化',
      '口头禅分析：识别高频填充词，提升表达精炼度',
    ],
  },
  {
    icon: '👤',
    title: '陪练员画像',
    desc: '自定义与重塑陪练员',
    detail: [
      '查看陪练员的核心特征',
      '通过表单或 AI 对话方式自由修改陪练员画像',
      '支持语音输入，编程式地调整陪练员风格与难度',
    ],
  },
  {
    icon: '📈',
    title: '复盘报告',
    desc: '对练结束后的 AI 评价与分析',
    detail: [
      'AI 自动评分：包括各技能点得分、违规检测、覆盖率检查',
      '对评分不满意可点击「我不同意」发起申诉，AI 将进行复评',
      '复盘报告中包含引用原文、判定依据和改进建议',
    ],
  },
];

const FAQ: { q: string; a: string }[] = [
  { q: '对练后多久能看到报告？', a: '对练结束后通常 10-30 秒内生成报告。如果对话内容过少或时长过短，将跳过报告生成。' },
  { q: '语音通话需要什么配置？', a: '需要浏览器支持麦克风权限。推荐使用 Chrome 或 Safari 最新版本。' },
  { q: '产品参数和话术如何植入陪练员？', a: '产品知识库（ProductKB）中的要点、红线、竞品对比和 FAQ 会自动编译到陪练员的系统提示词中。' },
  { q: '对练中的考题是什么？', a: '陪练员会根据对话进展动态弹出考题，检验你的应变能力。答完后即时判分，汇总到最终报告。' },
  { q: '推演沙盘和对练有什么区别？', a: '推演沙盘是对练前的预演工具，模拟客户可能的反应和策略建议；对练是真实互动的实战训练。' },
];

export default function About() {
  const navigate = useNavigate();

  return (
    <div className="relative mx-auto flex min-h-screen w-full max-w-md flex-col">
      <StatusBar dark />
      <div className="flex items-center px-4 py-2">
        <button onClick={() => navigate(-1)} className="flex h-9 w-9 items-center justify-center">
          <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
        </button>
      </div>

      <div className="px-5 pt-2">
        <h1 className="text-xl font-bold">关于Grasp陪练员</h1>
        <p className="mt-1 text-sm">你的专属陪练员与指导参谋</p>
      </div>

      {/* 应用简介 */}
      <div className="mx-5 mt-5 rounded-2xl bg-gradient-to-br from-red-500 to-orange-500 p-5 shadow-sm">
        <p className="text-base font-bold">Grasp · 你的专属陪练员与指导参谋</p>
        <p className="mt-1.5 text-xs leading-relaxed /90">
          一款AI驱动的销售陪练产品。通过陪练员对练、沙盘推演、多维能力分析，
          帮助你在真实场景中提升沟通与销售能力。
        </p>
      </div>

      {/* 使用指南 */}
      <div className="mx-5 mt-5">
        <h2 className="text-base font-bold">📖 使用指南</h2>
        <div className="mt-3 space-y-3">
          {GUIDES.map((g, i) => (
            <GuideCard key={i} guide={g} />
          ))}
        </div>
      </div>

      {/* 常见问题 */}
      <div className="mx-5 mt-5">
        <h2 className="text-base font-bold">❓ 常见问题</h2>
        <div className="mt-3 space-y-2">
          {FAQ.map((f, i) => (
            <div key={i} className="rounded-xl p-4 shadow-sm">
              <p className="text-sm font-bold">{f.q}</p>
              <p className="mt-1.5 text-xs leading-relaxed">{f.a}</p>
            </div>
          ))}
        </div>
      </div>

      {/* 版本信息 */}
      <div className="mx-5 mt-5 mb-6 rounded-2xl p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <span className="text-xs">版本</span>
          <span className="text-xs font-bold">v0.1.0</span>
        </div>
      </div>

      <div className="flex-1" />
      <div className="h-6" />
    </div>
  );
}

function GuideCard({ guide }: { guide: GuideItem }) {
  return (
    <div className="rounded-2xl p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <span className="text-2xl">{guide.icon}</span>
        <div className="flex-1">
          <p className="text-sm font-bold">{guide.title}</p>
          <p className="text-xs">{guide.desc}</p>
        </div>
      </div>
      <ul className="mt-3 space-y-1.5">
        {guide.detail.map((d, i) => (
          <li key={i} className="flex items-start gap-1.5">
            <span className="mt-0.5 shrink-0 text-xs">•</span>
            <span className="flex-1 text-xs leading-relaxed">{d}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
