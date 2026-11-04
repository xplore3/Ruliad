import { describe, expect, it } from 'vitest';
import type { BehaviorBand, PersonaRuntimeBundle } from '@grasp-mvp/core';
import { buildActorMessages } from './actor.js';

it('把同步语气证据附在最近一轮学员语音后', () => {
  const messages = buildActorMessages(
    { systemPrompt: '测试' } as PersonaRuntimeBundle,
    { key: 'neutral', instruction: '自然回应' } as BehaviorBand,
    [{
      seq: 1,
      speaker: 'trainee',
      text: '爸爸，围棋太好玩了，我要玩围棋！',
      at: new Date().toISOString(),
      voiceFeatures: {
        avgLoudnessDbfs: -26,
        loudnessRangeDb: 10,
        pitchVarSemitones: 7,
        voicedMs: 2000,
        prosody: {
          pitchCurve: [{ atMs: 20, f0Hz: 240 }],
          loudnessCurve: [{ atMs: 0, rms: 0.05 }],
          pauses: [],
          elongatedSegments: [{ startMs: 200, endMs: 900 }],
          rhythm: { voicedMs: 2000, pauseMs: 0, averageVoicedSegmentMs: 2000 },
          laughterCue: { status: 'unknown', reason: '不足以确认笑声' },
          performanceCue: { status: 'possible', reason: '存在夸张表演感线索' },
        },
      },
    }]
  );
  const content = String(messages.at(-1)?.content);
  expect(content).toContain('说话语气辅助证据');
  expect(content).toContain('夸张/表演感线索');
  expect(content).toContain('不是幽默或情绪结论');
});
