import Handlebars from 'handlebars';

/** Embedded templates — Workers have no filesystem; .hbs files are source-of-truth for editing only. */
const SOURCES: Record<string, string> = {
  greeting: `Welcome to {{builder}}. I'm your property advisor on WhatsApp.

Tell me what you're looking for — location, budget, BHK — or name a project like Ayana or Utopia. I'll pull live options from our catalog.`,

  list: `{{#if location}}Here are options{{#if budget}} within {{budget}}{{/if}} around *{{location}}*:
{{else}}Here are projects that match what you've shared:
{{/if}}
{{#each projects}}
• *{{name}}* — {{micro_market}}, from {{#if starting_price_display}}{{starting_price_display}}{{else}}₹{{starting_price_lakhs}} L{{/if}}{{#if match_reasons.length}} ({{match_reasons.[0]}}){{/if}}
{{/each}}
{{#unless projects.length}}I couldn't find a match in the catalog with those filters. Try a nearby area or a higher budget?{{/unless}}
{{#if projects.length}}
Reply with a project name for details, pricing, or a site visit.{{/if}}`,

  detail: `*{{name}}* — {{micro_market}}
{{#if starting_price_display}}Starting from {{starting_price_display}}{{else}}Prices from ₹{{starting_price_lakhs}} L{{/if}}
{{#if rera}}RERA: {{rera}}{{/if}}

Want a price breakdown, brochure, or to book a site visit?`,

  pricing: `Pricing for *{{project_name}}*:

{{#each components}}
• {{label}}: {{value_display}}
{{/each}}

Want a floor plan, EMI estimate, or to book a site visit?`,

  visit_confirm: `Done — your visit to *{{project_name}}* is confirmed for *{{human_label}}*.

You'll get directions before the day. If anything changes, message me here.`,

  visit_ask_day: `Which day works for your site visit{{#if project_name}} to *{{project_name}}*{{/if}}? For example: Saturday, tomorrow, or Sunday morning.`,

  legal: `{{#if project_name}}*{{project_name}}* — regulatory snapshot:
{{else}}Regulatory snapshot:
{{/if}}
{{#each items}}
• {{label}}: {{value}}
{{/each}}
{{#unless items.length}}Legal details are on file — I can share what's approved for disclosure on a call or visit.{{/unless}}

Want pricing, a brochure, or to book a site visit?`,

  objection: `I hear you on {{topic}}. {{reframe}}

{{#if project_name}}For *{{project_name}}*, I can share exact numbers from our catalog — or we can do a quick site visit so you see it firsthand.{{/if}}`,
};

const compiled: Record<string, HandlebarsTemplateDelegate> = {};

export function renderTemplate(name: string, data: Record<string, unknown>): string {
  if (!compiled[name]) {
    const src = SOURCES[name];
    if (!src) throw new Error(`unknown_template:${name}`);
    compiled[name] = Handlebars.compile(src);
  }
  return compiled[name]!(data);
}
