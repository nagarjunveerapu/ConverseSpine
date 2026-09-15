# Visit date+time Flow

Chrome only. Completing this Flow becomes the same utterance the visit FSM already parses (`2026-09-22 at 10:30 AM`). Trip stops, same-day vs split, origin, and confirm stay in `visit.ts` / `trip-logistics.ts`.

## Publish (Brigade WABA)

1. Meta Business Suite → WhatsApp Manager → **Flows** → Create.
2. Paste `visit-day.json`. Publish.
3. Copy the Flow id into Spine `WA_VISIT_FLOW_ID` (dev `wrangler` var first). Unset keeps the existing **Pick a day** list on the wire.

Test yourself does not need a published id: the packer always attaches the Flow payload, and Desk draws a calendar overlay. Live WhatsApp only opens a native Flow when the id is set.
