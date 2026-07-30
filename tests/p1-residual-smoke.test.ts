
import { describe, expect, it } from "vitest";
import { detectTopics, extractFactsSync } from "../src/engine/facts.js";
import { resolveFaqQuestionKeys } from "../src/engine/faq-keys.js";
import { commitTo, initState } from "../src/engine/state.js";
import { decide as focusedDecide } from "../src/engine/phases/focused.js";
import { mergeRoutingTopicsIntoExtract } from "../src/engine/turn-routing/answer-topics.js";
import type { TurnRoutingResult } from "../src/engine/turn-routing/types.js";

describe("P1 residual root cause", () => {
  it("location primary must survive price embedder union", () => {
    let s = initState("naya-advisor", "t");
    s = commitTo(s, "brigade-eldorado-naya-advisor", "Brigade Eldorado");
    const text = "ಸ್ಥಳ ಎಲ್ಲಿದೆ??";
    const ex0 = extractFactsSync(text, s);
    const routing: TurnRoutingResult = {
      routing: "answer_on_project",
      confidence: "embedder",
      answer_topic: "price",
      answer_topics: ["price"],
      bind: { bind_source: "embed_intent", intent_kind: "get_price", score: 0.9 },
    };
    s = { ...s, rti: { ...s.rti, lastRouting: routing } };
    const ex = mergeRoutingTopicsIntoExtract(ex0, routing);
    const goal = focusedDecide(s, ex, text);
    expect(ex.askTopic).toBe("location");
    expect(goal.kind).toBe("answer");
    expect((goal as any).topic).toBe("location");
  });

  it("builder FAQ overview must not become price via merge", () => {
    let s = initState("naya-advisor", "t");
    s = commitTo(s, "brigade-eldorado-naya-advisor", "Brigade Eldorado");
    const text = "बिल्डर कौन है??";
    expect(resolveFaqQuestionKeys(text)).toContain("builder_credibility");
    const ex0 = extractFactsSync(text, s);
    const routing: TurnRoutingResult = {
      routing: "answer_on_project",
      confidence: "embedder",
      answer_topic: "price",
      answer_topics: ["price"],
      bind: { bind_source: "embed_intent", intent_kind: "get_price", score: 0.9 },
    };
    s = { ...s, rti: { ...s.rti, lastRouting: routing } };
    const ex = mergeRoutingTopicsIntoExtract(ex0, routing);
    const goal = focusedDecide(s, ex, text);
    expect(ex.askTopics).toEqual(["overview"]);
    expect(goal.kind).toBe("answer");
    expect((goal as any).topic).toBe("overview");
  });

  it("appreciation FAQ overview must not become price via merge", () => {
    let s = initState("naya-advisor", "t");
    s = commitTo(s, "brigade-eldorado-naya-advisor", "Brigade Eldorado");
    const text = "एक बात: एप्रिसिएशन? बताओ";
    expect(resolveFaqQuestionKeys(text)).toContain("resale_value");
    const ex0 = extractFactsSync(text, s);
    const routing: TurnRoutingResult = {
      routing: "answer_on_project",
      confidence: "embedder",
      answer_topic: "price",
      answer_topics: ["price"],
      bind: { bind_source: "embed_intent", intent_kind: "get_price", score: 0.9 },
    };
    s = { ...s, rti: { ...s.rti, lastRouting: routing } };
    const ex = mergeRoutingTopicsIntoExtract(ex0, routing);
    const goal = focusedDecide(s, ex, text);
    expect(ex.askTopics).toEqual(["overview"]);
    expect(goal.kind).toBe("answer");
    expect((goal as any).topic).toBe("overview");
  });

  it("still grows price+legal multi-intent from routing", () => {
    const ex0 = { constraints: {}, askTopic: "price" as const, askTopics: ["price" as const] };
    const routing: TurnRoutingResult = {
      routing: "answer_on_project",
      confidence: "embedder",
      answer_topic: "legal",
      answer_topics: ["legal"],
    };
    const ex = mergeRoutingTopicsIntoExtract(ex0 as any, routing);
    expect(ex.askTopics).toEqual(["price", "legal"]);
    expect(ex.askTopic).toBe("price");
  });
});
