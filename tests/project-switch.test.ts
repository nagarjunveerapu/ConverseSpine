import { describe, expect, it } from 'vitest';
import { detectFocusedSwitchIntent } from '../src/engine/project_switch.js';
import { commitTo, initState } from '../src/engine/state.js';
import type { Extracted } from '../src/engine/types.js';

describe('detectFocusedSwitchIntent — PROJECT_VECTORS namedProjects', () => {
  const focusedAyana = () => {
    const s = commitTo(initState('c1', 'lokations'), 'ayana-lokations', 'Ayana');
    return {
      ...s,
      discover: {
        ...s.discover,
        lastOffered: [
          { projectId: 'ayana-lokations', name: 'Ayana' },
          { projectId: 'clarks-exotica-lokations', name: 'Clarks Exotica' },
        ],
      },
    };
  };

  it('turn 6: top namedProject krishnaja → commit when not in shortlist', () => {
    const s = focusedAyana();
    const text = 'tell me also about krishnaja greens';
    const ex: Extracted = {
      constraints: {},
      transition: 'none',
      namedProjects: [{ projectId: 'krishnaja', name: 'Krishnaja Greens' }],
    };
    const intent = detectFocusedSwitchIntent(text, ex, s);
    expect(intent).toMatchObject({
      commit: { projectId: 'krishnaja', name: 'Krishnaja Greens' },
    });
  });

  it('turn 4: no namedProjects → no false switch on legal facet', () => {
    const s = focusedAyana();
    const text = 'what about legal details';
    const ex: Extracted = { constraints: {}, transition: 'none', askTopic: 'legal', askTopics: ['legal'] };
    expect(detectFocusedSwitchIntent(text, ex, s)).toBeNull();
  });

  it('turn 5: pricing facet without namedProjects → no switch', () => {
    const s = focusedAyana();
    const text = 'and the pricing details';
    const ex: Extracted = { constraints: {}, transition: 'none', askTopic: 'price', askTopics: ['price'] };
    expect(detectFocusedSwitchIntent(text, ex, s)).toBeNull();
  });

  it('typo kirshnaja via vectors fills namedProjects → commit', () => {
    const s = focusedAyana();
    const text = 'kirshnaja greens project';
    const ex: Extracted = {
      constraints: {},
      transition: 'none',
      namedProjects: [{ projectId: 'krishnaja', name: 'Krishnaja Greens' }],
    };
    const intent = detectFocusedSwitchIntent(text, ex, s);
    expect(intent).toMatchObject({ commit: { projectId: 'krishnaja' } });
  });

  it('Send brochure + vector noise Buena Vista → stay on focus (no switch)', () => {
    const s = focusedAyana();
    const text = 'Send brochure';
    const ex: Extracted = {
      constraints: {},
      transition: 'none',
      askTopic: 'media',
      askTopics: ['media'],
      speechAct: 'answer',
      namedProjects: [{ projectId: 'brigade-buena-vista-naya-advisor', name: 'Brigade Buena Vista' }],
    };
    expect(detectFocusedSwitchIntent(text, ex, s)).toBeNull();
  });

  it('paperwork for this one + vector noise → stay on focus', () => {
    const s = focusedAyana();
    const text = 'is the paperwork okay for this one somehow';
    const ex: Extracted = {
      constraints: {},
      transition: 'none',
      askTopic: 'legal',
      askTopics: ['legal'],
      speechAct: 'answer',
      namedProjects: [{ projectId: 'clarks-exotica-lokations', name: 'Clarks Exotica' }],
    };
    expect(detectFocusedSwitchIntent(text, ex, s)).toBeNull();
  });

  it('brochure for Eldorado while on Ayana → switch (name residue)', () => {
    const s = focusedAyana();
    const text = 'Send brochure for Eldorado';
    const ex: Extracted = {
      constraints: {},
      transition: 'none',
      askTopic: 'media',
      askTopics: ['media'],
      speechAct: 'answer',
      namedProjects: [{ projectId: 'brigade-eldorado-naya-advisor', name: 'Brigade Eldorado' }],
    };
    expect(detectFocusedSwitchIntent(text, ex, s)).toMatchObject({
      commit: { projectId: 'brigade-eldorado-naya-advisor' },
      followUp: 'media',
    });
  });
});
