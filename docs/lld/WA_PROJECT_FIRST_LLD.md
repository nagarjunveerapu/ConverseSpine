# WhatsApp project-first — LLD

**Status:** Design — review before code  
**Date:** 2026-08-13  
**Clickable UX:** [`NayaDesk/docs/designs/wa-project-first-smart-chips.html`](../../../NayaDesk/docs/designs/wa-project-first-smart-chips.html)  
**Review board:** [`NayaDesk/docs/designs/wa-project-first-design.html`](../../../NayaDesk/docs/designs/wa-project-first-design.html)

Spine already owns chips (`nba.ts`, cap 6 + board) and speech-act `action_id`s. WhatsApp today only sends **search-recovery** buttons (`slice(0,3)`). This design packs **the same chips** onto WhatsApp primitives and **skips the discovery brief** on bound (and typical builder-wide) lines.

**Does not replace:** SIL / embeddings, visit FSM, Advisor SPA chips, hybrid compose.

---

## 1. Problem

Allotted WhatsApp numbers are **project-bound or a small bag** (apartments / villas / mixed). We still run Advisor-shaped discovery: greet → orient → probe location/budget/BHK (`isBriefReady`) → recommend. That invents a catalog search the buyer is not running, then spends NLU on “what about Sarjapur?”.

Advisor hides this with **unlimited chips + a board**. WhatsApp has **3 reply buttons XOR a list (≤10 rows)** per message. We currently throw away NBA chips on WA.

**Intent:** Advisor conversation on WhatsApp. Same brief ladder (purpose → budget → type → BHK → area → worries → schools → hub → commute-vs-budget), then Desk re-rank. Lists/buttons are chrome. Free text still works after a subject.

**Clickable UX:** [`NayaDesk/docs/designs/wa-advisor-conversation.html`](../../../NayaDesk/docs/designs/wa-advisor-conversation.html)

---

## 2. Non-goals (v1)

- WhatsApp Flows, commerce catalog / product_list, CTA-URL as primary UX
- Open-city search NLU (“what about Sarjapur?” as geo hunt) on bound lines
- `Refine my brief` on bound WA
- Changing Advisor SPA chip trays
- Parallel turn engine / fork of `turn.ts`
- Prod default-on

---

## 3. Channel shapes

| Shape | How we know | First turn |
|---|---|---|
| **Single project** | Builder catalog size 1, or Desk flags the WA number as project-allotted | Welcome to *{project}*. Size list (BHK) if apartment |
| **Bag (2–10)** | Catalog 2–10 live projects, or CP allotted set | List of projects (sections: Apartments / Villas if mixed) |
| **Wide book (>10)** | Rare; out of v1 list cap | v1: first list = types or top 9 + “More”; Flows later |

**Even builder-wide:** run the Advisor brief (chips as lists/buttons). Do not dump the book on Hi.

**Bound** = single or bag. Skip `orient` / `probe` / `isBriefReady` when flag on + channel `whatsapp`.

---

## 4. WhatsApp primitives (locked)

One outbound message is **either** buttons **or** list — never both (Cloud API `interactive.type`).

| Primitive | Limit | Use |
|---|---|---|
| Reply buttons | 3, title ≤20 chars | Jobs + one escape |
| List | ≤10 rows, title ≤24, desc ≤72, 1 open button ≤20 | Closed sets of 4+: projects, BHK, budget bands, extra days |
| Free text | always | EMI, objection, “Saturday after 4” |
| Media | brochure / floor plan | After a subject |

Buttons die after the next inbound. **Re-attach the same packing every bot turn.**

---

## 5. Chip packing (Advisor → WA)

Source of labels: existing `nba.ts` + `BRIEF_OPTIONS` (Advisor). Do not invent a second taxonomy.

### 5.1 Classification

| Advisor chip | Kind | WA |
|---|---|---|
| `1 BHK` … `4+ BHK`, budget bands, apt/villa/plot | Brief tray, 4+ | **List rows** |
| Project names (`clarify_project_pick`, bag) | Pick | **List rows** |
| `Starting prices`, `Plan a visit day`, `EMI`, brochure | Job | **Reply button** (max 2) |
| `Back to my matches` | Rail | **Slot 3 `Projects`** or list row `← Projects` |
| `Refine my brief`, `Change area`, `Adjust budget` | Search rail | **Drop** on bound WA |
| `Compare all N` | Board job | List **is** the board — do not spend a button |
| `Saturday morning`, `Sunday` | ≤2 days | Two buttons + `Projects` |
| 3+ visit slots | Closed set | List (same as BHK) |

### 5.2 Two message shapes

**LIST turn** (pick / BHK / overflow menu):

- Body: one sentence + subject
- `action.button`: `Choose` / `See projects` / `Choose size` (≤20)
- Rows: optional first row `← Projects` (`id=wa.menu.projects`), then options
- **No reply buttons** on this bubble

**BUTTON turn** (jobs, after a subject exists):

| Slot | Label (≤20) | `id` |
|---|---|---|
| 1 | `Price / EMI` or `Starting prices` | `answer_price` (existing) |
| 2 | `Book a visit` | `visit_book` (existing) |
| 3 | `Projects` | `wa.menu.projects` |

Single-project line: slot 3 = `Brochure` (`answer_media`) — there is no bag to return to.

### 5.3 Psychological runway

Never ask the buyer to type Back. Escape is always a **tap**:

- On a button turn → slot 3 `Projects`
- On a list turn → first row `← Projects`

Two taps (Projects → pick) is acceptable. Typing is not.

---

## 6. Wrapper module (flagged)

**Not a second engine.** One packer + one discover gate.

### 6.1 Flag

| Env | Dig | Prod | Meaning |
|---|---|---|---|
| `WA_PROJECT_FIRST` | `on` | `off` | Pack chips + skip brief on `channel=whatsapp` |

Resolve like `HYBRID_COMPOSE`: unset on dig → `on`; prod wrangler sets `off` until review.

Per-turn debug: `TurnDebug.wa_project_first: boolean`, `wa_pack: 'list' | 'buttons' | 'text'`.

### 6.2 Modules

| File | Role |
|---|---|
| `src/channel/wa-pack.ts` | **New.** `packWhatsAppInteractive(nbaChips, state, goal) → { kind: 'buttons' \| 'list', … }` |
| `src/channel/whatsapp-client.ts` | Add `sendInteractiveList` (buttons already exist) |
| `src/webhook/whatsapp.ts` + `turn_debouncer.ts` | Send packed payload; already read `list_reply` / `button_reply` as `action_id` |
| `src/engine/phases/discover.ts` | If flag + whatsapp + bound: do not return `orient` / `probe`; first recommend/list is the bag |
| `src/engine/turn.ts` | When flag on, `whatsappActions` come from packer, not recovery-only `slice(0,3)` |

**Why not `compose.ts`:** copy stays templates; packing is channel chrome.  
**Why not SIL:** subject is a tap `action_id`, not an embedding miss.  
**Why not Advisor `nba.ts` rewrite:** Advisor still cap-6 + board; packer is WA-only.

### 6.3 `action_id` contract

Reuse speech-act catalog ids where they exist. New ids only for nav/pick/brief:

| id | Resolves to |
|---|---|
| `answer_price`, `answer_emi`, `answer_media`, `visit_book`, … | Existing `CHIP_CATALOG` |
| `wa.menu.projects` | Clear focus → re-offer bag/board list (new, packer-owned) |
| `wa.pick.{projectId}` | Commit/focus that project (maps to existing pick / `namedProjects`) |
| `wa.bhk.1_bhk` … `wa.bhk.4_plus` | Constraint `bhk` only — **speechAct search not required** if already focused |
| `wa.day.tomorrow` / `wa.day.weekend` | Visit slot (existing visit FSM) |

Webhook already sets `text = title`, `action_id = id`. Packer ids must be stable and ≤256 chars.

---

## 7. Turn sequences (v1)

### 7.1 Bag — happy path

1. Inbound Hi → Advisor greet + **BUTTONS** Self-use / Investment / Not sure.
2. Budget / type / BHK / area / worries → **LIST** (BHK includes Done for 2+3).
3. Schools → two buttons; hub → list; commute vs budget → three buttons.
4. Ranked matches → thin “N matches are on your board” + **LIST** with fit in the row description.
5. Tap a match → thin commit + size or jobs (not the overview card).

### 7.2 Back / shortlist / multi-visit

- Shortlist stays in entity store (unchanged). Re-show as list (`Your board` row + names).
- Multi-visit: after book, buttons `Add a visit` + `Projects`; add-visit opens project list.
- `wa.menu.projects` = `popFocus` + list; not `release_project` into city-wide search.

### 7.3 Skip brief (discover gate)

When `WA_PROJECT_FIRST` and `channel=whatsapp` and catalog/bag size ≤10:

- `isBriefReady` **does not block** showing the book.
- Do not emit `orient` / `probe` for location/budget.
- After a pick, optional BHK list if the project has multiple configs; skip if only one.

Free text may still fill location/budget **after** focus (filter configs, not rediscover Bangalore).

---

## 8. Today vs v1 (WA send path)

```
TODAY
  handleChat → whatsapp_actions = recovery.slice(0,3) only
  sendInteractiveButtons | sendText
  NBA chips discarded

V1 (flag on)
  handleChat → nba chips (same as Advisor) + goal + shortlist
  wa-pack → buttons | list | text
  sendInteractiveButtons | sendInteractiveList | sendText
```

Ingress is already correct (`button_reply` / `list_reply` → `action_id`). Missing piece is **outbound pack + skip brief**.

---

## 9. Test plan

### 9.1 Dig (no Meta) — ship gate

Script (new): `scripts/run-wa-project-first.ts`

| Step | Inbound | Expect |
|---|---|---|
| 1 | `hi` | List of bag; no “area and budget” probe |
| 2 | `action_id=wa.pick.{id}` | BHK list, not `clarify_project_pick` loop |
| 3 | `wa.bhk.3_bhk` | 3 buttons including `Projects` |
| 4 | `answer_price` | Price copy + 3 buttons again |
| 5 | `wa.menu.projects` | Bag/board list; focus cleared |
| 6 | text `EMI?` after pick | Facet answer; still focused |
| 7 | `visit_book` → day | Visit FSM; itinerary can add stop |

Flag **off**: same script must fall back to current brief/recommend (no packer).

Unit: `tests/wa-pack.test.ts` — BHK → list; 2 jobs + rail → 3 buttons; refine-brief dropped; titles ≤20/24.

### 9.2 Developer WhatsApp (your access)

You do **not** need a registered business for this:

1. Meta Developer App → WhatsApp → API Setup (Cloud API **test number**).
2. Add **your** phone as tester; accept on device.
3. Point webhook to Spine **dig** (already: `list_reply` works).
4. **You text the test number first** (opens 24h session).
5. Walk §7.1 on the real client (button vs list chrome).

Limits: only testers, “test” display name, templates/outside-24h weak. **Buttons + lists work inside the window.** That is enough to feel the runway.

### 9.3 Quality

Read replies (no-quality-regression). Bound line must **not** ask area/budget before showing projects. `Refine my brief` must not appear. Slot 3 / first row always leaves without typing.

---

## 10. Rollout

1. Review this LLD + HTML.  
2. Implement packer + flag **dig on / prod off**.  
3. Dig script green + you tap the test number.  
4. Prod `WA_PROJECT_FIRST=on` only after that soak — not in the first PR.

---

## 11. Open questions (review)

1. **Single-project slot 3:** Brochure vs a no-op Menu? (Design default: Brochure.)  
2. **BHK multi-select** (Advisor allows 2+3 BHK): v1 **single pick** on WA list (one row). Multi later via Flows or “both” free text.  
3. **Bag source of truth:** full builder catalog vs Desk allotted-to-this-number? Need Desk field if CP bags ≠ full catalog.  
4. **Wide book >10:** defer Flows, or two-step type list then project list?

---

## 12. Definition of done (after implementation)

- [ ] Flag off ≡ today’s WA path  
- [ ] Flag on + bag: no location/budget probe before list  
- [ ] BHK is a list, not 4 buttons  
- [ ] Every job turn re-attaches Price / Visit / Projects  
- [ ] Dig script + unit pack tests green  
- [ ] Developer-number walk feels like chips, not an interview
