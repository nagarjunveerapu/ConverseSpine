/** Anonymous advisor session → stable CRM identifiers (matches NayaAdvisor session.ts). */

export function sessionToPhone(sessionId: string): string {
  const hex = sessionId.replace(/-/g, '').slice(0, 10);
  const suffix = hex.padEnd(10, '0').slice(0, 10);
  return `+9190${suffix}`;
}

/** Engine KV state key — one conversation per anonymous session. */
export function sessionToConvId(sessionId: string): string {
  return `advisor:${sessionId}`;
}
