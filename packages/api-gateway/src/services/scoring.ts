import type { FastifyBaseLogger } from 'fastify';
import { scoreSession } from '@grasp-mvp/scoring-engine';
import type { Scenario, ScoreReport, Session, VoiceBaseline } from '@grasp-mvp/core';
import type { RouteContext } from '../ctx.js';
import { readFramesAsDataUrls } from './video-store.js';

interface ScoringCacheEntry {
  revision: string;
  settled: boolean;
  promise: Promise<ScoreReport>;
}

const scoringCache = new Map<string, ScoringCacheEntry>();

function scoringRevision(session: Session): string {
  const lastTurn = session.transcript[session.transcript.length - 1];
  return [
    session.transcript.length,
    lastTurn?.seq ?? 0,
    lastTurn?.at ?? '',
    session.videoFrames?.length ?? 0,
    session.quizResults?.length ?? 0,
  ].join(':');
}

async function computeScoreReport(
  ctx: RouteContext,
  session: Session,
  scenario: Scenario,
  log?: FastifyBaseLogger
): Promise<ScoreReport> {
  const { store, gateway } = ctx;
  const defs = await store.listScoreItemDefs(session.tenantId);
  const skillPoints = await store.listSkillPoints(session.tenantId);
  const skillPointNames = Object.fromEntries(skillPoints.map((sp) => [sp.id, sp.name]));
  const guidance = await store.getScenarioGuidance(session.scenarioId).catch(() => undefined);
  const videoFrames = session.videoFrames?.length
    ? await readFramesAsDataUrls(session.id, session.videoFrames.length)
    : undefined;
  const trainee = await store.getUser(session.userId);
  const voiceBaseline = trainee?.preferences?.voiceBaseline as VoiceBaseline | undefined;
  const institutionKB = scenario.category === '咨询接待' ? await store.getProductKB(session.tenantId) : undefined;
  const persona = await store.getPersonaConfig(scenario.personaConfigId);
  const personaRate = typeof persona?.voiceProfile?.rate === 'number' ? persona.voiceProfile.rate : undefined;
  const customerRateMultiplier = guidance?.voiceProfile?.rate ?? personaRate ?? 1;
  log?.info({ sessionId: session.id, scoreItems: defs.length, videoFrames: videoFrames?.length ?? 0 }, '评分计算开始');
  return scoreSession(session, scenario, defs, gateway, {
    videoFrames,
    log,
    skillPointNames,
    scoringFocus: guidance?.scoringFocus,
    voiceBaseline,
    institutionKB,
    customerRateMultiplier,
  });
}

function startScoring(
  ctx: RouteContext,
  session: Session,
  scenario: Scenario,
  log?: FastifyBaseLogger
): ScoringCacheEntry {
  const entry: ScoringCacheEntry = {
    revision: scoringRevision(session),
    settled: false,
    promise: computeScoreReport(ctx, session, scenario, log),
  };
  entry.promise = entry.promise.finally(() => {
    entry.settled = true;
  });
  scoringCache.set(session.id, entry);
  void entry.promise.catch(() => {
    if (scoringCache.get(session.id) === entry) scoringCache.delete(session.id);
  });
  return entry;
}

export function clearScoringCache(sessionId: string): void {
  scoringCache.delete(sessionId);
}

export function preScoreSession(ctx: RouteContext, session: Session, scenario: Scenario): void {
  const dialogueTurns = session.transcript.filter((turn) => turn.speaker === 'trainee' || turn.speaker === 'persona').length;
  if (dialogueTurns < 4) return;
  const current = scoringCache.get(session.id);
  if (current?.revision === scoringRevision(session)) return;
  startScoring(ctx, session, scenario);
}

export async function scoreSessionWithCache(
  ctx: RouteContext,
  session: Session,
  scenario: Scenario,
  log?: FastifyBaseLogger
): Promise<ScoreReport> {
  const revision = scoringRevision(session);
  const current = scoringCache.get(session.id);
  if (current?.revision === revision) {
    try {
      return await current.promise;
    } catch {
      if (scoringCache.get(session.id) === current) scoringCache.delete(session.id);
    }
  }
  return startScoring(ctx, session, scenario, log).promise;
}
