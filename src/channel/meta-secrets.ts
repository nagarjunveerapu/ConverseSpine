import type { Env } from '../env.js';

export function getMetaAppSecret(env: Env, builderId?: string): string | undefined {
  if (builderId && env[`META_APP_SECRET__${builderId}` as keyof Env]) {
    return env[`META_APP_SECRET__${builderId}` as keyof Env] as string;
  }
  return env.META_APP_SECRET;
}

export function getMetaAccessToken(env: Env, builderId?: string): string | undefined {
  if (builderId && env[`META_ACCESS_TOKEN__${builderId}` as keyof Env]) {
    return env[`META_ACCESS_TOKEN__${builderId}` as keyof Env] as string;
  }
  return env.META_ACCESS_TOKEN;
}

export async function verifyMetaWebhookSignature(
  rawBody: string,
  sigHeader: string,
  secret: string,
): Promise<boolean> {
  if (!sigHeader.startsWith('sha256=') || !secret) return false;
  const expected = sigHeader.slice(7);
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return timingSafeEqual(hex, expected);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
