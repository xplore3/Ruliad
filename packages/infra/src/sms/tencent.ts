import crypto from 'node:crypto';
import https from 'node:https';

export interface TencentSendSmsInput {
  phoneNumbers: string[];
  smsSdkAppId: string;
  signName: string;
  templateId: string;
  templateParams?: string[];
}

export interface TencentSendSmsResponse {
  SendStatusSet?: Array<{
    Code: string;
    Message: string;
    PhoneNumber: string;
  }>;
  RequestId: string;
  Error?: {
    Code: string;
    Message: string;
  };
}

/**
 * 腾讯云短信服务客户端（TC3-HMAC-SHA256 签名）
 * 文档：https://cloud.tencent.com/document/api/382/38778
 */
export class TencentSmsClient {
  private secretId: string;
  private secretKey: string;
  private endpoint = 'sms.tencentcloudapi.com';
  private service = 'sms';
  private region = 'ap-guangzhou';
  private version = '2021-01-11';
  private action = 'SendSms';

  constructor(secretId: string, secretKey: string) {
    this.secretId = secretId;
    this.secretKey = secretKey;
  }

  async sendSms(input: TencentSendSmsInput): Promise<TencentSendSmsResponse> {
    const payload = {
      SmsSdkAppId: input.smsSdkAppId,
      SignName: input.signName,
      TemplateId: input.templateId,
      PhoneNumberSet: input.phoneNumbers,
      TemplateParamSet: input.templateParams || [],
    };

    const payloadJson = JSON.stringify(payload);
    const timestamp = Math.floor(Date.now() / 1000);
    const date = new Date(timestamp * 1000).toISOString().slice(0, 10);

    // 1. 构造规范请求
    const httpRequestMethod = 'POST';
    const canonicalUri = '/';
    const canonicalQueryString = '';
    const canonicalHeaders = `content-type:application/json; charset=utf-8\nhost:${this.endpoint}\nx-tc-action:${this.action.toLowerCase()}\n`;
    const signedHeaders = 'content-type;host;x-tc-action';
    const hashedRequestPayload = this.sha256(payloadJson);
    const canonicalRequest = `${httpRequestMethod}\n${canonicalUri}\n${canonicalQueryString}\n${canonicalHeaders}\n${signedHeaders}\n${hashedRequestPayload}`;

    // 2. 构造待签名字符串
    const algorithm = 'TC3-HMAC-SHA256';
    const credentialScope = `${date}/${this.service}/tc3_request`;
    const hashedCanonicalRequest = this.sha256(canonicalRequest);
    const stringToSign = `${algorithm}\n${timestamp}\n${credentialScope}\n${hashedCanonicalRequest}`;

    // 3. 计算签名
    const secretDate = this.hmacSha256(`TC3${this.secretKey}`, date);
    const secretService = this.hmacSha256(secretDate, this.service);
    const secretSigning = this.hmacSha256(secretService, 'tc3_request');
    const signature = this.hmacSha256Hex(secretSigning, stringToSign);

    // 4. 构造 Authorization
    const authorization = `${algorithm} Credential=${this.secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const requestHeaders: Record<string, string> = {
      'Content-Type': 'application/json; charset=utf-8',
      Host: this.endpoint,
      'X-TC-Action': this.action,
      'X-TC-Version': this.version,
      'X-TC-Timestamp': String(timestamp),
      'X-TC-Region': this.region,
      Authorization: authorization,
    };

    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: this.endpoint,
          port: 443,
          path: '/',
          method: 'POST',
          headers: requestHeaders,
        },
        (res) => {
          let data = '';
          res.on('data', (chunk: Buffer) => (data += chunk));
          res.on('end', () => {
            try {
              const wrapped = JSON.parse(data) as { Response: TencentSendSmsResponse };
              resolve(wrapped.Response);
            } catch {
              reject(new Error(`腾讯云 SMS 返回非 JSON: ${data}`));
            }
          });
        },
      );
      req.on('error', (err: Error) => reject(err));
      req.setTimeout(10000, () => {
        req.destroy();
        reject(new Error('腾讯云 SMS 请求超时'));
      });
      req.write(payloadJson);
      req.end();
    });
  }

  private sha256(message: string): string {
    return crypto.createHash('sha256').update(message).digest('hex');
  }

  private hmacSha256(key: string | Buffer, message: string): Buffer {
    return crypto.createHmac('sha256', key).update(message).digest();
  }

  private hmacSha256Hex(key: Buffer, message: string): string {
    return crypto.createHmac('sha256', key).update(message).digest('hex');
  }
}
