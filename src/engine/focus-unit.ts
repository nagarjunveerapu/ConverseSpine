/**
 * Focused unit pin — remember what configuration the bot already spoke
 * (e.g. "2 BHK (Ivory)") so the next price/all-in ask stays on that unit.
 *
 * Layer: session state + disclosed availability — not compose regex.
 */
export type FocusUnit = {
  projectId: string;
  unitType: string;
  priceDisplay?: string;
  sizeDisplay?: string;
};

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Pick the unit the buyer named (Ivory / 2 BHK Premium) from listed evidence. */
export function pickFocusUnit(
  projectId: string,
  units: ReadonlyArray<{ unitType: string; priceDisplay?: string; sizeDisplay?: string }>,
  buyerText?: string,
  prior?: FocusUnit | null,
): FocusUnit | undefined {
  if (!units.length) return prior?.projectId === projectId ? prior : undefined;

  const text = (buyerText ?? '').trim();
  if (text) {
    const tn = norm(text);
    const ranked = [...units].sort((a, b) => b.unitType.length - a.unitType.length);
    for (const u of ranked) {
      const un = norm(u.unitType);
      if (!un) continue;
      // Full unit string or a distinctive token (Ivory, Fairmont, Comfort, …).
      const distinctive = un.split(' ').filter((t) => t.length >= 4 && !/^\d+$/.test(t) && t !== 'bhk');
      if (tn.includes(un) || distinctive.some((t) => tn.includes(t))) {
        return {
          projectId,
          unitType: u.unitType,
          ...(u.priceDisplay ? { priceDisplay: u.priceDisplay } : {}),
          ...(u.sizeDisplay ? { sizeDisplay: u.sizeDisplay } : {}),
        };
      }
    }
  }

  // Single listed unit after BHK filter → pin it (bot just answered that one).
  if (units.length === 1) {
    const u = units[0]!;
    return {
      projectId,
      unitType: u.unitType,
      ...(u.priceDisplay ? { priceDisplay: u.priceDisplay } : {}),
      ...(u.sizeDisplay ? { sizeDisplay: u.sizeDisplay } : {}),
    };
  }

  if (prior?.projectId === projectId) return prior;
  return undefined;
}

/** Unit type string for pricing / landed-cost Desk calls. */
export function focusUnitTypeForProject(
  focusUnit: FocusUnit | null | undefined,
  projectId: string,
): string | undefined {
  if (!focusUnit || focusUnit.projectId !== projectId) return undefined;
  return focusUnit.unitType.trim() || undefined;
}
