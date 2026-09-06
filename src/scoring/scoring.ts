import type { Location, Mission, MissionPreferences, MissionLeg, OptimizerConfig, RiskProfile, ScoreBreakdown } from "../domain/types.js";
import type { SearchState } from "../optimizer/state.js";
import { eur } from "../utils/money.js";
import { minutesBetween, parseTime } from "../utils/time.js";

const MINOR_UNITS_PER_EURO = 100;
const REVENUE_PER_HOUR_SCORE_SCALE = 100;

export function scoreState(state: SearchState, startTime: string, preferences: MissionPreferences, config: OptimizerConfig): ScoreBreakdown {
  const duration = Math.max(1, minutesBetween(startTime, state.currentTime));
  return scoreTotals(state.totalRevenueMinor, state.totalCostMinor, duration, state.lowConfidenceCount, state.emptyDistanceKm, state.location, state.currentTime, preferences, config);
}

function scoreTotals(totalRevenueMinor: number, totalCostMinor: number, duration: number, lowConfidenceCount: number, emptyDistanceKm: number, finalLocation: Location | undefined, finalTime: string, preferences: MissionPreferences, config: OptimizerConfig): ScoreBreakdown {
  const revenuePerHour = totalRevenueMinor / MINOR_UNITS_PER_EURO / (duration / 60);
  const riskPenalty = lowConfidenceCount * config.riskPenaltyPerLowConfidence[preferences.riskProfile];
  const surplusMinor = totalRevenueMinor - totalCostMinor;
  const atDestination = finalLocation && preferences.targetDestination && finalLocation.city === preferences.targetDestination.city;
  const destination = !preferences.targetDestination || !preferences.destinationDeadline || (atDestination && parseTime(finalTime) <= parseTime(preferences.destinationDeadline)) ? 0 : Number.NEGATIVE_INFINITY;
  let finalScore: number;
  if (preferences.optimizationMode === "MAX_REVENUE") finalScore = totalRevenueMinor;
  else if (preferences.optimizationMode === "MAX_ESTIMATED_SURPLUS") finalScore = surplusMinor;
  else if (preferences.optimizationMode === "MAX_REVENUE_PER_HOUR") finalScore = revenuePerHour * REVENUE_PER_HOUR_SCORE_SCALE;
  else if (preferences.optimizationMode === "DESTINATION") finalScore = totalRevenueMinor;
  else {
    const weights = config.balancedWeights;
    finalScore = totalRevenueMinor / MINOR_UNITS_PER_EURO * weights.revenue + surplusMinor / MINOR_UNITS_PER_EURO * weights.surplus + revenuePerHour * weights.revenuePerHour - riskPenalty * weights.risk;
  }
  if (preferences.optimizationMode !== "BALANCED") finalScore -= riskPenalty;
  if (preferences.optimizationMode === "DESTINATION" && destination === Number.NEGATIVE_INFINITY) finalScore = Number.NEGATIVE_INFINITY;
  return { totalRevenue: eur(totalRevenueMinor), estimatedTravelCosts: eur(totalCostMinor), estimatedOtherCosts: eur(0), estimatedSurplus: eur(surplusMinor), missionDurationMinutes: duration, revenuePerHour, emptyDistanceKm, riskPenalty, softConstraintPenalty: 0, finalScore };
}

export function scoreLegs(legs: MissionLeg[], startTime: string, preferences: MissionPreferences, config: OptimizerConfig): ScoreBreakdown {
  const lastArrival = legs.at(-1)?.arrivalTime ?? startTime;
  const duration = Math.max(1, minutesBetween(startTime, lastArrival));
  const totalRevenueMinor = legs.reduce((sum, leg) => sum + leg.revenue.amountMinor, 0);
  const totalCostMinor = legs.reduce((sum, leg) => sum + leg.cost.amountMinor, 0);
  const lowConfidenceCount = legs.filter((leg) => leg.confidence === "LOW").length;
  const emptyDistanceKm = legs.filter((leg) => leg.type !== "WAIT" && leg.type !== "OPPORTUNITY_SERVICE").reduce((sum, leg) => sum + leg.distanceKm, 0);
  return scoreTotals(totalRevenueMinor, totalCostMinor, duration, lowConfidenceCount, emptyDistanceKm, legs.at(-1)?.destination, lastArrival, preferences, config);
}

export function partialScore(state: SearchState, startTime: string, preferences: MissionPreferences, config: OptimizerConfig, mandatoryIds: string[]): number {
  const score = scoreState(state, startTime, preferences, config).finalScore;
  const missingMandatory = mandatoryIds.filter((id) => !state.usedOpportunityIds.includes(id)).length;
  return score + (mandatoryIds.length - missingMandatory) * 1_000_000 - missingMandatory * 100;
}

export function riskProfileLabel(profile: RiskProfile): string {
  return profile === "SAFE" ? "großen" : profile === "NORMAL" ? "mittleren" : "knappen";
}

export function buildMission(id: string, state: SearchState, worldDriverId: string, startTime: string, preferences: MissionPreferences, score: ScoreBreakdown, startLocation: Mission["startLocation"], explanations: Mission["explanationItems"]): Mission {
  return { id, driverId: worldDriverId, startTime, startLocation, optimizationMode: preferences.optimizationMode, riskProfile: preferences.riskProfile, targetDestination: preferences.targetDestination, destinationDeadline: preferences.destinationDeadline, legs: state.legs, scoreBreakdown: score, explanationItems: [...explanations, ...state.explanationItems] };
}
