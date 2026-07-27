-- Phase 0e sample export — NayaDesk dig D1 (`intent_review_queue` on naya-db-dev).
-- Run manually when ready to label (do not auto-hit dig from agents):
--   cd ../NayaDesk && npx wrangler d1 execute naya-db-dev --remote --env=dev \
--     --file=../ConverseSpine/scripts/phase-0e-sample.sql
-- Raise LIMIT after a first look if the answer-intent kinds are thin.

-- Distinct buyer texts with high-confidence SIL binds (tau_high = 0.78).
SELECT
  queue_id,
  buyer_text,
  sil_intent,
  sil_score,
  sil_bind_source,
  speech_act,
  builder_id,
  created_at
FROM intent_review_queue
WHERE sil_score >= 0.78
  AND COALESCE(sil_intent, '') != ''
ORDER BY sil_score DESC, created_at DESC
LIMIT 250;
