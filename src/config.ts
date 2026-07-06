import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function loadBotSecretFromNayaDesk(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const devVars = join(here, '../../NayaDesk/.dev.vars');
  if (!existsSync(devVars)) return '';
  const line = readFileSync(devVars, 'utf8')
    .split('\n')
    .find((l) => l.startsWith('BOT_SHARED_SECRET='));
  if (!line) return '';
  return line.slice('BOT_SHARED_SECRET='.length).trim();
}

/** Deployed NayaDesk dev worker (shared D1 naya-db-dev). Override with NAYADESK_URL for local wrangler. */
export const NAYADESK_DEV_URL = 'https://nayadesk-dev.nagarjun-arjun.workers.dev';

/** Node CLI / script configuration. Worker uses wrangler Env instead. */
export const nodeConfig = {
  nayadeskUrl: (process.env.NAYADESK_URL ?? NAYADESK_DEV_URL).replace(/\/+$/, ''),
  botSecret: process.env.BOT_SHARED_SECRET ?? loadBotSecretFromNayaDesk(),
  defaultBuilderId: process.env.BUILDER_ID ?? 'lokations',
  defaultBuyerPhone: process.env.BUYER_PHONE ?? '+919990000001',
  deepseekApiKey: process.env.DEEPSEEK_API_KEY ?? '',
};

export function createNodeEnv(): import('./env.js').Env {
  return {
    NAYADESK_URL: nodeConfig.nayadeskUrl,
    BOT_SHARED_SECRET: nodeConfig.botSecret,
    DEFAULT_BUILDER_ID: nodeConfig.defaultBuilderId,
    DEEPSEEK_API_KEY: nodeConfig.deepseekApiKey,
    DEEPSEEK_BASE_URL: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
    DEEPSEEK_MODEL: process.env.DEEPSEEK_MODEL ?? 'deepseek-chat',
    LANGFUSE_PUBLIC_KEY: process.env.LANGFUSE_PUBLIC_KEY,
    LANGFUSE_SECRET_KEY: process.env.LANGFUSE_SECRET_KEY,
    LANGFUSE_BASE_URL: process.env.LANGFUSE_BASE_URL ?? 'https://cloud.langfuse.com',
  };
}
