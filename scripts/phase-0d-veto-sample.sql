-- Phase 0d veto-class export — answer-intent binds ≥ tau_high (0.78).
-- Offline filter with isFocusedSearchPivot → historical ~64 class.
--
--   cd ../NayaDesk && npx wrangler d1 execute naya-db-dev --remote --env=dev \
--     --file=../ConverseSpine/scripts/phase-0d-veto-sample.sql --json \
--     > /tmp/0d-veto-raw.json

SELECT
  buyer_text,
  sil_intent,
  MAX(sil_score) AS sil_score,
  MAX(created_at) AS last_seen
FROM intent_review_queue
WHERE sil_score >= 0.78
  AND sil_intent IN (
    'get_price',
    'get_legal_info',
    'get_availability',
    'get_unit_configs',
    'get_brochure',
    'get_media',
    'get_amenities',
    'get_location_info',
    'ask_delivery_timeline',
    'get_project_info',
    'ask_about_builder',
    'compute_emi',
    'get_payment_plan',
    'negotiate_price',
    'ask_investment_return'
  )
  AND TRIM(COALESCE(buyer_text, '')) != ''
GROUP BY buyer_text, sil_intent
ORDER BY sil_score DESC, last_seen DESC
LIMIT 800;
