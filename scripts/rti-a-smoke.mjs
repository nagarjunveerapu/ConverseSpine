import { runEngineTurn } from '../src/engine/turn.js';
import { initState } from '../src/engine/state.js';
import { fakeDeps } from '../tests/fakes.js';
import { classifyTurnIntent, buildTurnIntentInput, applyTurnIntentResult } from '../src/engine/turn-intent/classify.js';
import { fallbackReply, buildComposeRequest } from '../src/engine/compose.js';

const chipActions = [
  {
    id: 'clear_bhk',
    label: 'Any configuration',
    patch: { bhk: '' },
    user_line: 'Show projects with any BHK configuration',
    expected_matches: 2,
  },
];

async function scenario(name, fn) {
  console.log(`\n=== ${name} ===`);
  await fn();
}

await scenario('S1: yes after offer_project', async () => {
  const deps = fakeDeps();
  let state = initState('s1', 'lokations');
  state = {
    ...state,
    discover: {
      ...state.discover,
      oriented: true,
      lastOffered: [{ projectId: 'clarks', name: 'Clarks Exotica' }],
    },
    rti: {
      lastUiMode: 'search_recovery',
      lastGoalKind: 'no_fit',
      pendingPrompt: {
        kind: 'offer_project',
        project_id: 'clarks',
        project_name: 'Clarks Exotica',
        asked_at_turn: 1,
      },
    },
  };
  await deps.store.save(state);
  const out = await runEngineTurn(
    {
      convId: 's1',
      builderId: 'lokations',
      text: 'yes',
      buyerPhone: '+91001',
      channel: 'advisor_web',
    },
    deps,
  );
  console.log('phase:', out.state.phase, '| goal:', out.debug.goal.kind, '| focus:', out.state.focus?.projectName);
  console.log('reply:', out.reply.slice(0, 160));
  console.log('pending:', out.state.rti?.pendingPrompt?.kind ?? '(none)');
});

await scenario('S2: yes after chip_menu', async () => {
  let state = initState('s2', 'lokations');
  state = {
    ...state,
    rti: {
      lastUiMode: 'search_recovery',
      lastGoalKind: 'no_fit',
      pendingPrompt: { kind: 'chip_menu', chip_ids: ['clear_bhk'], asked_at_turn: 2 },
      lastSuggestedActions: chipActions,
    },
  };
  const input = buildTurnIntentInput(state, 'yes', 'advisor_web', 'search_recovery');
  const intent = await classifyTurnIntent({}, input);
  const applied = applyTurnIntentResult(state, intent, chipActions);
  console.log('intent:', intent.kind);
  console.log('probe:', applied.probeReply);
});

await scenario('S3: chip tap clear_bhk', async () => {
  const deps = fakeDeps();
  let state = initState('s3', 'lokations');
  state = {
    ...state,
    constraints: { bhk: '4+ BHK', budgetMaxInr: 10_000_000, propertyType: 'Apartment', location: 'Coorg' },
    discover: { ...state.discover, oriented: true },
    rti: {
      lastUiMode: 'search_recovery',
      lastGoalKind: 'no_fit',
      lastSuggestedActions: chipActions,
      pendingPrompt: { kind: 'chip_menu', chip_ids: ['clear_bhk'], asked_at_turn: 2 },
    },
  };
  await deps.store.save(state);
  const out = await runEngineTurn(
    {
      convId: 's3',
      builderId: 'lokations',
      text: 'Any configuration',
      buyerPhone: '+91002',
      channel: 'advisor_web',
      action_id: 'clear_bhk',
    },
    deps,
  );
  console.log('bhk:', out.state.constraints.bhk ?? '(cleared)', '| goal:', out.debug.goal.kind);
  console.log('reply:', out.reply.slice(0, 160));
});

await scenario('S4: single-fork budget gap copy', async () => {
  const reply = fallbackReply(
    buildComposeRequest(
      { kind: 'no_fit' },
      {
        tools: ['search'],
        budgetGap: {
          budgetDisplay: '₹20 L',
          location: 'Devanahalli',
          closestName: 'Brigade Eldorado',
          closestDisplay: '₹31 L',
          closestProjectId: 'eldorado',
        },
      },
      { constraints: { budgetMaxInr: 2_000_000 }, alreadyShownSameSet: false, builderName: 'Brigade' },
    ),
  );
  console.log('copy:', reply);
});
