import type { Scenario } from '../types';

/** 分类关键词匹配：按场景名称与 coverageTopics 归类 */
export const CATEGORY_RULES = [
  { label: '电话销售', color: '#FF6B5B', keywords: ['电话', '外呼', '电销', '前台'] },
  { label: '咨询接待', color: '#4B7BEC', keywords: ['咨询', '来电', '上门', '询价', '比价'] },
  { label: '现场成交', color: '#F5A623', keywords: ['谈判', '成交', '续约', '涨价', '条款', '价格', '签约'] },
  { label: '地推引流课', color: '#2FAE7B', keywords: ['地推', '破冰', '陌生', '展会', '商场', '摊位', '驻足'] },
] as const;

export type CategoryRule = (typeof CATEGORY_RULES)[number];

export function scenarioText(s: Scenario): string {
  return [s.name, s.personaName ?? '', ...(s.coverageTopics ?? [])].join(' ');
}

export function categoryOf(s: Scenario): CategoryRule | null {
  const text = scenarioText(s);
  return CATEGORY_RULES.find((r) => r.keywords.some((k) => text.includes(k))) ?? null;
}

export function matchCategory(s: Scenario, value: string): boolean {
  if (!value) return true;
  const rule = CATEGORY_RULES.find((r) => r.label === value);
  if (!rule) return true;
  const text = scenarioText(s);
  return rule.keywords.some((k) => text.includes(k));
}
