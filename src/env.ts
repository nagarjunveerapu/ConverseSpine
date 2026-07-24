/** Cloudflare Worker bindings — mirrors wrangler.toml. */
export interface Env {
  /** Service binding to NayaDesk (preferred in prod). */
  NAYADESK?: Fetcher;
  /** HTTP fallback when binding missing or flaky in local dev. */
  NAYADESK_URL?: string;
  BOT_SHARED_SECRET?: string;

  /** Intent phrasing corpus (NayaDesk → Vectorize). */
  INTENT_VECTORS?: VectorizeIndex;
  /** Project-name resolution index (NayaDesk → Vectorize). */
  PROJECT_VECTORS?: VectorizeIndex;
  /** Platform buyer-education corpus (dedicated — not INTENT_VECTORS). */
  EDUCATION_VECTORS?: VectorizeIndex;
  /** Workers AI for embeddings when Vectorize query needs live embed. */
  AI?: Ai;

  /** SIL data pipeline (weekly rebuild): embedding model + registry JSONL source URL. */
  SIL_EMBED_MODEL?: string;
  SIL_REGISTRY_URL?: string;
  /**
   * Learned intent metric. Must equal the bundled matrix's own PROJECTION_ID
   * to take effect — a re-trained matrix therefore cannot silently apply to an
   * index built in the previous space. Absent = raw model vectors, i.e. exactly
   * the behaviour before the projection existed. See nlu/intent-projection.ts.
   */
  SIL_INTENT_PROJECTION?: string;
  /** Override the intent bind threshold. Each space has its own; 0.78 is the
   *  raw-model value and does NOT transfer to a projected space. */
  SIL_ROUTING_TAU?: string;
  /**
   * "true" = ask the intent embedding FIRST and let the regex ladder catch what
   * it declines. Absent = the historical order, where the ladder pre-empts the
   * embedding and (measured on 7,694 production turns) leaves it deciding 1.9%
   * of topic understanding. See turn-routing/classify.ts.
   */
  SIL_EMBED_FIRST?: string;
  /**
   * Understanding Flywheel Wave C — "true" runs the nightly auto-teach: teacher-
   * confident clusters pass an EXACT holdout no-regression gate; safe ones
   * promote as 'flywheel_auto' (one-tap Undo on the Desk board) and ship via an
   * incremental rebuild. Requires SIL_CANONICAL_EMBED=true. Absent = off.
   */
  UNDERSTANDING_AUTO_TEACH?: string;
  /** Master switch for the canonical intent-embed schema: 'true' ships the v2 +
   *  mined corpus as entity-masked (canonical) vectors and canonicalizes the
   *  live query in lockstep. Default/unset = legacy raw behaviour (rebuild no-op). */
  SIL_CANONICAL_EMBED?: string;

  /**
   * Understanding Flywheel Wave A — "true" wires every turn into Desk's
   * intent review queue (POST /api/intent-review-queue/internal/enqueue,
   * fire-and-forget) so the /operations/understanding board sees real
   * traffic. Off/absent = zero behaviour change.
   */
  UNDERSTANDING_CAPTURE?: string;

  /** Turn bundle cache (conversation-context), 60s TTL. */
  TURN_CACHE?: KVNamespace;

  LOG_LEVEL?: string;
  /** Local dev: append turn debug JSONL to logs/turn-debug.jsonl */
  LOCAL_TURN_LOG?: string;
  /**
   * Failure-as-a-value Phase 0. Records shadow failures in the turn ledger and
   * local log without changing goal, evidence, state, or buyer-facing copy.
   */
  FAILURE_LOG?: string;
  /** Phase 1: EMI input authority and destructive-intent disambiguation. */
  FAILURE_TOOLS?: string;
  /** Phase 2: embedding-routed unsupported/definition/about-us outcomes. */
  FAILURE_ROUTING?: string;
  /** Phase 3: durable geography authority and honest search relaxation. */
  FAILURE_SEARCH?: string;
  /** Phase 4: answer delivery requirements and partial no-data outcomes. */
  FAILURE_ANSWER?: string;
  DEEPSEEK_API_KEY?: string;
  DEEPSEEK_BASE_URL?: string;
  DEEPSEEK_MODEL?: string;
  /** Optional fallback when primary LLM errors. */
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;

  /** Local Ollama for RTI ClassifyTurnIntent (dev). */
  OLLAMA_BASE_URL?: string;
  OLLAMA_MODEL?: string;

  /**
   * P6 ExtractTurnFacts mode: off | shadow | promote.
   * Default: shadow when DEEPSEEK_API_KEY set, else off.
   */
  BAML_EXTRACT_MODE?: string;

  /** Langfuse observability (optional). */
  LANGFUSE_PUBLIC_KEY?: string;
  LANGFUSE_SECRET_KEY?: string;
  LANGFUSE_BASE_URL?: string;

  DEFAULT_BUILDER_ID?: string;
  /** Builder tenant for NayaAdvisor channel (default naya-advisor). */
  ADVISOR_BUILDER_ID?: string;
  /** Dev-only: enables the embedder-only measurement route. Never set in prod. */
  SIL_EVAL_ENABLED?: string;

  META_VERIFY_TOKEN?: string;
  META_APP_SECRET?: string;
  META_ACCESS_TOKEN?: string;

  TURN_DEBOUNCER?: DurableObjectNamespace;

  /** Google Distance Matrix for visit route stagger (same secret as Naya worker). */
  GOOGLE_PLACES_API_KEY?: string;
}
