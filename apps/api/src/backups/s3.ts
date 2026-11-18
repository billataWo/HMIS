/**
 * The little of S3 the nightly backup needs (put, get, list, delete), signed with AWS Signature V4
 * (aws4fetch's signer) and sent with node:http(s) so a file can be streamed with its length:
 * fetch() cannot set Content-Length on a stream, and S3 refuses uploads without it. Path-style
 * URLs (endpoint/bucket/key) work with AletCloud, MinIO and AWS.
 */
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import type { Readable } from 'node:stream';
import { AwsV4Signer } from 'aws4fetch';

export type S3Config = { endpoint: string; bucket: string; accessKeyId: string; secretAccessKey: string; region: string };
export type S3Object = { key: string; size: number; lastModified: string };

export class S3Error extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const encodeKey = (key: string) => key.split('/').map(encodeURIComponent).join('/');
const xmlText = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

export class S3Store {
  constructor(private readonly cfg: S3Config) {}

  get location() {
    return `${new URL(this.cfg.endpoint).host}/${this.cfg.bucket}`;
  }

  private url(key = '', query = '') {
    const base = this.cfg.endpoint.replace(/\/+$/, '');
    return `${base}/${encodeURIComponent(this.cfg.bucket)}${key ? `/${encodeKey(key)}` : ''}${query ? `?${query}` : ''}`;
  }

  /** Sends a signed request; `body` is streamed with the given length. Resolves with the response stream. */
  private async send(method: string, url: string, body?: { stream: Readable; length: number }): Promise<http.IncomingMessage> {
    const signed = await new AwsV4Signer({
      method,
      url,
      service: 's3',
      region: this.cfg.region,
      accessKeyId: this.cfg.accessKeyId,
      secretAccessKey: this.cfg.secretAccessKey,
    }).sign();
    const headers: Record<string, string> = {};
    signed.headers.forEach((v, k) => (headers[k] = v));
    if (body) headers['content-length'] = String(body.length);
    const u = new URL(url);
    const res = await new Promise<http.IncomingMessage>((resolve, reject) => {
      const req = (u.protocol === 'https:' ? https : http).request(u, { method, headers, timeout: 120_000 }, resolve);
      req.on('timeout', () => req.destroy(new Error(`${method} ${u.pathname}: no answer from the storage for 2 minutes`)));
      req.on('error', reject);
      if (body) {
        body.stream.on('error', (e) => req.destroy(e));
        body.stream.pipe(req);
      } else req.end();
    });
    const status = res.statusCode ?? 0;
    if (status >= 300) {
      let text = '';
      for await (const chunk of res) text += chunk;
      const code = /<Code>([^<]*)<\/Code>/.exec(text)?.[1];
      const message = /<Message>([^<]*)<\/Message>/.exec(text)?.[1];
      throw new S3Error(`Storage refused ${method} (${status}${code ? ` ${code}` : ''}${message ? `: ${xmlText(message)}` : ''})`, status);
    }
    return res;
  }

  async putFile(key: string, file: string) {
    const { size } = await stat(file);
    const res = await this.send('PUT', this.url(key), { stream: createReadStream(file), length: size });
    res.resume();
    return size;
  }

  /** The object's content as a stream. */
  async get(key: string): Promise<Readable> {
    return this.send('GET', this.url(key));
  }

  async delete(key: string) {
    (await this.send('DELETE', this.url(key))).resume();
  }

  /** Every object under the prefix (ListObjectsV2, following continuation tokens). */
  async list(prefix: string): Promise<S3Object[]> {
    const out: S3Object[] = [];
    let token: string | undefined;
    do {
      const q = new URLSearchParams({ 'list-type': '2', prefix, ...(token && { 'continuation-token': token }) });
      // Signature V4 needs the query sorted.
      const query = [...q.entries()]
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join('&');
      let xml = '';
      for await (const chunk of await this.send('GET', this.url('', query))) xml += chunk;
      for (const m of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
        const field = (name: string) => new RegExp(`<${name}>([^<]*)</${name}>`).exec(m[1])?.[1] ?? '';
        out.push({ key: xmlText(field('Key')), size: Number(field('Size')), lastModified: field('LastModified') });
      }
      token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? xmlText(/<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(xml)?.[1] ?? '') || undefined : undefined;
    } while (token);
    return out;
  }
}

/**
 * The bucket from the environment: HMIS_BACKUP_S3_* or, as AletCloud's "connect bucket to app"
 * sets them, AWS_ENDPOINT_URL_S3 / S3_BUCKET / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_REGION.
 */
export function s3FromEnv(env: NodeJS.ProcessEnv = process.env): S3Config | null {
  const endpoint = env.HMIS_BACKUP_S3_ENDPOINT || env.AWS_ENDPOINT_URL_S3;
  const bucket = env.HMIS_BACKUP_S3_BUCKET || env.S3_BUCKET;
  const accessKeyId = env.HMIS_BACKUP_S3_ACCESS_KEY || env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = env.HMIS_BACKUP_S3_SECRET_KEY || env.AWS_SECRET_ACCESS_KEY;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  return { endpoint, bucket, accessKeyId, secretAccessKey, region: env.HMIS_BACKUP_S3_REGION || env.AWS_REGION || 'us-east-1' };
}
