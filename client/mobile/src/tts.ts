import api from './api';

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

if (ttsSupported()) {
  window.speechSynthesis.onvoiceschanged = () => {
    voiceCache = pickZhVoice();
  };
}

function prosody(arousal: number | undefined): { rate: number; pitch: number } {
  const a = Math.min(1, Math.max(0, arousal ?? 0.4));
  return {
    rate: 0.95 + a * 0.35,
    pitch: 0.9 + a * 0.4,
  };
}

function stripStageDirections(text: string): string {
  return text.replace(/（[^）]*）/g, '').trim();
}

/**
 * 使用服务端 TTS 合成 persona 声音并播放。
 * 如果服务端不可用，回退到浏览器默认语音（Web Speech API）。
 */
export async function speakServerPersona(sessionId: string, text: string, arousal?: number): Promise<void> {
  const line = stripStageDirections(text);
  if (!line) return;
  try {
    const res = await api.post<{ audioBase64: string; audioFormat: string }>(`/sessions/${sessionId}/tts`, { text: line, arousal });
    const el = new Audio(`data:audio/${res.data.audioFormat};base64,${res.data.audioBase64}`);
    el.onerror = () => speakBrowserPersona(line, arousal);
    await el.play().catch(() => speakBrowserPersona(line, arousal));
  } catch {
    // 服务端不可用，回退到浏览器语音
    speakBrowserPersona(line, arousal);
  }
}

/**
 * 使用浏览器 Web Speech API 合成语音（后备方案）。
 */
export function speakPersona(text: string, arousal?: number): void {
  speakBrowserPersona(text, arousal);
}

/**
 * 使用浏览器 Web Speech API 合成语音。
 */
function speakBrowserPersona(text: string, arousal?: number): void {
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
