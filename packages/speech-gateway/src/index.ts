export type {
  ASRProvider,
  ASRStream,
  ASRStreamHandlers,
  TTSOptions,
  TTSProvider,
  TTSResult,
  TTSChunk,
  SpeechGateway,
} from './types.js';
export { arousalToTTSParams, type TTSVoiceParams } from './tts-params.js';
export { MockSpeechProvider, MOCK_TRANSCRIPT, makeSineWav } from './providers/mock.js';
export { AliyunSpeechProvider, type AliyunSpeechConfig } from './providers/aliyun.js';
export { createSpeechGateway } from './gateway.js';
