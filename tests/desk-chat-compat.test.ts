import { describe, expect, it } from 'vitest';
import { toDeskChatResponse } from '../src/worker/routes.js';
import type { ChatResponse } from '../src/worker/routes.js';

describe('toDeskChatResponse — NayaDesk Auto/Vault contract', () => {
  it('maps reply_text → reply and tools → brain.tool_calls', () => {
    const raw: ChatResponse = {
      reply_text: 'Available configurations: 2 BHK — 740 sqft.',
      composer: 'answer',
      turn_index: 3,
      conversation_id: 'conv:test',
      debug: {
        phase: 'focused',
        tools: ['listUnits', 'detail'],
        grounding: 'pass',
        goal: { kind: 'answer', topic: 'availability', projectId: 'eldorado' },
      },
    };
    const desk = toDeskChatResponse(raw);
    expect(desk.status).toBe('ok');
    expect(desk.reply).toBe(raw.reply_text);
    expect(desk.conversation_id).toBe('conv:test');
    expect(desk.debug.classifier.intent).toBe('answer');
    expect(desk.debug.brain.tool_calls).toEqual([
      { name: 'listUnits', success: true },
      { name: 'detail', success: true },
    ]);
  });
});
