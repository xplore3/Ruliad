import type { Scenario } from '../types';

/** 分类关键词匹配：按场景名称与 coverageTopics 归类 */
export const CATEGORY_RULES = [
  { label: '电话销售', color: '#FF6B5B', keywords: ['电话', '外呼', '电销', '前台'] },
  { label: '咨询接待', color: '#FF8A7D', keywords: ['咨询', '来电', '上门', '询价', '比价'] },
  { label: '现场成交', color: '#E85A4A', keywords: ['谈判', '成交', '续约', '涨价', '条款', '价格', '签约'] },
  { label: '地推引流课', color: '#FFB5AB', keywords: ['地推', '破冰', '陌生', '展会', '商场', '摊位', '驻足'] },
] as const;

export type CategoryRule = (typeof CATEGORY_RULES)[number];

export function scenarioText(s: Scenario): string {
  return [s.name, s.personaName ?? '', s.description ?? '', ...(s.coverageTopics ?? [])].join(' ');
}

const SCORE_CATEGORY_LABELS: Record<NonNullable<Scenario['category']>, string> = {
  电销: '电话销售',
  咨询接待: '咨询接待',
  现场成交: '现场成交',
  地推: '地推引流课',
};

export function categoryOf(s: Scenario): CategoryRule | null {
  const explicitLabel = s.category ? SCORE_CATEGORY_LABELS[s.category] : undefined;
  const explicit = CATEGORY_RULES.find((r) => r.label === explicitLabel);
  if (explicit) return explicit;
  const text = scenarioText(s);
  return CATEGORY_RULES.find((r) => r.keywords.some((k) => text.includes(k))) ?? null;
}

export function matchCategory(s: Scenario, value: string): boolean {
  if (!value) return true;
  const rule = CATEGORY_RULES.find((r) => r.label === value);
  if (!rule) return true;
  return categoryOf(s)?.label === rule.label;
}
