import type { Session, TranscriptTurn } from '@grasp-mvp/core';

export const RECEPTION_FLUENCY_DEDUCTION = 40;

export interface FluencyTurnAnalysis {
  seq: number;
  fillerCount: number;
  repetitionCount: number;
  disruptedPauseCount: number;
  pauseRatio: number;
  averageVoicedSegmentMs: number;
  severe: boolean;
  reasons: string[];
}

export interface ReceptionFluencyAnalysis {
  triggered: boolean;
  deduction: number;
  rationale: string;
  evidence: string[];
  fillerCount: number;
  repetitionCount: number;
  disruptedPauseCount: number;
  affectedTurns: number;
  quoteTurnSeq: number;
  turns: FluencyTurnAnalysis[];
}

const INTERJECTION_FILLER_PATTERN = /(?<![\p{Script=Han}A-Za-z0-9])[嗯啊呃额]+(?![\p{Script=Han}A-Za-z0-9])|就是说/gu;
const DISCOURSE_FILLER_PATTERN = /(?:^|[\s，。！？；、])(这个|那个|就是|然后|其实)(?=[\s，。！？；、]|$)/gu;
const SYLLABLE_REPETITION_PATTERN = /([我你他这那有在是和就都也很太不没会能要该把跟让])\1/g;
const WORD_REPETITION_PATTERN = /(这个|那个|就是|然后|我们|你们|可以|可能)\s*\1/g;
const DISRUPTED_PAUSE_MS = 600;

function countMatches(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

function analyzeTurn(turn: TranscriptTurn): FluencyTurnAnalysis {
  const fillerCount = countMatches(turn.text, INTERJECTION_FILLER_PATTERN) + countMatches(turn.text, DISCOURSE_FILLER_PATTERN);
  const repetitionCount =
    countMatches(turn.text, SYLLABLE_REPETITION_PATTERN) + countMatches(turn.text, WORD_REPETITION_PATTERN);
  const prosody = turn.voiceFeatures?.prosody;
  const totalMs = prosody?.loudnessCurve.length
    ? prosody.loudnessCurve[prosody.loudnessCurve.length - 1].atMs + 20
    : 0;
  const pauses = prosody?.pauses ?? [];
  const leadingPauseMs = pauses.find((pause) => pause.atMs === 0)?.durationMs ?? 0;
  const trailingPauseMs = pauses.find((pause) => pause.atMs + pause.durationMs >= totalMs && totalMs > 0)?.durationMs ?? 0;
  const internalPauses = pauses.filter((pause) =>
    pause.atMs > 0 && pause.atMs + pause.durationMs < totalMs
  );
  const disruptedPauses = internalPauses.filter((pause) => pause.durationMs >= DISRUPTED_PAUSE_MS);
  const activeWindowMs = Math.max(1, totalMs - leadingPauseMs - trailingPauseMs);
  const pauseRatio = totalMs > 0
    ? Math.round(internalPauses.reduce((sum, pause) => sum + pause.durationMs, 0) / activeWindowMs * 100) / 100
    : 0;
  const averageVoicedSegmentMs = prosody?.rhythm.averageVoicedSegmentMs ?? 0;
  const shortUtterance = turn.text.replace(/\s/g, '').length <= 24;
  const severe =
    fillerCount >= 4 ||
    (fillerCount >= 3 && shortUtterance) ||
    repetitionCount >= 2 ||
    (fillerCount >= 2 && (repetitionCount >= 1 || disruptedPauses.length >= 2)) ||
    (disruptedPauses.length >= 3 && (pauseRatio >= 0.18 || averageVoicedSegmentMs < 1000)) ||
    (disruptedPauses.length >= 2 && pauseRatio >= 0.35);
  const reasons: string[] = [];
  if (fillerCount > 0) reasons.push(`填充词 ${fillerCount} 次`);
  if (repetitionCount > 0) reasons.push(`重复字词或断句 ${repetitionCount} 次`);
  if (disruptedPauses.length > 0) {
    reasons.push(`句中明显停顿 ${disruptedPauses.length} 处，停顿占比 ${Math.round(pauseRatio * 100)}%`);
  }
  if (averageVoicedSegmentMs > 0 && averageVoicedSegmentMs < 1000) {
    reasons.push(`连续发声平均仅 ${(averageVoicedSegmentMs / 1000).toFixed(1)} 秒`);
  }
  return {
    seq: turn.seq,
    fillerCount,
    repetitionCount,
    disruptedPauseCount: disruptedPauses.length,
    pauseRatio,
    averageVoicedSegmentMs,
    severe,
    reasons,
  };
}

export function analyzeReceptionFluency(session: Session): ReceptionFluencyAnalysis {
  const turns = session.transcript.filter((turn) => turn.speaker === 'trainee').map(analyzeTurn);
  const fillerCount = turns.reduce((sum, turn) => sum + turn.fillerCount, 0);
  const repetitionCount = turns.reduce((sum, turn) => sum + turn.repetitionCount, 0);
  const disruptedPauseCount = turns.reduce((sum, turn) => sum + turn.disruptedPauseCount, 0);
  const severeTurns = turns.filter((turn) => turn.severe);
  const fillerTurns = turns.filter((turn) => turn.fillerCount > 0).length;
  const repetitionTurns = turns.filter((turn) => turn.repetitionCount > 0).length;
  const sustainedFillers = fillerCount >= 10 && fillerTurns >= 3;
  const sustainedRepetitions = repetitionCount >= 4 && repetitionTurns >= 2;
  const triggered = severeTurns.length > 0 || sustainedFillers || sustainedRepetitions;
  const evidence = severeTurns.map((turn) => `第${turn.seq}轮${turn.reasons.join('、')}`);
  if (sustainedFillers && !severeTurns.some((turn) => turn.fillerCount > 0)) {
    evidence.push(`多轮累计出现填充词 ${fillerCount} 次`);
  }
  if (sustainedRepetitions && !severeTurns.some((turn) => turn.repetitionCount > 0)) {
    evidence.push(`多轮累计出现重复字词或断句 ${repetitionCount} 次`);
  }
  const affectedTurns = new Set([
    ...severeTurns.map((turn) => turn.seq),
    ...(sustainedFillers ? turns.filter((turn) => turn.fillerCount > 0).map((turn) => turn.seq) : []),
    ...(sustainedRepetitions ? turns.filter((turn) => turn.repetitionCount > 0).map((turn) => turn.seq) : []),
  ]).size;
  const rationale = triggered
    ? `${evidence.join('；')}。这些表现已经明显影响表达连贯性，全局扣40分。`
    : '未发现成串填充词、持续重复断句或频繁句中停顿，磕磕绊绊项不扣分。正常语气词、衔接润色、换气和句尾停顿不会触发扣分。';
  return {
    triggered,
    deduction: triggered ? RECEPTION_FLUENCY_DEDUCTION : 0,
    rationale,
    evidence,
    fillerCount,
    repetitionCount,
    disruptedPauseCount,
    affectedTurns,
    quoteTurnSeq: severeTurns[0]?.seq ?? turns.find((turn) => turn.fillerCount > 0 || turn.repetitionCount > 0)?.seq ?? 0,
    turns,
  };
}
