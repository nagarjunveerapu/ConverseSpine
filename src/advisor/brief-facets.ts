import type { TurnRuntime } from '../runtime/deps.js';

export interface AdvisorBriefFacets {
  builder_id: string;
  locations: string[];
  bhk: string[];
  property_types: string[];
  plot_sizes: string[];
  project_count: number;
}

const BHK_ORDER = ['1 BHK', '2 BHK', '3 BHK', '4+ BHK'] as const;

export function normalizeBhkLabel(unitType: string): string | null {
  const m = /(\d)\s*bhk/i.exec(unitType.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 10);
  if (n >= 4) return '4+ BHK';
  if (n >= 1) return `${n} BHK`;
  return null;
}

export function normalizePlotSizeLabel(unitType: string): string | null {
  if (normalizeBhkLabel(unitType)) return null;
  const t = unitType.trim();
  if (!t) return null;
  if (/\b(?:sq\.?\s*ft|sqft|acre|acres|cent|cents|ground|guntas?)\b/i.test(t)) return t;
  if (/\b(?:quarter|half|one)\s+acre\b/i.test(t)) {
    return t.replace(/\b\w/g, (c) => c.toUpperCase());
  }
  if (/\b(?:plot|site|parcel|plantation|estate)\b/i.test(t) && t.length <= 48) return t;
  return null;
}

function isLandProjectType(projectType?: string): boolean {
  const lc = (projectType ?? '').toLowerCase();
  return lc.includes('plot') || lc.includes('plantation') || lc === 'plotted';
}

export function briefPropertyTypeLabel(projectType: string): string {
  const lc = projectType.toLowerCase();
  if (lc === 'apartment') return 'Apartment';
  if (lc === 'villa' || lc === 'managed_villa_resort') return 'Villa';
  if (lc === 'plot' || lc === 'plotted') return 'Plot / land';
  if (lc.includes('plantation')) return 'Planted estate';
  return projectType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export async function fetchAdvisorBriefFacets(
  rt: TurnRuntime,
  builderId: string,
): Promise<AdvisorBriefFacets> {
  const resp = await rt.crm.searchProjects({ builder_id: builderId, max_results: 50 });
  const matches = resp.matches;

  const locations = [...new Set(matches.map((m) => m.micro_market).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );

  const propertyTypes = [
    ...new Set(
      matches
        .map((m) => m.project_type)
        .filter(Boolean)
        .map((t) => briefPropertyTypeLabel(t!)),
    ),
  ].sort((a, b) => a.localeCompare(b));

  const bhkSet = new Set<string>();
  const plotSizeSet = new Set<string>();
  const projectById = new Map(matches.map((m) => [m.project_id, m]));
  const projectIds = matches.map((m) => m.project_id);
  for (let i = 0; i < projectIds.length; i += 5) {
    const batch = projectIds.slice(i, i + 5);
    const unitLists = await Promise.all(
      batch.map((id) => rt.crm.listProjectUnits(id).catch(() => ({ units: [] }))),
    );
    for (let j = 0; j < batch.length; j++) {
      const projectId = batch[j]!;
      const project = projectById.get(projectId);
      const land = isLandProjectType(project?.project_type);
      for (const u of unitLists[j]?.units ?? []) {
        if (u.disclosure_tier === 'admin_only') continue;
        const bhkLabel = normalizeBhkLabel(u.unit_type);
        if (bhkLabel && !land) bhkSet.add(bhkLabel);
        const plotLabel = normalizePlotSizeLabel(u.unit_type);
        if (plotLabel && land) plotSizeSet.add(plotLabel);
      }
    }
  }

  const bhk = BHK_ORDER.filter((label) => bhkSet.has(label));
  const plot_sizes = [...plotSizeSet].sort((a, b) => a.localeCompare(b));

  return {
    builder_id: builderId,
    locations,
    bhk,
    property_types: propertyTypes,
    plot_sizes,
    project_count: matches.length,
  };
}
