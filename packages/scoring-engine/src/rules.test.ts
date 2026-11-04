import { describe, expect, it } from 'vitest';
import type { Session } from '@grasp-mvp/core';
import { runRuleChecks } from './rules.js';

function sessionWith(text: string, secondAt: string): Session {
  return {
    id: 'session-fluency',
    tenantId: 'tenant-demo',
    userId: 'user-1',
    scenarioId: 'scenario-ground',
    mode: 'practice',
    status: 'completed',
    transcript: [
      { seq: 1, speaker: 'trainee', text: '您好', at: '2026-01-01T10:00:00Z' },
      { seq: 2, speaker: 'trainee', text, at: secondAt },
    ],
    emotionTrace: [],
    hintsUsed: 0,
    startedAt: '2026-01-01T10:00:00Z',
    endedAt: secondAt,
  };
}

describe('表达流畅度', () => {
  it('没有明显停顿和口头禅时为 100 分', () => {
    const { stats } = runRuleChecks(sessionWith('我们是围棋学校的', '2026-01-01T10:00:02Z'), []);
    expect(stats.fluencyScore).toBe(100);
  });

  it('明显停顿和口头禅越多分数越低', () => {
    const { stats } = runRuleChecks(sessionWith('嗯嗯，我们是围棋学校的', '2026-01-01T10:00:10Z'), []);
    expect(stats.pauseCount).toBe(1);
    expect(stats.fillerCounts['嗯']).toBe(2);
    expect(stats.fluencyScore).toBe(75);
  });

  it('大量停顿和口头禅最低为 0 分且不出现负分', () => {
    const { stats } = runRuleChecks(sessionWith('嗯'.repeat(18), '2026-01-01T10:00:10Z'), []);
    expect(stats.fluencyScore).toBe(0);
  });
});
