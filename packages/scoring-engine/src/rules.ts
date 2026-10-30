import type { RuleViolation, ScoreReport, Session } from '@grasp-mvp/core';

/** 合规红线词（一票否决） */
const REDLINE_PATTERN = /保证提分|包过|百分百考上名校|考不上全额退款|绝对有效果|一夜逆袭/;
/** 口头禅/填充词 */
const FILLER_WORDS = ['其实', '那个', '就是说', '然后', '嗯'];
/** 口头禅总次数阈值 */
const FILLER_TOTAL_THRESHOLD = 10;
/** 停顿判定阈值：学员应答前静默超过该毫秒数记为一次明显停顿 */
const PAUSE_THRESHOLD_MS = 3000;
/** 估算单字说话耗时（毫秒）：约 240 字/分钟，用于从轮次间隔中扣除上一轮说话时长 */
const MS_PER_CHAR = 250;

function countOccurrences(text: string, word: string): number {
  let count = 0;
  let idx = text.indexOf(word);
  while (idx !== -1) {
    count++;
    idx = text.indexOf(word, idx + word.length);
  }
  return count;
}

/**
 * 确定性规则层：红线 / 口头禅 / 打断启发式 / 话题覆盖。
 * 不依赖 LLM，结果可复现。
 */
export function runRuleChecks(
  session: Session,
  coverageTopics: string[]
): { violations: RuleViolation[]; stats: ScoreReport['ruleStats'] } {
  const violations: RuleViolation[] = [];
  const traineeTurns = session.transcript.filter((t) => t.speaker === 'trainee');

  // ---- 红线 ----
  for (const turn of traineeTurns) {
    if (REDLINE_PATTERN.test(turn.text)) {
      violations.push({
        ruleId: 'redline-promise',
        kind: 'redline',
        detail: `学员话术命中合规红线：${turn.text.slice(0, 50)}`,
        turnSeq: turn.seq,
        fatal: true,
      });
    }
  }

  // ---- 口头禅 ----
  const traineeAll = traineeTurns.map((t) => t.text).join('\n');
  const fillerCounts: Record<string, number> = {};
  let fillerTotal = 0;
  for (const word of FILLER_WORDS) {
    const n = countOccurrences(traineeAll, word);
    if (n > 0) {
      fillerCounts[word] = n;
      fillerTotal += n;
    }
  }
  if (fillerTotal > FILLER_TOTAL_THRESHOLD) {
    violations.push({
      ruleId: 'filler-heavy',
      kind: 'filler',
      detail: `口头禅总次数 ${fillerTotal} 次，超过阈值 ${FILLER_TOTAL_THRESHOLD}`,
      fatal: false,
    });
  }

  // ---- 打断启发式：学员轮紧接 persona 长文本轮且学员发言很短 ----
  let interruptions = 0;
  for (let i = 1; i < session.transcript.length; i++) {
    const prev = session.transcript[i - 1];
    const curr = session.transcript[i];
    if (
      curr.speaker === 'trainee' &&
      prev.speaker === 'persona' &&
      prev.text.length > 40 &&
      curr.text.length < 8
    ) {
      interruptions++;
    }
  }

  // ---- 话题覆盖 ----
  const coverageHits: string[] = [];
  const coverageMisses: string[] = [];
  for (const topic of coverageTopics) {
    if (traineeAll.includes(topic)) {
      coverageHits.push(topic);
    } else {
      coverageMisses.push(topic);
    }
  }
  if (coverageMisses.length > 0) {
    violations.push({
      ruleId: 'coverage-miss',
      kind: 'coverage',
      detail: `未覆盖话题：${coverageMisses.join('、')}`,
      fatal: false,
    });
  }

  // ---- 状态指标：发言占比 / 语速 / 停顿（均由转写文本与时间戳推算） ----
  const charsOf = (speaker: Session['transcript'][number]['speaker']) =>
    session.transcript
      .filter((t) => t.speaker === speaker)
      .reduce((sum, t) => sum + t.text.length, 0);
  const traineeChars = charsOf('trainee');
  const totalChars = traineeChars + charsOf('persona');
  const talkRatio = totalChars > 0 ? traineeChars / totalChars : 0;

  // 对话时间窗：首轮到末轮的时间戳（缺失时回退会话起止），扣除累计暂停
  const firstAt = Date.parse(session.transcript[0]?.at ?? session.startedAt);
  const lastAt = Date.parse(
    session.transcript[session.transcript.length - 1]?.at ?? session.endedAt ?? session.startedAt
  );
  const activeMs =
    Number.isFinite(firstAt) && Number.isFinite(lastAt)
      ? Math.max(0, lastAt - firstAt - (session.pausedMs ?? 0))
      : 0;
  // 双方按同一语速说话 → 学员语速 ≈ 时间窗内总字数 / 时长
  const avgSpeechRate = activeMs > 0 ? Math.round(totalChars / (activeMs / 60000)) : 0;

  // 停顿：学员轮开始前，距上一轮的时间间隔扣除上一轮说话时长后仍超阈值
  let pauseCount = 0;
  for (let i = 1; i < session.transcript.length; i++) {
    const prev = session.transcript[i - 1];
    const curr = session.transcript[i];
    if (curr.speaker !== 'trainee') continue;
    const gapMs = Date.parse(curr.at) - Date.parse(prev.at);
    if (!Number.isFinite(gapMs)) continue;
    if (gapMs - prev.text.length * MS_PER_CHAR > PAUSE_THRESHOLD_MS) {
      pauseCount++;
    }
  }

  // ---- 语音声学特征聚合：各学员语音轮的录音分析，按实际说话时长加权 ----
  const voiceTurns = traineeTurns.filter((t) => t.voiceFeatures);
  let voice: ScoreReport['ruleStats']['voice'];
  if (voiceTurns.length > 0) {
    const totalVoicedMs = voiceTurns.reduce((sum, t) => sum + (t.voiceFeatures?.voicedMs ?? 0), 0);
    if (totalVoicedMs > 0) {
      const wavg = (pick: (f: NonNullable<(typeof voiceTurns)[number]['voiceFeatures']>) => number) =>
        voiceTurns.reduce((sum, t) => sum + pick(t.voiceFeatures!) * t.voiceFeatures!.voicedMs, 0) / totalVoicedMs;
      const pitchTurns = voiceTurns.filter((t) => t.voiceFeatures?.pitchVarSemitones != null);
      const pitchMs = pitchTurns.reduce((sum, t) => sum + t.voiceFeatures!.voicedMs, 0);
      const voiceChars = voiceTurns.reduce((sum, t) => sum + t.text.length, 0);
      voice = {
        turns: voiceTurns.length,
        avgLoudnessDbfs: Math.round(wavg((f) => f.avgLoudnessDbfs) * 10) / 10,
        loudnessRangeDb: Math.round(wavg((f) => f.loudnessRangeDb) * 10) / 10,
        pitchVarSemitones:
          pitchMs > 0
            ? Math.round(
                (pitchTurns.reduce((sum, t) => sum + t.voiceFeatures!.pitchVarSemitones! * t.voiceFeatures!.voicedMs, 0) / pitchMs) * 100
              ) / 100
            : null,
        speechRateCpm: Math.round(voiceChars / (totalVoicedMs / 60000)),
      };
    }
  }

  return {
    violations,
    stats: {
      interruptions,
      fillerCounts,
      coverageHits,
      coverageMisses,
      talkRatio,
      avgSpeechRate,
      pauseCount,
      ...(voice ? { voice } : {}),
    },
  };
}
