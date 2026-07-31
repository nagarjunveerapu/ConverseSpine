#!/usr/bin/env npx tsx
/**
 * Live focus-hold major-fix regression (≥10 complex prior-stage scenarios).
 *
 * Default: Advisor dig path (pin project → complex follow-up).
 * Also runnable via buyer /chat JSON:
 *   CONVERSE_SPINE_URL=… npm run test:scenarios -- --only W3-FH-01,W3-FH-02,…
 *
 *   CONVERSE_SPINE_URL=https://converse-spine-dev… npx tsx scripts/run-focus-hold-regression.ts
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
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
  /** Turns after the pin turn (pin is always first). */
  followUps: Array<{
    text: string;
    /** Must stay focused / answer (not recommend shortlist). */
    hold?: boolean;
    /** Explicit pivot — may leave focus. */
    pivot?: boolean;
    /** Soft OR — at least one (legacy). Prefer replyMustIncludeGroups. */
    replyIncludesAny?: string[];
    /**
     * Hard multi-atom: EVERY group must match at least one needle.
     * Stops "loan OR photo" from passing when only photo answered.
     */
    replyMustIncludeGroups?: string[][];
    replyExcludes?: string[];
  }>;
}

/** Complex prior-stage cases — append new major-fix phrases here. */
const CASES: CaseSpec[] = [
  {
    id: 'W3-FH-01',
    followUps: [
      {
        text: 'is loan eligibility available as well as whats the 2 BHK available if available',
        hold: true,
        replyIncludesAny: ['loan', 'ltv', 'bank', 'bhk', 'eligib', '2'],
        replyExcludes: ["here's what fits", 'want to adjust budget'],
      },
    ],
  },
  {
    id: 'W3-FH-02',
    followUps: [
      {
        text: 'what is the price and connectivity?',
        hold: true,
        replyMustIncludeGroups: [
          ['₹', 'price', 'sqft', 'pricing'],
          // Real LI OR honest connectivity miss (naya-advisor Eldorado can lack micro_market).
          [
            'devanahalli',
            'aerospace',
            'connect',
            'airport',
            'metro',
            'corridor',
            'nearby',
            "don't have connectivity",
            'location details',
          ],
        ],
        replyExcludes: ["here's what fits"],
      },
    ],
  },
  {
    id: 'W3-FH-03',
    followUps: [
      {
        text: 'loan eligibility? also send photos',
        hold: true,
        replyMustIncludeGroups: [
          ['loan', 'bank', 'ltv', 'eligib'],
          ['photo', 'image', 'brochure', 'http', "don't have", 'not on file'],
        ],
      },
    ],
  },
  {
    id: 'W3-FH-04',
    followUps: [
      {
        text: 'tell me about returns, also whats the cost here',
        hold: true,
        replyMustIncludeGroups: [
          ['return', 'yield', 'rent', "don't quote", "don't have", 'on file'],
          ['₹', 'price', 'pricing', 'cost', 'sqft'],
        ],
        replyExcludes: ["here's what fits"],
      },
    ],
  },
  {
    id: 'W3-FH-05',
    followUps: [
      {
        text: 'nearby schools and when ready?',
        hold: true,
        replyExcludes: ['available configurations', "here's what fits", 'want pricing on a specific size'],
      },
    ],
  },
  {
    id: 'W3-FH-06',
    followUps: [
      {
        text: 'when is possession',
        hold: true,
        replyMustIncludeGroups: [['possession', 'handover', 'delivery', 'june 2028', 'phase-wise']],
        replyExcludes: ["here's what fits", 'apartments in'],
      },
    ],
  },
  {
    id: 'W3-FH-07',
    followUps: [
      {
        text: 'has this area appreciated',
        hold: true,
        replyExcludes: ["here's what fits", 'want to adjust budget'],
      },
    ],
  },
  {
    id: 'W3-FH-08',
    followUps: [
      {
        text: 'actually my budget is only 50L',
        pivot: true,
        replyIncludesAny: ['45', '50', 'budget', 'cornerstone', 'fit', 'options', 'under', '₹'],
      },
    ],
  },
  {
    id: 'W3-FH-09',
    followUps: [
      {
        text: '2 BHK in Jayanagar',
        pivot: true,
        replyExcludes: ['available configurations'],
      },
    ],
  },
  {
    id: 'W3-FH-10',
    followUps: [
      {
        text: 'show me other projects in Whitefield',
        pivot: true,
        replyIncludesAny: ['whitefield', 'options', 'fit', 'project', 'here'],
      },
    ],
  },
  {
    id: 'W3-FH-11',
    followUps: [
      {
        text: 'is it RERA approved and can I get a loan?',
        hold: true,
        replyMustIncludeGroups: [
          ['rera'],
          ['loan', 'bank', 'ltv'],
        ],
        replyExcludes: ["here's what fits"],
      },
    ],
  },
  {
    id: 'W3-FH-12',
    followUps: [
      {
        text: "what's the price?",
        hold: true,
        replyIncludesAny: ['₹', 'price', 'pricing'],
      },
      {
        text: 'whats the 2 BHK available and loan eligibility for this project?',
        hold: true,
        replyMustIncludeGroups: [
          ['loan', 'bank', 'ltv', 'eligib'],
          ['bhk', 'sqft'],
        ],
        replyExcludes: ["here's what fits"],
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
  goal?: { kind?: string; topic?: string; projectId?: string; topics?: string[]; requires?: string[] };
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
    if (phase === 'discover' && goal?.kind === 'recommend') {
      fails.push('phase=discover+recommend after focused pin');
    }
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
    if (lower.includes(n.toLowerCase())) fails.push(`reply must exclude "${n}"`);
  }
  return fails;
}

async function main(): Promise<void> {
  if (CASES.length < 10) {
    console.error('Focus-hold regression requires ≥10 cases; found', CASES.length);
    process.exit(2);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = join(ROOT, 'scenarios', 'runs', `focus-hold-${stamp}`);
  mkdirSync(runDir, { recursive: true });

  console.log(`Focus-hold major-fix regression @ ${BASE}`);
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
        failures.push(...stepFails.map((f) => `${step.text.slice(0, 40)}…: ${f}`));
        turns.push({ role: 'follow', text: step.text, ...t, stepFails });
      }
    } catch (e) {
      failures.push(e instanceof Error ? e.message : String(e));
    }

    const ok = failures.length === 0;
    if (ok) pass++;
    else fail++;
    const mark = ok ? 'PASS' : 'FAIL';
    console.log(`${mark} ${c.id}  ${failures[0] ?? 'ok'}`);
    if (!ok) {
      for (const f of failures.slice(0, 4)) console.log(`       - ${f}`);
    }
    rows.push({ id: c.id, ok, failures, turns });
  }

  writeFileSync(join(runDir, 'summary.json'), JSON.stringify({ base: BASE, pass, fail, rows }, null, 2));
  console.log(`\n${pass}/${pass + fail} passed → ${runDir}`);
  // Also stamp which buyer JSON ids mirror these cases.
  const buyerPath = join(ROOT, 'scenarios', 'buyer', 'W3-FOCUS-HOLD-REGRESSION.json');
  try {
    const buyer = JSON.parse(readFileSync(buyerPath, 'utf8')) as Array<{ id: string }>;
    console.log(`Buyer JSON mirror: ${buyer.map((b) => b.id).join(', ')}`);
  } catch {
    /* optional */
  }
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
