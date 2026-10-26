/**
 * 陪练员语音（TTS）：浏览器 SpeechSynthesis，零依赖、离线可用。
 * 情绪参数映射：唤醒度越高 → 语速越快、音调越高（对应陪练员"激动/不耐烦"档位）。
 * 与对练页 ASR（Web Speech API）同属浏览器语音能力，微信 WebView 不支持时自动隐藏入口。
 */

export function ttsSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

let voiceCache: SpeechSynthesisVoice | null = null;

function pickZhVoice(): SpeechSynthesisVoice | null {
  if (!ttsSupported()) return null;
  const voices = window.speechSynthesis.getVoices();
  return (
    voices.find((v) => v.lang === 'zh-CN') ??
    voices.find((v) => v.lang.replace('_', '-').startsWith('zh')) ??
    null
  );
}

// Chrome 异步加载语音列表，加载完成后刷新缓存
if (ttsSupported()) {
  window.speechSynthesis.onvoiceschanged = () => {
    voiceCache = pickZhVoice();
  };
}

/** 情绪唤醒度（0-1）→ 韵律参数 */
function prosody(arousal: number | undefined): { rate: number; pitch: number } {
  const a = Math.min(1, Math.max(0, arousal ?? 0.4));
  return {
    rate: 0.95 + a * 0.35, // 0.95 ~ 1.30
    pitch: 0.9 + a * 0.4, // 0.90 ~ 1.30
  };
}

/** 去掉舞台提示（如"（皱眉）"），只播报台词 */
function stripStageDirections(text: string): string {
  return text.replace(/（[^）]*）/g, '').trim();
}

/** 播报陪练员回复；新回复会打断进行中的播报 */
export function speakPersona(text: string, arousal?: number): void {
  if (!ttsSupported()) return;
  const line = stripStageDirections(text);
  if (!line) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(line);
  voiceCache = voiceCache ?? pickZhVoice();
  if (voiceCache) utter.voice = voiceCache;
  utter.lang = voiceCache?.lang ?? 'zh-CN';
  const { rate, pitch } = prosody(arousal);
  utter.rate = rate;
  utter.pitch = pitch;
  window.speechSynthesis.speak(utter);
}

export function stopSpeaking(): void {
  if (ttsSupported()) window.speechSynthesis.cancel();
}
