/** Anonymous advisor session → stable CRM identifiers (matches NayaAdvisor session.ts). */

export function sessionToPhone(sessionId: string): string {
  const hex = sessionId.replace(/-/g, '').slice(0, 10);
  const suffix = hex.padEnd(10, '0').slice(0, 10);
  return `+9190${suffix}`;
}

/**
 * Engine L0 state key — one running chat per anonymous advisor session.
 *
 * SPINE-LOCAL, and neither a lead id nor a thread id. The advisor web door has
 * no Desk identity until the A5 reveal supplies a real phone number, so the
 * engine keys its own state on the session. Never post this value to Desk;
 * `ThreadState.ndThreadId` is the field that names something Desk can find.
 */
export function sessionToStateKey(sessionId: string): string {
  return `advisor:${sessionId}`;
}
