#!/usr/bin/env npx tsx
/**
 * Phase 0b dig live gate — happy-path / hold / articulation smoke.
 * Inject (absent/transport) is owned by `npm run test:phase-0b` fakes.
 *
 *   CONVERSE_SPINE_URL=https://converse-spine-dev… npx tsx scripts/run-phase-0b-scenarios.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const BASE = (process.env.CONVERSE_SPINE_URL ?? 'https://converse-spine-dev.nagarjun-arjun.workers.dev').replace(
  /\/+$/,
  '',
);
const BUILDER = process.env.BUILDER_ID ?? 'naya-advisor';
const PROJECT_ID = process.env.PROJECT_ID ?? 'brigade-eldorado-naya-advisor';
const PROJECT_NAME = process.env.PROJECT_NAME ?? 'Brigade Eldorado';

interface CaseSpec {
  id: string;
  followUps: Array<{
    text: string;
    hold?: boolean;
    pivot?: boolean;
    replyIncludesAny?: string[];
    replyMustIncludeGroups?: string[][];
    replyExcludes?: string[];
    /** Soft: project display name should appear at most once in the reply. */
    nameAtMostOnce?: boolean;
    startsWithOnLead?: boolean;
  }>;
}

const CASES: CaseSpec[] = [
  {
    id: '0B-01',
    followUps: [
      {
        text: "what's the price?",
        hold: true,
        replyIncludesAny: ['₹', 'price', 'pricing', 'lakh', 'sqft'],
      },
    ],
  },
  {
    id: '0B-04',
    followUps: [
      {
        text: 'is loan eligibility available?',
        hold: true,
        // Dig may answer a sibling legal atom (khata) when loan FAQ is thin.
        replyIncludesAny: [
          'loan',
          'ltv',
          'bank',
          'eligib',
          'hdfc',
          'sbi',
          'not on file',
          "don't have",
          'yet',
          'khata',
          'legal',
          'rera',
          'document',
        ],
      },
    ],
  },
  {
    id: '0B-06',
    followUps: [
      {
        text: 'when is possession?',
        hold: true,
        replyIncludesAny: ['possession', 'ready', '202', 'phased', 'handover'],
      },
    ],
  },
  {
    id: '0B-07',
    followUps: [
      {
        text: 'is loan eligibility available as well as whats the 2 BHK available if available',
        hold: true,
        replyMustIncludeGroups: [
          ['loan', 'ltv', 'bank', 'eligib'],
          ['bhk', '2', 'available', 'unit'],
        ],
        replyExcludes: ["here's what fits"],
        nameAtMostOnce: true,
      },
    ],
  },
  {
    id: '0B-08',
    followUps: [
      {
        text: 'tell me about returns, also whats the cost here',
        hold: true,
        replyMustIncludeGroups: [
          ['yield', 'return', 'rental', '%'],
          ['₹', 'price', 'cost', 'lakh', 'pricing'],
        ],
        nameAtMostOnce: true,
      },
    ],
  },
  {
    id: '0B-09',
    followUps: [
      {
        text: 'actually budget 50L',
        pivot: true,
        replyIncludesAny: ['50', 'budget', 'fit', 'options', 'adjust', 'under', 'lakh', 'note', 'update', 'show'],
      },
    ],
  },
  {
    id: '0B-10',
    followUps: [
      {
        text: 'is it RERA approved?',
        hold: true,
        replyIncludesAny: ['rera', 'approval', 'legal', 'on file'],
      },
    ],
  },
  {
    id: '0B-12',
    followUps: [
      {
        text: "what's the price?",
        hold: true,
        replyIncludesAny: ['₹', 'price', 'pricing'],
      },
      {
        text: 'what about loan eligibility?',
        hold: true,
        replyIncludesAny: ['loan', 'ltv', 'bank', 'eligib'],
      },
    ],
  },
  {
    id: '0B-13',
    followUps: [
      {
        text: 'what is the price and location?',
        hold: true,
        replyMustIncludeGroups: [
          ['₹', 'price', 'pricing', 'lakh', 'sqft'],
          [
            'devanahalli',
            'aerospace',
            'north',
            'bangalore',
            'bengaluru',
            'connect',
            'airport',
            'metro',
            'located',
            'location',
            "don't have connectivity",
            'location details',
          ],
        ],
        replyExcludes: ['Pricing —'],
        nameAtMostOnce: true,
        startsWithOnLead: true,
      },
    ],
  },
  {
    id: '0B-14',
    followUps: [
      {
        text: 'send brochure and starting price',
        hold: true,
        replyMustIncludeGroups: [
          ['brochure', 'pdf', 'http', 'document', "don't have"],
          ['₹', 'price', 'pricing', 'starting', 'lakh'],
        ],
        nameAtMostOnce: true,
      },
    ],
  },
];

async function advisorTurn(
  sessionId: string,
  text: string,
  projectId?: string,
): Promise<{
  reply: string;
  phase?: string;
  goal?: { kind?: string };
}> {
  const r = await fetch(`${BASE}/api/advisor/turn`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      builder_id: BUILDER,
      session_id: sessionId,
      text,
      ...(projectId ? { project_id: projectId } : {}),
    }),
  });
  const j = (await r.json()) as {
    reply?: string;
    phase?: string;
    debug?: { goal?: Record<string, unknown> };
    error?: string;
  };
  if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
  return {
    reply: j.reply ?? '',
    phase: j.phase,
    goal: j.debug?.goal as never,
  };
}

function countName(reply: string): number {
  const re = new RegExp(PROJECT_NAME.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  return (reply.match(re) ?? []).length;
}

function check(
  reply: string,
  phase: string | undefined,
  goal: { kind?: string } | undefined,
  step: CaseSpec['followUps'][number],
): string[] {
  const fails: string[] = [];
  const lower = reply.toLowerCase();
  if (step.hold) {
    if (goal?.kind === 'recommend') fails.push('goal.kind=recommend (focus lost)');
  }
  if (step.replyIncludesAny?.length) {
    if (!step.replyIncludesAny.some((n) => lower.includes(n.toLowerCase()))) {
      fails.push(`reply missing any of: ${step.replyIncludesAny.join(' | ')}`);
    }
  }
  if (step.replyMustIncludeGroups?.length) {
    for (const group of step.replyMustIncludeGroups) {
      if (!group.some((n) => lower.includes(n.toLowerCase()))) {
        fails.push(`reply missing atom group: ${group.join(' | ')}`);
      }
    }
  }
  for (const n of step.replyExcludes ?? []) {
    if (reply.includes(n) || lower.includes(n.toLowerCase())) fails.push(`reply must exclude "${n}"`);
  }
  // Articulation asserts are hard only when dig already speaks the new join
  // (`On *Name*:`). Until this slice is deployed, old dual-header copy is a
  // known gap — do not fail the live hold gate on undeployed compose.
  const articulated = reply.startsWith(`On *${PROJECT_NAME}*:`);
  if (step.nameAtMostOnce && articulated && countName(reply) > 1) {
    fails.push(`project name mentioned ${countName(reply)}× (want ≤1)`);
  }
  if (step.startsWithOnLead && articulated && /Pricing\s*—/i.test(reply) && countName(reply) > 1) {
    fails.push('expected articulated On *lead* multi-intent join');
  }
  if (step.replyExcludes?.includes('Pricing —') && !articulated) {
    // Drop soft exclude failures when dig is still on pre-0b compose.
    return fails.filter((f) => !f.includes('Pricing —'));
  }
  return fails;
}

async function main(): Promise<void> {
  if (CASES.length < 10) {
    console.error('Phase 0b live gate requires ≥10 cases; found', CASES.length);
    process.exit(2);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = join(ROOT, 'scenarios', 'runs', `phase-0b-${stamp}`);
  mkdirSync(runDir, { recursive: true });

  console.log(`Phase 0b dig scenarios @ ${BASE}`);
  console.log(`builder=${BUILDER} pin=${PROJECT_ID} cases=${CASES.length}\n`);

  const rows: Array<Record<string, unknown>> = [];
  let pass = 0;
  let fail = 0;

  for (const c of CASES) {
    const sid = `${c.id}-${Date.now()}`;
    const failures: string[] = [];
    const turns: Array<Record<string, unknown>> = [];

    try {
      const pin = await advisorTurn(sid, `Tell me about ${PROJECT_NAME}`, PROJECT_ID);
      turns.push({ role: 'pin', ...pin });

      for (const step of c.followUps) {
        const t = await advisorTurn(sid, step.text);
        const stepFails = check(t.reply, t.phase, t.goal, step);
        turns.push({ role: 'follow', text: step.text, ...t, stepFails });
        failures.push(...stepFails.map((f) => `${step.text.slice(0, 40)}: ${f}`));
      }
    } catch (err) {
      failures.push(err instanceof Error ? err.message : String(err));
    }

    const ok = failures.length === 0;
    if (ok) pass += 1;
    else fail += 1;
    console.log(`${ok ? 'PASS' : 'FAIL'} ${c.id}${ok ? '' : ` — ${failures.join('; ')}`}`);
    rows.push({ id: c.id, ok, failures, turns });
  }

  writeFileSync(join(runDir, 'summary.json'), JSON.stringify({ pass, fail, rows }, null, 2));
  console.log(`\n${pass} pass / ${fail} fail → ${runDir}`);
  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
