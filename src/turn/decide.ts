import type { ComposerKind, DecideResult, Intent, MemoryView, UnderstandResult } from '../types.js';
import { runObjectionGraph } from '../graphs/objection.js';
import { runVisitGraph } from '../graphs/visit.js';

export interface DecideContext {
  turnIndex: number;
  buyerText: string;
}

/** Pure rules — no LLM. One composer per turn. */
export function decide(
  understood: UnderstandResult,
  memory: MemoryView,
  ctx: DecideContext = { turnIndex: 1, buyerText: '' },
): DecideResult {
  const buyerText = ctx.buyerText;
  const isFirstTurn = ctx.turnIndex === 1;
  const hasPriorSlots = Boolean(
    memory.facts.budget || memory.facts.location || memory.facts.bhk || memory.facts.project_id,
  );
  const kinds = new Set(understood.intents.map((i) => i.kind));
  const tool_plan: DecideResult['tool_plan'] = [];
  const memory_writes: DecideResult['memory_writes'] = [];

  let composer: ComposerKind = 'llm';

  if (kinds.has('greeting') && kinds.size === 1) {
    if (memory.returningBuyer || (!isFirstTurn && hasPriorSlots)) {
      return { composer: 'template:returning_greeting', tool_plan: [], memory_writes: [] };
    }
    return {
      composer: 'template:greeting',
      tool_plan: [{ name: 'catalog_brief', args: {} }],
      memory_writes: [],
    };
  }

  if (kinds.has('confirm_action') && memory.pending?.kind === 'visit_proposal') {
    return {
      composer: 'template:visit_confirm',
      tool_plan: [{ name: 'confirm_visit', args: { ...(memory.pending.payload as object) } }],
      memory_writes: [{ op: 'clear_pending' }],
    };
  }

  if (kinds.has('express_objection') || runObjectionGraph(buyerText, memory)) {
    return { composer: 'template:objection', tool_plan: [], memory_writes: [] };
  }

  if (kinds.has('compare_projects')) {
    const names = understood.compare_names ?? [];
    const idsFromShortlist = memory.shortlist.slice(0, 3);
    const adviceOnly = isCompareAdviceAsk(buyerText) && names.length < 2;
    if (adviceOnly && idsFromShortlist.length >= 2) {
      tool_plan.push({
        name: 'compare_projects',
        args: { project_ids: idsFromShortlist },
      });
      return { composer: 'template:compare_advice', tool_plan, memory_writes: [] };
    }
    if (names.length >= 2 || idsFromShortlist.length >= 2) {
      tool_plan.push({
        name: 'compare_projects',
        args: {
          project_names: names,
          project_ids: idsFromShortlist,
        },
      });
      return { composer: 'template:compare', tool_plan, memory_writes: [] };
    }
  }

  if (kinds.has('book_visit')) {
    const visit = runVisitGraph(buyerText, memory);
    if (visit.composer === 'template:visit_ask_day') {
      return { composer: 'template:visit_ask_day', tool_plan: [], memory_writes: [] };
    }
    const { project_id, human_label } = visit.state as { project_id: string; human_label: string };
    memory_writes.push({
      op: 'set_pending',
      pending: { kind: 'visit_proposal', payload: { project_id, human_label } },
    });
    return {
      composer: 'template:visit_confirm',
      tool_plan: [{ name: 'propose_visit', args: { project_id, human_label } }],
      memory_writes,
    };
  }

  if (kinds.has('get_media')) {
    const pid = memory.facts.project_id ?? memory.shortlist[0];
    if (pid) {
      tool_plan.push({
        name: 'share_media',
        args: {
          project_id: pid,
          asset_kind: understood.media_kind ?? detectMediaKind(buyerText),
          unit_type: memory.facts.bhk,
        },
      });
      return { composer: 'template:media', tool_plan, memory_writes: [] };
    }
  }

  if (kinds.has('get_unit_configs')) {
    const pid = memory.facts.project_id ?? memory.shortlist[0];
    if (pid) {
      tool_plan.push({ name: 'list_units', args: { project_id: pid } });
      return { composer: 'template:units', tool_plan, memory_writes: [] };
    }
  }

  if (kinds.has('get_legal_info') && memory.facts.project_id) {
    tool_plan.push({ name: 'lookup_project', args: { project_id: memory.facts.project_id } });
    return { composer: 'template:legal', tool_plan, memory_writes: [] };
  }

  if (kinds.has('get_project_info') && memory.facts.project_id) {
    tool_plan.push({ name: 'lookup_project', args: { project_id: memory.facts.project_id } });
    if (kinds.has('get_price')) {
      tool_plan.push({ name: 'give_pricing', args: { project_id: memory.facts.project_id } });
      return { composer: 'template:pricing', tool_plan, memory_writes: [] };
    }
    return { composer: 'template:detail', tool_plan, memory_writes: [] };
  }

  if (kinds.has('get_price')) {
    const pid = memory.facts.project_id ?? memory.shortlist[0];
    if (pid) {
      tool_plan.push({ name: 'give_pricing', args: { project_id: pid } });
      composer = 'template:pricing';
    }
  }

  if (kinds.has('find_projects') || (kinds.has('other') && hasEnoughToSearch(memory))) {
    tool_plan.push({ name: 'search_projects', args: {} });
    composer = isFirstTurn ? 'template:welcome_list' : 'template:list';
  }

  if (composer === 'llm' && kinds.has('acknowledge')) {
    composer = 'early_exit:ack';
  }

  return { composer, tool_plan, memory_writes };
}

function hasEnoughToSearch(memory: MemoryView): boolean {
  return Boolean(memory.facts.budget || memory.facts.location || memory.facts.bhk);
}

function isCompareAdviceAsk(text: string): boolean {
  return /\b(which one is better|which is better|better for|recommend between|which would you (?:pick|recommend))\b/i.test(
    text,
  );
}

function detectMediaKind(text: string): string {
  if (/\bfloor plan\b/i.test(text)) return 'floor_plan';
  if (/\bmaster plan\b/i.test(text)) return 'master_plan';
  if (/\bprice sheet\b/i.test(text)) return 'price_sheet';
  if (/\blocation map\b|directions\b/i.test(text)) return 'location_map';
  return 'brochure';
}

export function intentKinds(intents: Intent[]): Set<string> {
  return new Set(intents.map((i) => i.kind));
}
