# WhatsApp Flows

Each job is chrome. Completing it becomes a canonical utterance (or a Desk file) the existing FSM / booking table already owns. Trip logistics, RERA, price, and legal clearance stay out of the JSON.

Test yourself does not need a published id: the packer attaches the payload, Desk draws the overlay. Live Graph only opens a native Flow when the matching env id is set.

## Publish (Brigade WABA)

1. WhatsApp Manager → Flows → Create.
2. Paste the JSON. Publish.
3. Copy the id into Spine (`WA_VISIT_FLOW_ID`, `WA_STOPS_FLOW_ID`, `WA_ORIGIN_FLOW_ID`, `WA_BRIEF_FLOW_ID`) or Desk (`WA_KYC_FLOW_ID` for the booking-confirmed door). Unset keeps the list / upload-link fallback.

| Job | JSON | Door | Completes as |
| --- | --- | --- | --- |
| Visit day + time | `visit-day.json` | Buyer asked to visit | `YYYY-MM-DD at 10:30 AM` |
| Which projects | `stops.json` | `visit_ask` which_projects | `Eternia and Cornerstone` / `all of them` |
| Coming from | `origin.json` | `visit_ask` origin | typed area |
| Size, area, budget | `brief.json` | first brief probe | `3 BHK in Yelahanka, Under ₹1 Cr` |
| KYC pack | `kyc.json` | Desk: booking created | `PAN, Aadhaar and photographs uploaded` |
| Applicant | `applicant.json` | same booking event | `Name, PAN …` |
| Loan papers | `loan.json` | funding = loan / they said the bank | `loan through HDFC…` |
| Signed agreement | `agreement.json` | Desk: draft sent | `signed agreement uploaded` |
| Registration date | `regdate.json` | Desk: agreement complete | `sub-registrar on …` (not a site visit) |
| Registration receipt | `receipt.json` | they said registered / the day passed | `registration receipt uploaded` |
