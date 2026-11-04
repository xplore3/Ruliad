import type { ExpressionIntent, ExpressionIntentKind, ExpressionTone, LLMProvider, TranscriptTurn } from '@grasp-mvp/core';

const VALID_TONES: ExpressionTone[] = ['playful', 'serious', 'uncertain'];
const VALID_INTENTS: ExpressionIntentKind[] = ['promise', 'threat', 'persuasion', 'request', 'question', 'inform', 'other'];

function prosodyLines(turn: TranscriptTurn): string {
  const prosody = turn.voiceFeatures?.prosody;
  if (!prosody) return '没有可用语音声学数据，只能依据文字。';
  const values = prosody.pitchCurve.map((point) => point.f0Hz);
  const range = values.length > 0 ? `${Math.round(Math.min(...values))}~${Math.round(Math.max(...values))}Hz` : '有效音调帧不足';
  return [
    `音调范围：${range}（${prosody.pitchCurve.length}个音调帧，${prosody.loudnessCurve.length}个音量帧）`,
    `停顿：${prosody.pauses.map((p) => `${(p.atMs / 1000).toFixed(1)}秒处${(p.durationMs / 1000).toFixed(1)}秒`).join('、') || '无明显停顿'}`,
    `连续长发声段：${prosody.elongatedSegments.map((s) => `${(s.startMs / 1000).toFixed(1)}~${(s.endMs / 1000).toFixed(1)}秒`).join('、') || '无明显长段'}`,
  ].join('\n');
}

/**
 * 全局表达分析：tone（玩笑/认真）与 intent（承诺/威胁/劝说等）彼此独立，不互斥。
 * 只识别表达方式与意图，不决定任何评分或扣分。
 */
export async function analyzeExpressionIntent(
  llm: LLMProvider,
  turn: TranscriptTurn,
  scenarioContext: string
): Promise<ExpressionIntent> {
  try {
    const result = await llm.chat(
      [
        {
          role: 'system',
          content: [
            '你是语音表达分析器。你必须分别判断表达方式和表达意图，不做评分，不决定是否扣分。',
            'tone 表示表达方式：playful=玩笑、调侃、角色扮演，serious=认真、非玩笑，uncertain=无法确定。',
            'intent 表示表达意图：promise=对现实结果作保证或承诺，threat=威胁或强迫，persuasion=劝说或引导，request=请求，question=提问，inform=陈述或说明，other=其他。',
            'tone 与 intent 不互斥：任何 intent 都可以是 playful 或 serious。玩笑式承诺、玩笑式威胁、玩笑式强迫、玩笑式劝说都是合法的识别结果，不得把 playful 和 promise 当成二选一。',
            '判断规则：',
            '1. 虚构台词和角色扮演是 playful 的重要证据。模仿孩子、客户、动物或另一角色说话，虚构未来角色的台词，是在营造画面感，不等同说话人本人在承诺现实结果。',
            '2. 夸张和戏剧化表达可以属于 playful，不要求有笑声。模仿、儿童腔、卡通化、拖长音、音调突变、表演性停顿、荒诞或不可能的描述都可作为辅助证据；没有笑声不能推出 serious。',
            '3. intent 必须结合真实语义判断。只有说话人以自己的立场对真实课程效果、现实结果或客户收益作保证时才是 promise；如果只是角色台词，通常属于 persuasion、inform 或其他，而非本人 promise。',
            '4. 示例：“孩子过来以后，一定会跟您说：爸爸/妈妈，围棋太好玩了，我要学围棋”具有虚构角色台词和夸张幽默特征，可以是 tone=playful、intent=persuasion，不要误写成 promise；也不要因为出现“一定”就机械判定。',
            '5. 不要机械数关键词，先判断是不是角色台词，再判断本人真实意图。语音数据只是辅助，不得虚构语气结论；证据冲突或不足时对应维度用 uncertain。',
            '只输出 JSON：{"tone":"playful|serious|uncertain","intent":"promise|threat|persuasion|request|question|inform|other","confidence":0到1,"rationale":"分别说明语气与意图的理由"}',
          ].join('\n'),
        },
        {
          role: 'user',
          content: `场景：${scenarioContext}\n用户原话：${turn.text}\n语音辅助数据：\n${prosodyLines(turn)}`,
        },
      ],
      { jsonMode: true, temperature: 0 }
    );
    const parsed = JSON.parse(result.content) as { tone?: ExpressionTone; intent?: ExpressionIntentKind; confidence?: number; rationale?: string };
    return {
      tone: VALID_TONES.includes(parsed.tone as ExpressionTone) ? parsed.tone as ExpressionTone : 'uncertain',
      intent: VALID_INTENTS.includes(parsed.intent as ExpressionIntentKind) ? parsed.intent as ExpressionIntentKind : 'other',
      confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
      rationale: String(parsed.rationale ?? '无法确定表达意图'),
    };
  } catch {
    return { tone: 'uncertain', intent: 'other', confidence: 0, rationale: '表达意图分析失败，无法确定' };
  }
}
