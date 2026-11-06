import { expect, it } from 'vitest';
import { RECEPTION_QUESTION_POOL, type Session, type TranscriptTurn } from '@grasp-mvp/core';
import {
  RECEPTION_TRIAL_CLOSE,
  RECEPTION_TRIAL_LAST_CHANCE,
  RECEPTION_TRIAL_TRANSITION,
  receptionTrialFollowup,
} from './reception-followup.js';

function makeSession(transcript: TranscriptTurn[]): Session {
  return {
    id: 'session-reception-followup',
    tenantId: 'tenant-demo',
    userId: 'user-trainee-1',
    scenarioId: 'scenario-drill-inquiry',
    mode: 'practice',
    status: 'active',
    transcript,
    emotionTrace: [],
    hintsUsed: 0,
    receptionQuestions: RECEPTION_QUESTION_POOL.slice(0, 10).map((item) => ({ ...item })),
    receptionQuestionIndex: Math.min(10, transcript.filter((turn) => turn.speaker === 'trainee').length),
    startedAt: '2026-01-01T10:00:00Z',
  };
}

function traineeAnswers(count: number): TranscriptTurn[] {
  return Array.from({ length: count }, (_, index) => ({
    seq: index + 1,
    speaker: 'trainee',
    text: '我会根据机构政策说明课程安排。',
    at: '2026-01-01T10:00:00Z',
  }));
}

it('未满10题时客户不进入试听过渡', () => {
  expect(receptionTrialFollowup(makeSession(traineeAnswers(9)))).toBeUndefined();
});

it('第10题后未主动试听时客户只说了解情况', () => {
  const result = receptionTrialFollowup(makeSession(traineeAnswers(10)));
  expect(result).toEqual({ text: RECEPTION_TRIAL_TRANSITION, shouldClose: false });
});

it('过渡后仍不推进时客户给最后一次试听机会', () => {
  const transcript = [
    ...traineeAnswers(10),
    { seq: 11, speaker: 'persona' as const, text: RECEPTION_TRIAL_TRANSITION, at: '2026-01-01T10:00:00Z' },
    { seq: 12, speaker: 'trainee' as const, text: '还有其他需要我说明的吗？', at: '2026-01-01T10:00:00Z' },
  ];
  const result = receptionTrialFollowup(makeSession(transcript));
  expect(result).toEqual({ text: RECEPTION_TRIAL_LAST_CHANCE, shouldClose: false });
});

it('最后机会后仍不推进时客户结束对话', () => {
  const transcript = [
    ...traineeAnswers(10),
    { seq: 11, speaker: 'persona' as const, text: RECEPTION_TRIAL_TRANSITION, at: '2026-01-01T10:00:00Z' },
    { seq: 12, speaker: 'persona' as const, text: RECEPTION_TRIAL_LAST_CHANCE, at: '2026-01-01T10:00:00Z' },
    { seq: 13, speaker: 'trainee' as const, text: '好的。', at: '2026-01-01T10:00:00Z' },
  ];
  const result = receptionTrialFollowup(makeSession(transcript));
  expect(result).toEqual({ text: RECEPTION_TRIAL_CLOSE, shouldClose: true });
});

it('学员主动提出试听即使是封闭式问题也不进入被动过渡', () => {
  const transcript = [
    ...traineeAnswers(9),
    { seq: 10, speaker: 'trainee' as const, text: '你需要试听吗？', at: '2026-01-01T10:00:00Z' },
  ];
  expect(receptionTrialFollowup(makeSession(transcript))).toBeUndefined();
});

it('家长坚持不试听时不再给试听邀约过渡和最后机会', () => {
  const base = makeSession(traineeAnswers(10));
  const direct = RECEPTION_QUESTION_POOL.find((item) => item.question === '不用试听，我们到时候看一下直接报名吧。')!;
  const session: Session = {
    ...base,
    receptionQuestions: [{ ...direct }, ...base.receptionQuestions!.slice(1)],
    receptionTrialDisposition: 'decline',
  };
  expect(receptionTrialFollowup(session)).toBeUndefined();
});

it('开场自由问答不计入固定10题，实际只问8题时不提前收尾', () => {
  const session = makeSession(traineeAnswers(12));
  session.receptionQuestionIndex = 8;
  expect(receptionTrialFollowup(session)).toBeUndefined();
});
