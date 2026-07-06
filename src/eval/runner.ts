import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TurnRuntime } from '../runtime/deps.js';
import { handleChat } from '../worker/routes.js';
import type { BuyerProfile } from './personas.js';
import { generateBuyerProfiles, profileOpeningMessage } from './personas.js';
import { allBuilderIds, scenarioPersonas } from './persona-library.js';
import { fetchBuilderCatalog, type BuilderCatalog } from './catalog.js';
import { isDoneMessage, simulateBuyerMessage, type TranscriptTurn } from './buyer-sim.js';
import { judgeConversationQuality, type QualityVerdict } from './judge.js';
import type { Env } from '../env.js';

export interface JourneyResult {
  profile: BuyerProfile;
  conversation_id: string;
  transcript: TranscriptTurn[];
  verdict: QualityVerdict;
}

export async function runBuyerJourney(
  rt: TurnRuntime,
  profile: BuyerProfile,
  catalog?: BuilderCatalog,
): Promise<JourneyResult> {
  const transcript: TranscriptTurn[] = [];
  let conversationId = '';
  const env = rt.env as Env;

  for (let turn = 0; turn < profile.max_turns; turn++) {
    let buyerText = await simulateBuyerMessage(env, profile, transcript, catalog);
    if (isDoneMessage(buyerText)) break;

    if (turn === 0 && buyerText.toLowerCase() === 'hi' && profile.style === 'direct' && !profile.script) {
      buyerText = `hi, looking for ${profileOpeningMessage(profile)}`;
    }

    const result = await handleChat(
      rt,
      {
        builder_id: profile.builder_id,
        buyer_phone: profile.phone,
        text: buyerText,
        conversation_id: conversationId || undefined,
      },
    );
    conversationId = result.conversation_id;

    transcript.push({ role: 'buyer', text: buyerText });
    transcript.push({
      role: 'bot',
      text: result.reply_text,
      composer: result.composer,
      turn_index: result.turn_index,
    });
  }

  const verdict = await judgeConversationQuality(env, profile, transcript);
  return { profile, conversation_id: conversationId, transcript, verdict };
}

export async function runQualityEval(
  rt: TurnRuntime,
  opts: { count?: number; builderId?: string; outDir?: string } = {},
): Promise<{ journeys: JourneyResult[]; reportPath: string }> {
  const count = opts.count ?? 3;
  const builderId = opts.builderId ?? rt.defaultBuilderId();
  const catalog = await fetchBuilderCatalog(rt, builderId);
  console.log(`Catalog: ${catalog.projects.length} projects for ${catalog.builder_name}`);
  const profiles = generateBuyerProfiles(count, builderId, catalog);
  return runProfiles(rt, profiles, catalog, opts.outDir);
}

/** Full scenario suite — 12 personas × each builder by default. */
export async function runScenarioSuite(
  rt: TurnRuntime,
  opts: { builders?: string[]; outDir?: string } = {},
): Promise<{ journeys: JourneyResult[]; reportPath: string }> {
  const builders = opts.builders ?? allBuilderIds();
  const allProfiles: BuyerProfile[] = [];
  const catalogs = new Map<string, BuilderCatalog>();

  for (const builderId of builders) {
    const catalog = await fetchBuilderCatalog(rt, builderId);
    catalogs.set(builderId, catalog);
    const profiles = scenarioPersonas(builderId, catalog);
    console.log(`\n${catalog.builder_name}: ${profiles.length} scenarios, ${catalog.projects.length} projects in catalog`);
    allProfiles.push(...profiles);
  }

  return runProfiles(rt, allProfiles, catalogs.get(allProfiles[0]?.builder_id ?? 'lokations'), opts.outDir, catalogs);
}

async function runProfiles(
  rt: TurnRuntime,
  profiles: BuyerProfile[],
  defaultCatalog?: BuilderCatalog,
  outDir?: string,
  catalogMap?: Map<string, BuilderCatalog>,
): Promise<{ journeys: JourneyResult[]; reportPath: string }> {
  const journeys: JourneyResult[] = [];
  const runPhoneBase = Date.now() % 90_000_000;
  let phoneCounter = 0;

  for (const profile of profiles) {
    const freshProfile = profile.scenario_id
      ? {
          ...profile,
          phone: `+9199${String(runPhoneBase + phoneCounter++).padStart(8, '0')}`,
        }
      : profile;
    const catalog = catalogMap?.get(freshProfile.builder_id) ?? defaultCatalog;
    const tag = freshProfile.scenario_id ? `[${freshProfile.scenario_id}]` : '';
    console.log(`\n▶ ${freshProfile.builder_id} ${tag} ${freshProfile.name} — ${freshProfile.goal.slice(0, 55)}…`);
    const j = await runBuyerJourney(rt, freshProfile, catalog);
    journeys.push(j);
    console.log(`  Score: ${j.verdict.overall_score.toFixed(1)}/10 — ${j.verdict.summary.slice(0, 90)}`);
  }

  const dir = outDir ?? join(process.cwd(), 'eval-reports', String(Date.now()));
  mkdirSync(dir, { recursive: true });
  const reportPath = join(dir, 'quality-report.html');
  writeFileSync(reportPath, renderHtmlReport(journeys), 'utf8');
  writeFileSync(join(dir, 'quality-report.json'), JSON.stringify(journeys, null, 2), 'utf8');

  const avg = journeys.reduce((s, j) => s + j.verdict.overall_score, 0) / journeys.length;
  const byBuilder = groupBy(journeys, (j) => j.profile.builder_id);
  console.log(`\n══ Eval complete: ${journeys.length} journeys, avg ${avg.toFixed(1)}/10`);
  for (const [b, js] of Object.entries(byBuilder)) {
    const bavg = js.reduce((s, j) => s + j.verdict.overall_score, 0) / js.length;
    console.log(`  ${b}: ${js.length} journeys, avg ${bavg.toFixed(1)}/10`);
  }
  console.log(`Report: ${reportPath}`);

  return { journeys, reportPath };
}

function groupBy<T>(arr: T[], key: (x: T) => string): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const x of arr) {
    const k = key(x);
    (out[k] ??= []).push(x);
  }
  return out;
}

function renderHtmlReport(journeys: JourneyResult[]): string {
  const avg = journeys.reduce((s, j) => s + j.verdict.overall_score, 0) / journeys.length;
  const byBuilder = groupBy(journeys, (j) => j.profile.builder_id);

  const sections = Object.entries(byBuilder)
    .map(([builder, js]) => {
      const bavg = js.reduce((s, j) => s + j.verdict.overall_score, 0) / js.length;
      const cards = js.map((j) => journeyCard(j)).join('');
      return `<h2>${esc(builder)} — ${js.length} scenarios · avg ${bavg.toFixed(1)}/10</h2>${cards}`;
    })
    .join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>ConverseSpine Scenario Eval</title>
<style>
body{font-family:system-ui;max-width:960px;margin:2rem auto;padding:0 1rem;background:#0f1117;color:#e8eaed}
h1{color:#7cb3ff}h2{color:#9ecbff;margin-top:2rem;border-bottom:1px solid #333;padding-bottom:0.4rem}
.journey{border:1px solid #333;border-radius:8px;padding:1rem;margin:1rem 0;background:#1a1d27}
.scenario{display:inline-block;background:#2d3a5c;color:#9ecbff;padding:0.15rem 0.5rem;border-radius:4px;font-size:0.75rem;margin-right:0.5rem}
.meta{color:#9aa0a6;font-size:0.9rem}.bad{color:#f28b82}.good{color:#81c995}
.dims span{display:inline-block;margin-right:1rem;background:#252836;padding:0.2rem 0.5rem;border-radius:4px;font-size:0.85rem}
.transcript{margin-top:1rem}.turn{padding:0.5rem;border-radius:6px;margin:0.4rem 0}
.turn.buyer{background:#252836}.turn.bot{background:#1e3a2f}
.who{font-weight:bold;text-transform:uppercase;font-size:0.75rem;margin-right:0.5rem}
.composer{font-size:0.7rem;color:#7cb3ff;margin-left:0.5rem}
</style></head><body>
<h1>ConverseSpine Scenario Eval</h1>
<p>${journeys.length} buyer journeys · average score <strong>${avg.toFixed(1)}/10</strong></p>
${sections}
</body></html>`;
}

function journeyCard(j: JourneyResult): string {
  return `
<section class="journey">
  <h3><span class="scenario">${esc(j.profile.scenario_id ?? 'random')}</span>${esc(j.profile.name)} — ${j.verdict.overall_score.toFixed(1)}/10</h3>
  <p class="meta">${esc(j.profile.goal)}</p>
  <p><strong>Judge:</strong> ${esc(j.verdict.summary)}</p>
  ${j.verdict.issues.length ? `<p class="bad"><strong>Issues:</strong> ${j.verdict.issues.map(esc).join('; ')}</p>` : ''}
  ${j.verdict.strengths.length ? `<p class="good"><strong>Strengths:</strong> ${j.verdict.strengths.map(esc).join('; ')}</p>` : ''}
  <div class="dims">${Object.entries(j.verdict.dimensions)
    .map(([k, v]) => `<span>${k}: ${v.toFixed(1)}</span>`)
    .join('')}</div>
  <div class="transcript">${j.transcript
    .map(
      (t) =>
        `<div class="turn ${t.role}"><span class="who">${t.role}</span>${t.composer ? `<span class="composer">${esc(t.composer)}</span>` : ''}<p>${esc(t.text)}</p></div>`,
    )
    .join('')}</div>
</section>`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
