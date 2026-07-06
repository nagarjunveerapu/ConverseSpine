import type { ProjectDetail } from '../engine/types.js';

export interface AdvisorProjectDetailDto {
  project_id: string;
  name: string;
  micro_market: string;
  summary?: string;
  rera_number?: string;
  possession?: string;
  project_type?: string;
  starting_price_display?: string;
  khata?: string;
  na_status?: string;
  ec_status?: string;
  loan_eligibility?: string;
  configurations?: Array<{ unit_type: string; price_display: string; price_min_inr: number }>;
  location?: {
    connectivity_summary?: string;
    micro_market_overview?: string;
    nearby_pois?: string[];
    drive_times?: string[];
  };
  faqs?: Array<{ question_key: string; question: string; answer: string }>;
}

export function mapProjectDetailDto(d: ProjectDetail): AdvisorProjectDetailDto {
  return {
    project_id: d.projectId,
    name: d.name,
    micro_market: d.microMarket,
    ...(d.summary ? { summary: d.summary } : {}),
    ...(d.reraNumber ? { rera_number: d.reraNumber } : {}),
    ...(d.possession ? { possession: d.possession } : {}),
    ...(d.projectType ? { project_type: d.projectType } : {}),
    ...(d.startingPriceDisplay ? { starting_price_display: d.startingPriceDisplay } : {}),
    ...(d.khata ? { khata: d.khata } : {}),
    ...(d.naStatus ? { na_status: d.naStatus } : {}),
    ...(d.ecStatus ? { ec_status: d.ecStatus } : {}),
    ...(d.loanEligibility ? { loan_eligibility: d.loanEligibility } : {}),
    ...(d.configurations?.length
      ? {
          configurations: d.configurations.map((c) => ({
            unit_type: c.unitType,
            price_display: c.priceDisplay,
            price_min_inr: c.priceMinInr,
          })),
        }
      : {}),
    ...(d.location
      ? {
          location: {
            ...(d.location.connectivitySummary
              ? { connectivity_summary: d.location.connectivitySummary }
              : {}),
            ...(d.location.microMarketOverview
              ? { micro_market_overview: d.location.microMarketOverview }
              : {}),
            ...(d.location.nearbyPois?.length ? { nearby_pois: d.location.nearbyPois } : {}),
            ...(d.location.driveTimes?.length ? { drive_times: d.location.driveTimes } : {}),
          },
        }
      : {}),
    ...(d.faqs?.length
      ? {
          faqs: d.faqs.map((f) => ({
            question_key: f.questionKey,
            question: f.question,
            answer: f.answer,
          })),
        }
      : {}),
  };
}
