/** 语音网关接口：ASR/TTS 抽象，供服务端语音对练（HTTP 批量 + WebSocket 流式）使用 */

/** 流式 ASR 会话：客户端按块写入 PCM16 LE 16kHz mono 音频 */
export interface ASRStream {
  /** 写入一块音频（PCM16 LE 16kHz mono） */
  write(chunk: Buffer): void;
  /** 用户说完了：触发最终识别结果（onFinal） */
  finish(): void;
  /** 释放底层连接/资源（幂等） */
  close(): void;
}

export interface ASRStreamHandlers {
  /** 中间识别结果（可变） */
  onPartial(text: string): void;
  /** 最终识别结果（本轮说话结束） */
  onFinal(text: string): void;
  onError(err: Error): void;
}

export interface ASRProvider {
  name: string;
  /** 一期批量：整段音频一次性识别。format 如 'wav' / 'mp3' / 'pcm' */
  transcribe(audio: Buffer, format: string): Promise<string>;
  /** 二期流式：创建一路实时识别会话 */
  createStream(handlers: ASRStreamHandlers): ASRStream;
}

export interface TTSOptions {
  /** 音色覆盖（缺省用 provider 默认） */
  voice?: string;
  /** 情绪唤醒度 0~1（persona 当前 arousal）：高唤醒 → 语速快、音调高 */
  arousal?: number;
}

export interface TTSResult {
  audio: Buffer;
  /** 'wav' / 'mp3' 等容器格式 */
  format: string;
}

export interface TTSProvider {
  name: string;
  /** 非流式合成：整句进、整段音频出（流式播放由调用方按句切分多次调用） */
  synthesize(text: string, opts?: TTSOptions): Promise<TTSResult>;
  /** 流式合成：文本进、音频分块出（首音频延迟更低，适用于实时通话） */
  synthesizeStream(text: string, opts?: TTSOptions): AsyncIterable<TTSChunk>;
}

/** 流式 TTS 音频块 */
export interface TTSChunk {
  /** 音频数据（PCM/WAV 等容器格式） */
  audio: Buffer;
  /** 是否为本句最后一块 */
  isFinal: boolean;
  /** 音频容器格式 */
  format: string;
}

export interface SpeechGateway {
  asr: ASRProvider;
  tts: TTSProvider;
}
