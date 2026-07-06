import type { TurnRuntime } from '../runtime/deps.js';

export interface CatalogProject {
  project_id: string;
  name: string;
  micro_market: string;
  starting_price_display: string;
}

export interface BuilderCatalog {
  builder_id: string;
  builder_name: string;
  projects: CatalogProject[];
  locations: string[];
}

/** Load live catalog from NayaDesk so eval personas match what the builder actually sells. */
export async function fetchBuilderCatalog(
  rt: TurnRuntime,
  builderId: string,
): Promise<BuilderCatalog> {
  const [search, builders] = await Promise.all([
    rt.crm.searchProjects({ builder_id: builderId, max_results: 10 }),
    rt.crm.listBuilders().catch(() => ({ builders: [] as Array<{ builder_id: string; name: string }> })),
  ]);

  const projects = search.matches.map((m) => ({
    project_id: m.project_id,
    name: m.name,
    micro_market: m.micro_market,
    starting_price_display: m.starting_price_display,
  }));

  const locations = [...new Set(projects.map((p) => p.micro_market))];
  const builder_name =
    builders.builders.find((b) => b.builder_id === builderId)?.name ?? builderId;

  return { builder_id: builderId, builder_name, projects, locations };
}

export function catalogSummary(catalog: BuilderCatalog): string {
  const lines = catalog.projects.map(
    (p) => `${p.name} (${p.micro_market}, from ${p.starting_price_display})`,
  );
  return `${catalog.builder_name} catalog: ${lines.join('; ')}`;
}
