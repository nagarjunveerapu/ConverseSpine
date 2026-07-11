#!/usr/bin/env npx tsx
/**
 * Run CONVERSATION_QUALITY_SCENARIO_CATALOG sections A–H against Dev.
 * Writes section scores + findings stub (no product fixes).
 *
 *   CONVERSE_SPINE_URL=https://converse-spine-dev... npx tsx scripts/run-quality-catalog-AH.ts
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SPINE = (process.env.CONVERSE_SPINE_URL ?? 'https://converse-spine-dev.nagarjun-arjun.workers.dev').replace(
  /\/+$/,
  '',
);

/** Section → scenario ids (buyer JSON ids + special advisor/smoke ids). */
const SECTIONS: Record<string, string[]> = {
  A: ['MED-01', 'MED-02', 'MED-03', 'MED-04'],
  B: ['PIV-01', 'PIV-02', 'PIV-03', 'PIV-04', 'BUYER-BRG-02'],
  C: ['SW-01', 'SW-02', 'SW-03', 'SW-04', 'V06'],
  D: ['VIS-01', 'VIS-02', 'VIS-03', 'VIS-04', 'VIS-05', 'SA-G02', 'SA-G02b', 'BUYER-LOK-02'],
  E: ['STY-01', 'STY-02', 'STY-03', 'STY-04'],
  F: ['EXP-01', 'EXP-02', 'NOV-01', 'NOV-02', 'NOV-03', 'ADV-F01', 'MEM-G01'],
  G: ['HIN-01', 'HIN-02', 'HIN-03', 'HIN-04', 'HIN-05', 'HIN-06', 'ADV-H01', 'ADV-H02', 'ADV-H03'],
  H: [
    'SA-G01',
    'SA-G02',
    'SA-G02b',
    'SA-G03',
    'SA-LEGAL',
    'SA-CLARIFY-PICK',
    'ADV-F01',
    'ADV-H01',
    'ADV-H02',
    'ADV-H03',
    'ADV-H04',
    'ADV-H05',
    'ADV-BAML-01',
    'RTI-G02',
    'MEM-G01',
    'UE-01',
    'UE-02',
    'UE-03',
    'UE-04',
    'UE-05',
    'V01',
    'V04',
    'V06',
    'BUYER-LOK-01',
    'BUYER-LOK-02',
    'BUYER-BRG-01',
    'BUYER-BRG-02',
    'P7-SMOKE',
  ],
};

type AssertSpec = {
  reply_includes?: string[];
  reply_excludes?: string[];
  speech_act?: string;
  goal_kind?: string;
  goal_topic?: string;
  phase?: string;
  /** true → expect media URL or whatsapp_actions; false → honest no-media ok */
  expect_media?: boolean | 'optional';
};

type Turn = { text: string; assert?: AssertSpec };
type Scenario = {
  id: string;
  title: string;
  builder_id: string;
  channel?: 'chat' | 'advisor';
  tags?: string[];
  turns: Turn[];
};

type FieldProvenance =
  | 'regex'
  | 'llm'
  | 'embedder'
  | 'bridge'
  | 'ingress_blocked'
  | 'chip_skip'
  | 'override'
  | 'chip_resolve'
  | 'baml';

type ExtractProvenance = {
  path?: string;
  fields?: Partial<Record<string, FieldProvenance>>;
  speech_act?: string;
  chip_path_ids?: string[];
  baml?: {
    mode?: string;
    called?: boolean;
    would_fill?: string[];
    disagree?: string[];
    confidence?: string;
  };
};

type LayerHit = {
  /** Dominant extract layer for this turn (priority: baml > embedder > regex > chip_* > other). */
  dominant: string;
  field_counts: Record<string, number>;
  fields: Partial<Record<string, FieldProvenance>>;
  speech_act?: string;
  chip_path_ids?: string[];
  baml_called?: boolean;
  baml_confidence?: string;
  baml_would_fill?: string[];
  extract_path?: string;
  classifier_intent?: string;
};

type TurnRec = {
  index: number;
  buyer: string;
  reply: string;
  pass: boolean;
  failures: string[];
  goal?: unknown;
  phase?: string;
  tools?: string[];
  has_media?: boolean;
  layer?: LayerHit;
  extract_provenance?: ExtractProvenance;
};

type ScenRec = {
  id: string;
  section?: string;
  title: string;
  channel: string;
  ok: boolean;
  turns: TurnRec[];
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function loadBuyerJson(): Map<string, Scenario> {
  const dir = join(ROOT, 'scenarios', 'buyer');
  const map = new Map<string, Scenario>();
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    const raw = JSON.parse(readFileSync(join(dir, f), 'utf8')) as Scenario | Scenario[];
    for (const s of Array.isArray(raw) ? raw : [raw]) {
      map.set(s.id, { ...s, channel: s.channel ?? 'chat' });
    }
  }
  return map;
}

async function chatTurn(
  builderId: string,
  phone: string,
  text: string,
  convId?: string,
): Promise<{
  reply: string;
  conversation_id: string;
  debug: Record<string, unknown>;
  whatsapp_actions?: unknown;
  tools?: string[];
}> {
  const r = await fetch(`${SPINE}/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      builder_id: builderId,
      buyer_phone: phone,
      text,
      ...(convId ? { conversation_id: convId } : {}),
    }),
  });
  const body = (await r.json()) as Record<string, unknown>;
  if (!r.ok) throw new Error(String(body.error ?? `HTTP ${r.status}`));
  const debug = (body.debug as Record<string, unknown>) ?? {};
  return {
    reply: String(body.reply_text ?? body.reply ?? ''),
    conversation_id: String(body.conversation_id ?? ''),
    debug,
    whatsapp_actions: body.whatsapp_actions,
    tools: (debug.tools as string[]) ?? [],
  };
}

async function advisorTurn(
  sessionId: string,
  text: string,
  opts?: { prefs?: boolean },
): Promise<{ reply: string; body: Record<string, unknown> }> {
  const prefs = {
    purpose: 'Self-use',
    budget: '₹1–1.5 Cr',
    property_type: 'Apartment',
    bhk: '3 BHK',
    location: 'Whitefield',
  };
  const payload: Record<string, unknown> = { session_id: sessionId, text };
  if (opts?.prefs) payload.preferences = prefs;
  const r = await fetch(`${SPINE}/api/advisor/turn`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = (await r.json()) as Record<string, unknown>;
  if (!r.ok) throw new Error(String(body.error ?? `HTTP ${r.status}`));
  return { reply: String(body.reply ?? ''), body };
}

function hasMediaSignal(reply: string, actions: unknown, tools: string[]): boolean {
  if (/https?:\/\/\S+\.(pdf|jpg|jpeg|png|mp4)/i.test(reply)) return true;
  if (/cdn\.|brochure.*http|http.*brochure/i.test(reply)) return true;
  if (Array.isArray(actions) && actions.length > 0) return true;
  if (tools.some((t) => /media|brochure|share/i.test(t))) return true;
  return false;
}

const LAYER_PRIORITY = [
  'baml',
  'llm',
  'embedder',
  'regex',
  'override',
  'chip_resolve',
  'bridge',
  'chip_skip',
  'ingress_blocked',
] as const;

function summarizeLayer(
  debug: Record<string, unknown>,
  opts?: { advisorLimited?: boolean },
): LayerHit | undefined {
  const prov = debug.extract_provenance as ExtractProvenance | undefined;
  if (!prov && opts?.advisorLimited) {
    return {
      dominant: 'advisor_debug_omits_provenance',
      field_counts: {},
      fields: {},
      classifier_intent: (debug.classifier as { intent?: string } | undefined)?.intent,
    };
  }
  if (!prov) return undefined;
  const fields = prov.fields ?? {};
  const field_counts: Record<string, number> = {};
  for (const v of Object.values(fields)) {
    if (!v) continue;
    field_counts[v] = (field_counts[v] ?? 0) + 1;
  }
  let dominant = 'none';
  for (const layer of LAYER_PRIORITY) {
    if ((field_counts[layer] ?? 0) > 0) {
      dominant = layer;
      break;
    }
  }
  if (dominant === 'none' && prov.path === 'chip_skip') dominant = 'chip_skip';
  const classifier = debug.classifier as { intent?: string } | undefined;
  return {
    dominant,
    field_counts,
    fields,
    speech_act: prov.speech_act ?? (typeof debug.speech_act === 'string' ? debug.speech_act : undefined),
    chip_path_ids: prov.chip_path_ids,
    baml_called: prov.baml?.called,
    baml_confidence: prov.baml?.confidence,
    baml_would_fill: prov.baml?.would_fill,
    extract_path: prov.path,
    classifier_intent: classifier?.intent,
  };
}

function layerLine(layer?: LayerHit): string {
  if (!layer) return 'layer=?';
  const parts = Object.entries(layer.field_counts)
    .map(([k, n]) => `${k}:${n}`)
    .join(' ');
  const baml =
    layer.baml_called === true
      ? ` baml=${layer.baml_confidence ?? 'called'}${layer.baml_would_fill?.length ? `(${layer.baml_would_fill.join(',')})` : ''}`
      : layer.baml_called === false
        ? ' baml=no'
        : '';
  return `dom=${layer.dominant} [${parts || 'no-fields'}] sa=${layer.speech_act ?? '?'}${baml}`;
}

function check(
  reply: string,
  debug: Record<string, unknown>,
  a: AssertSpec | undefined,
  media: boolean,
): string[] {
  if (!a) return [];
  const fails: string[] = [];
  const lower = reply.toLowerCase();
  for (const n of a.reply_includes ?? []) {
    if (!lower.includes(n.toLowerCase())) fails.push(`missing "${n}"`);
  }
  for (const n of a.reply_excludes ?? []) {
    if (lower.includes(n.toLowerCase())) fails.push(`unexpected "${n}"`);
  }
  const goal = (debug.goal ?? {}) as { kind?: string; topic?: string };
  if (a.goal_kind && goal.kind && goal.kind !== a.goal_kind) {
    fails.push(`goal.kind=${goal.kind} want ${a.goal_kind}`);
  }
  if (a.goal_topic && goal.topic && goal.topic !== a.goal_topic) {
    fails.push(`goal.topic=${goal.topic} want ${a.goal_topic}`);
  }
  if (a.phase && debug.phase && debug.phase !== a.phase) {
    fails.push(`phase=${String(debug.phase)} want ${a.phase}`);
  }
  if (a.speech_act && debug.speech_act && debug.speech_act !== a.speech_act) {
    fails.push(`speech_act=${String(debug.speech_act)} want ${a.speech_act}`);
  }
  if (a.expect_media === true && !media) {
    const honest = /no brochure|not on file|don't have.*(brochure|floor|pdf)|no floor plan/i.test(reply);
    if (!honest) fails.push('expected media URL/actions or honest no-media');
  }
  return fails;
}

async function runChatScenario(sc: Scenario, section: string): Promise<ScenRec> {
  const phone = `+9198${Date.now().toString().slice(-8)}${sc.id.length % 10}`;
  let conv: string | undefined;
  const turns: TurnRec[] = [];
  let ok = true;
  for (let i = 0; i < sc.turns.length; i++) {
    const t = sc.turns[i]!;
    try {
      const resp = await chatTurn(sc.builder_id, phone, t.text, conv);
      conv = resp.conversation_id || conv;
      const media = hasMediaSignal(resp.reply, resp.whatsapp_actions, resp.tools ?? []);
      const failures = check(resp.reply, resp.debug, t.assert, media);
      const pass = failures.length === 0;
      if (!pass) ok = false;
      const layer = summarizeLayer(resp.debug);
      const prov = resp.debug.extract_provenance as ExtractProvenance | undefined;
      turns.push({
        index: i + 1,
        buyer: t.text,
        reply: resp.reply,
        pass,
        failures,
        goal: resp.debug.goal,
        phase: String(resp.debug.phase ?? ''),
        tools: resp.tools,
        has_media: media,
        layer,
        ...(prov ? { extract_provenance: prov } : {}),
      });
      console.log(`  ${pass ? '✓' : '✗'} t${i + 1}  ${t.text.slice(0, 55)}`);
      console.log(`         · ${layerLine(layer)}`);
      if (!pass) for (const f of failures) console.log(`         !! ${f}`);
      await sleep(350);
    } catch (e) {
      ok = false;
      turns.push({
        index: i + 1,
        buyer: t.text,
        reply: '',
        pass: false,
        failures: [e instanceof Error ? e.message : String(e)],
      });
      console.log(`  ✗ t${i + 1} ERROR`);
      break;
    }
  }
  return { id: sc.id, section, title: sc.title, channel: 'chat', ok, turns };
}

async function runAdvisorScenario(sc: Scenario, section: string): Promise<ScenRec> {
  const sid = `qah-${sc.id}-${Date.now()}`;
  const turns: TurnRec[] = [];
  let ok = true;
  for (let i = 0; i < sc.turns.length; i++) {
    const t = sc.turns[i]!;
    try {
      const out = await advisorTurn(sid, t.text, { prefs: i === 0 });
      const debug = {
        goal: out.body.goal_kind
          ? { kind: out.body.goal_kind, topic: out.body.goal_topic }
          : (out.body.debug as { goal?: unknown })?.goal,
        phase: out.body.phase,
        speech_act: out.body.speech_act,
        extract_provenance: out.body.extract_provenance ?? (out.body.debug as { extract_provenance?: unknown })?.extract_provenance,
        classifier: out.body.classifier ?? (out.body.debug as { classifier?: unknown })?.classifier,
      } as Record<string, unknown>;
      const media = hasMediaSignal(out.reply, out.body.whatsapp_actions, []);
      const focus = out.body.focused_project as { name?: string; project_id?: string } | undefined;
      const nba = out.body.nba as { board_project_id?: string; chips?: string[] } | undefined;
      const failures = check(out.reply, debug, t.assert, media);
      const fails2: string[] = [];
      for (const n of t.assert?.reply_includes ?? []) {
        const hay = `${out.reply} ${focus?.name ?? ''} ${nba?.board_project_id ?? ''}`.toLowerCase();
        if (!hay.includes(n.toLowerCase())) fails2.push(`missing "${n}" in reply/focus`);
      }
      for (const n of t.assert?.reply_excludes ?? []) {
        const hay = `${out.reply} ${focus?.name ?? ''}`.toLowerCase();
        if (hay.includes(n.toLowerCase())) fails2.push(`unexpected "${n}"`);
      }
      const finalFails = [
        ...fails2,
        ...failures.filter((f) => !f.startsWith('missing "')),
      ];
      const finalPass = finalFails.length === 0;
      if (!finalPass) ok = false;
      const layer = summarizeLayer(debug, { advisorLimited: !debug.extract_provenance });
      turns.push({
        index: i + 1,
        buyer: t.text,
        reply: out.reply,
        pass: finalPass,
        failures: finalFails,
        goal: debug.goal,
        phase: String(debug.phase ?? ''),
        has_media: media,
        layer,
      });
      console.log(`  ${finalPass ? '✓' : '✗'} t${i + 1}  ${t.text.slice(0, 55)}`);
      console.log(`         · ${layerLine(layer)}`);
      if (!finalPass) for (const f of finalFails) console.log(`         !! ${f}`);
      await sleep(400);
    } catch (e) {
      ok = false;
      turns.push({
        index: i + 1,
        buyer: t.text,
        reply: '',
        pass: false,
        failures: [e instanceof Error ? e.message : String(e)],
      });
      break;
    }
  }
  return { id: sc.id, section, title: sc.title, channel: 'advisor', ok, turns };
}

async function runP7Smoke(): Promise<ScenRec> {
  const script = join(ROOT, 'scripts', 'smoke-p7-focused-chips.sh');
  if (!existsSync(script)) {
    return {
      id: 'P7-SMOKE',
      section: 'H',
      title: 'P7 focused chips smoke',
      channel: 'advisor',
      ok: false,
      turns: [{ index: 1, buyer: '(script)', reply: '', pass: false, failures: ['smoke script missing'] }],
    };
  }
  const r = spawnSync('bash', [script], {
    env: { ...process.env, CONVERSE_SPINE_URL: SPINE },
    encoding: 'utf8',
    timeout: 180_000,
  });
  const ok = r.status === 0;
  return {
    id: 'P7-SMOKE',
    section: 'H',
    title: 'P7 focused chips smoke',
    channel: 'advisor',
    ok,
    turns: [
      {
        index: 1,
        buyer: 'smoke-p7-focused-chips.sh',
        reply: (r.stdout || '').slice(-500),
        pass: ok,
        failures: ok ? [] : [(r.stderr || r.stdout || 'smoke failed').slice(0, 300)],
      },
    ],
  };
}

async function main() {
  const health = await fetch(`${SPINE}/health`).then((r) => r.json()).catch(() => null);
  if (!health || (health as { status?: string }).status !== 'ok') {
    console.error('Spine not up', SPINE);
    process.exit(1);
  }
  const catalog = loadBuyerJson();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = join(ROOT, 'scenarios', 'runs', `quality-AH-${stamp}`);
  mkdirSync(runDir, { recursive: true });
  console.log(`\nQuality catalog A–H → ${SPINE}\nRecording → ${runDir}\n`);

  const all: ScenRec[] = [];
  const sectionSummary: Record<string, { pass: number; fail: number; ids: string[] }> = {};

  for (const [section, ids] of Object.entries(SECTIONS)) {
    console.log(`\n######## SECTION ${section} ########`);
    sectionSummary[section] = { pass: 0, fail: 0, ids: [] };
    for (const id of ids) {
      if (id === 'P7-SMOKE') {
        console.log(`══ P7-SMOKE ══`);
        const rec = await runP7Smoke();
        all.push(rec);
        if (rec.ok) sectionSummary[section]!.pass++;
        else sectionSummary[section]!.fail++;
        sectionSummary[section]!.ids.push(`${rec.ok ? 'PASS' : 'FAIL'}:${id}`);
        continue;
      }
      const sc = catalog.get(id);
      if (!sc) {
        console.log(`══ ${id} — MISSING JSON ══`);
        all.push({
          id,
          section,
          title: 'missing',
          channel: 'chat',
          ok: false,
          turns: [{ index: 1, buyer: '', reply: '', pass: false, failures: ['scenario JSON not found'] }],
        });
        sectionSummary[section]!.fail++;
        sectionSummary[section]!.ids.push(`MISS:${id}`);
        continue;
      }
      console.log(`══ ${id} — ${sc.title} (${sc.channel}/${sc.builder_id}) ══`);
      const rec =
        sc.channel === 'advisor' ? await runAdvisorScenario(sc, section) : await runChatScenario(sc, section);
      all.push(rec);
      if (rec.ok) sectionSummary[section]!.pass++;
      else sectionSummary[section]!.fail++;
      sectionSummary[section]!.ids.push(`${rec.ok ? 'PASS' : 'FAIL'}:${id}`);
      writeFileSync(join(runDir, `${id}.json`), JSON.stringify(rec, null, 2));
    }
  }

  writeFileSync(join(runDir, 'summary.json'), JSON.stringify({ spine: SPINE, sectionSummary, all }, null, 2));

  // Layer analysis across chat turns (advisor omits extract_provenance today)
  type LayerAgg = {
    turns: number;
    by_dominant: Record<string, number>;
    field_hits: Record<string, number>;
    baml_called: number;
    baml_not_called: number;
    fail_by_dominant: Record<string, number>;
    pass_by_dominant: Record<string, number>;
    examples: { id: string; turn: number; buyer: string; dominant: string; pass: boolean; fields: string }[];
  };
  const layerBySection: Record<string, LayerAgg> = {};
  const globalLayer: LayerAgg = {
    turns: 0,
    by_dominant: {},
    field_hits: {},
    baml_called: 0,
    baml_not_called: 0,
    fail_by_dominant: {},
    pass_by_dominant: {},
    examples: [],
  };

  function bump(agg: LayerAgg, t: TurnRec, scenId: string) {
    const layer = t.layer;
    if (!layer || layer.dominant === 'advisor_debug_omits_provenance') return;
    agg.turns++;
    agg.by_dominant[layer.dominant] = (agg.by_dominant[layer.dominant] ?? 0) + 1;
    for (const [k, n] of Object.entries(layer.field_counts)) {
      agg.field_hits[k] = (agg.field_hits[k] ?? 0) + n;
    }
    if (layer.baml_called === true) agg.baml_called++;
    else if (layer.baml_called === false) agg.baml_not_called++;
    const bucket = t.pass ? agg.pass_by_dominant : agg.fail_by_dominant;
    bucket[layer.dominant] = (bucket[layer.dominant] ?? 0) + 1;
    if (agg.examples.length < 40 || !t.pass) {
      agg.examples.push({
        id: scenId,
        turn: t.index,
        buyer: t.buyer.slice(0, 70),
        dominant: layer.dominant,
        pass: t.pass,
        fields: Object.entries(layer.fields)
          .map(([f, p]) => `${f}=${p}`)
          .join(', '),
      });
    }
  }

  for (const rec of all) {
    const sec = rec.section ?? '?';
    if (!layerBySection[sec]) {
      layerBySection[sec] = {
        turns: 0,
        by_dominant: {},
        field_hits: {},
        baml_called: 0,
        baml_not_called: 0,
        fail_by_dominant: {},
        pass_by_dominant: {},
        examples: [],
      };
    }
    for (const t of rec.turns) {
      bump(layerBySection[sec]!, t, rec.id);
      bump(globalLayer, t, rec.id);
    }
  }

  writeFileSync(
    join(runDir, 'layer-summary.json'),
    JSON.stringify({ global: globalLayer, bySection: layerBySection }, null, 2),
  );

  // Human findings markdown (diagnosis only — no fixes)
  const lines: string[] = [
    `# Quality catalog A–H results`,
    ``,
    `**Spine:** ${SPINE}`,
    `**Run:** ${runDir}`,
    `**Method:** Curated goldens (pass/fail) inspired by real Lokations/buyer phrasings from Naya \`data/eval/real_conversations.jsonl\`. Large unlabeled corpus is better for *discovery*; small curated set is better for *gating* — this run uses curated A–H for scoring.`,
    ``,
    `See also: \`LAYER_ANALYSIS.md\` (regex vs embedder vs BAML/LLM per turn).`,
    ``,
    `## Scoreboard`,
    ``,
    `| Section | Pass | Fail | IDs |`,
    `|---|---:|---:|---|`,
  ];
  for (const [s, v] of Object.entries(sectionSummary)) {
    lines.push(`| **${s}** | ${v.pass} | ${v.fail} | ${v.ids.join(', ')} |`);
  }
  lines.push(``, `## Failures (detail)`, ``);
  for (const rec of all.filter((x) => !x.ok)) {
    lines.push(`### ${rec.id} (${rec.section}) — ${rec.title}`);
    for (const t of rec.turns.filter((x) => !x.pass)) {
      lines.push(`- t${t.index} \`${t.buyer.slice(0, 80)}\``);
      for (const f of t.failures) lines.push(`  - ${f}`);
      lines.push(`  - reply: ${t.reply.replace(/\s+/g, ' ').slice(0, 220)}`);
      if (t.goal) lines.push(`  - goal: \`${JSON.stringify(t.goal)}\``);
      if (t.layer) lines.push(`  - layer: \`${layerLine(t.layer)}\``);
      if (t.layer?.fields && Object.keys(t.layer.fields).length) {
        lines.push(
          `  - fields: ${Object.entries(t.layer.fields)
            .map(([f, p]) => `\`${f}=${p}\``)
            .join(' ')}`,
        );
      }
    }
    lines.push(``);
  }
  writeFileSync(join(runDir, 'FINDINGS.md'), lines.join('\n'));

  const layerMd: string[] = [
    `# Layer analysis — regex / embedder / BAML (LLM)`,
    ``,
    `**Spine:** ${SPINE}`,
    `**Run:** ${runDir}`,
    ``,
    `## How to read this`,
    ``,
    `Per-turn \`debug.extract_provenance\` from \`/chat\` (Dev):`,
    ``,
    `| Provenance | Meaning |`,
    `|---|---|`,
    `| **regex** | Deterministic \`extractFacts\` / chip-path regex |`,
    `| **embedder** | Semantic NLU / Vectorize project or intent fill |`,
    `| **baml** | P6 \`ExtractTurnFacts\` LLM gap-fill (promote on Dev) |`,
    `| **chip_resolve** | Speech-act / topic from chip path table |`,
    `| **ingress_blocked** | Advisor/UI slot locked unless override |`,
    `| **override** | Buyer override of ingress-filled slot |`,
    ``,
    `**Dominant** = highest-priority layer that wrote any field this turn (baml > llm > embedder > regex > …).`,
    ``,
    `**Caveats:**`,
    `- Advisor channel responses currently **omit** \`extract_provenance\` — those turns are excluded from layer counts.`,
    `- Compose/reply generation is separate from extract; this report scores **extract authority**, not whether the final sentence was templated vs free LLM.`,
    `- \`turn_routing\` confidence (rule/embedder/llm) is **not** exposed on \`/chat\` debug today — only extract provenance.`,
    ``,
    `## Global extract scoreboard`,
    ``,
    `- Chat turns with provenance: **${globalLayer.turns}**`,
    `- BAML called: **${globalLayer.baml_called}** · not called (explicit false): **${globalLayer.baml_not_called}**`,
    ``,
    `### Dominant layer (turns)`,
    ``,
    `| Dominant | Turns | Pass turns | Fail turns |`,
    `|---|---:|---:|---:|`,
  ];
  const domKeys = [
    ...new Set([
      ...Object.keys(globalLayer.by_dominant),
      ...Object.keys(globalLayer.pass_by_dominant),
      ...Object.keys(globalLayer.fail_by_dominant),
    ]),
  ].sort((a, b) => (globalLayer.by_dominant[b] ?? 0) - (globalLayer.by_dominant[a] ?? 0));
  for (const k of domKeys) {
    layerMd.push(
      `| **${k}** | ${globalLayer.by_dominant[k] ?? 0} | ${globalLayer.pass_by_dominant[k] ?? 0} | ${globalLayer.fail_by_dominant[k] ?? 0} |`,
    );
  }
  layerMd.push(``, `### Field-level hits (sum across turns)`, ``, `| Layer | Field writes |`, `|---|---:|`);
  for (const [k, n] of Object.entries(globalLayer.field_hits).sort((a, b) => b[1] - a[1])) {
    layerMd.push(`| **${k}** | ${n} |`);
  }

  layerMd.push(``, `## By catalog section`, ``);
  for (const [sec, agg] of Object.entries(layerBySection)) {
    layerMd.push(`### Section ${sec} (${agg.turns} chat turns with provenance)`);
    layerMd.push(``);
    layerMd.push(
      `- Dominant mix: ${
        Object.entries(agg.by_dominant)
          .sort((a, b) => b[1] - a[1])
          .map(([k, n]) => `${k}=${n}`)
          .join(', ') || 'n/a'
      }`,
    );
    layerMd.push(
      `- Field hits: ${
        Object.entries(agg.field_hits)
          .sort((a, b) => b[1] - a[1])
          .map(([k, n]) => `${k}=${n}`)
          .join(', ') || 'n/a'
      }`,
    );
    layerMd.push(`- BAML called: ${agg.baml_called}`);
    const fails = agg.examples.filter((e) => !e.pass);
    if (fails.length) {
      layerMd.push(``, `Failing turns × layer:`, ``);
      for (const e of fails.slice(0, 15)) {
        layerMd.push(`- **${e.id}** t${e.turn} dom=\`${e.dominant}\` — \`${e.buyer}\``);
        if (e.fields) layerMd.push(`  - ${e.fields}`);
      }
    }
    layerMd.push(``);
  }

  layerMd.push(`## Failures correlated with extract layer`, ``);
  const failExamples = all
    .flatMap((rec) =>
      rec.turns
        .filter((t) => !t.pass && t.layer && t.layer.dominant !== 'advisor_debug_omits_provenance')
        .map((t) => ({ rec, t })),
    );
  if (!failExamples.length) {
    layerMd.push(`_No chat failures with provenance in this run._`);
  } else {
    layerMd.push(`| Scenario | Turn | Dominant | Fields | Failure |`);
    layerMd.push(`|---|---:|---|---|---|`);
    for (const { rec, t } of failExamples) {
      const fields = Object.entries(t.layer?.fields ?? {})
        .map(([f, p]) => `${f}=${p}`)
        .join('; ');
      layerMd.push(
        `| ${rec.id} | ${t.index} | ${t.layer?.dominant} | ${fields || '—'} | ${t.failures.join('; ').slice(0, 120)} |`,
      );
    }
  }

  layerMd.push(
    ``,
    `## What this implies (diagnosis only)`,
    ``,
    `1. If **fails cluster on \`regex\` dominant** → missing extractor / speech-act path; do not widen compose regex.`,
    `2. If **fails cluster on \`embedder\`** → Vectorize/name match / intent embed noise or abstain; check project vectors + gates.`,
    `3. If **fails cluster on \`baml\`** (or BAML filled wrong field) → promote gap-fill quality; compare shadow disagree lists.`,
    `4. If **pass with regex but fail quality** (thin reply) → compose/evidence, not extract — out of this table.`,
    `5. Advisor rows need \`extract_provenance\` wired through \`map-response\` before Advisor layer quality is measurable.`,
    ``,
  );
  writeFileSync(join(runDir, 'LAYER_ANALYSIS.md'), layerMd.join('\n'));

  console.log(`\n══ Section summary ══`);
  for (const [s, v] of Object.entries(sectionSummary)) {
    console.log(`  ${s}: ${v.pass} pass / ${v.fail} fail`);
  }
  console.log(`\n══ Layer dominant (chat) ══`);
  for (const k of domKeys) {
    console.log(`  ${k}: ${globalLayer.by_dominant[k] ?? 0} turns`);
  }
  console.log(`\nFindings → ${runDir}/FINDINGS.md`);
  console.log(`Layer analysis → ${runDir}/LAYER_ANALYSIS.md`);
  const anyFail = all.some((x) => !x.ok);
  process.exit(anyFail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
