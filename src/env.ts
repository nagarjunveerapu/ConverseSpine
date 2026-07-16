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
  /** Workers AI for embeddings when Vectorize query needs live embed. */
  AI?: Ai;

  /** SIL data pipeline (weekly rebuild): embedding model + registry JSONL source URL. */
  SIL_EMBED_MODEL?: string;
  SIL_REGISTRY_URL?: string;
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

  META_VERIFY_TOKEN?: string;
  META_APP_SECRET?: string;
  META_ACCESS_TOKEN?: string;

  TURN_DEBOUNCER?: DurableObjectNamespace;

  /** Google Distance Matrix for visit route stagger (same secret as Naya worker). */
  GOOGLE_PLACES_API_KEY?: string;
}
