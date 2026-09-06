import type { ExplanationItem, Mission, MissionPreferences, Opportunity, OptimizerConfig, WorldState } from "../domain/types.js";
import { DEFAULT_CONFIG } from "../domain/types.js";
import { FixtureRoutingProvider, type RoutingProvider } from "../routing/routing-provider.js";
import { initialSearchState, transition, type SearchState } from "./state.js";
import { buildMission, partialScore, scoreState } from "../scoring/scoring.js";
import { eur } from "../utils/money.js";
import { isoAt, parseTime } from "../utils/time.js";

interface Candidate {
  state: SearchState;
  sequence: string[];
}

export class RouteOptimizer {
  private readonly config: OptimizerConfig;

  constructor(config: OptimizerConfig = DEFAULT_CONFIG) {
    this.config = config;
  }

  optimize(world: WorldState, preferences: MissionPreferences): Mission[] {
    const normalized: Required<Pick<MissionPreferences, "beamWidth" | "lookaheadDepth" | "maxStops" | "topN" | "excludeNegativeContribution">> & MissionPreferences = {
      beamWidth: preferences.beamWidth ?? 20,
      lookaheadDepth: preferences.lookaheadDepth ?? 3,
      maxStops: preferences.maxStops ?? Math.max(3, preferences.lookaheadDepth ?? 3),
      topN: preferences.topN ?? this.config.maxAlternatives,
      excludeNegativeContribution: preferences.excludeNegativeContribution ?? false,
      ...preferences,
    };
    const routing = new FixtureRoutingProvider(world);
    const mandatoryIds = world.confirmedBookings.filter((booking) => booking.status === "CONFIRMED" && booking.driverId === world.driver.id).map((booking) => booking.opportunityId);
    const rejections: ExplanationItem[] = [];
    const initial = initialSearchState(world);
    let beam: Candidate[] = [{ state: initial, sequence: [] }];
    const allCandidates: Candidate[] = [];
    const depthLimit = Math.min(normalized.maxStops, normalized.lookaheadDepth);

    for (let depth = 0; depth < depthLimit; depth += 1) {
      const expanded: Candidate[] = [];
      for (const candidate of beam) {
        allCandidates.push(candidate);
        for (const opportunity of world.opportunities) {
          if (candidate.sequence.includes(opportunity.id)) continue;
          const vehicles = this.vehiclesToTry(world, candidate.state, opportunity);
          let accepted = false;
          for (const vehicle of vehicles) {
            const result = transition(world, candidate.state, opportunity, routing, vehicle, this.config.transferBufferMinutes[normalized.riskProfile]);
            if (!result.rejection) {
              const deltaRevenue = result.state.totalRevenueMinor - candidate.state.totalRevenueMinor;
              const deltaCost = result.state.totalCostMinor - candidate.state.totalCostMinor;
              if (normalized.excludeNegativeContribution && deltaRevenue <= deltaCost) continue;
              expanded.push({ state: result.state, sequence: [...candidate.sequence, opportunity.id] });
              accepted = true;
              break;
            }
            if (rejections.length < 20) rejections.push({ kind: "REJECTED", text: result.rejection.reason, opportunityId: result.rejection.opportunityId });
          }
          if (!accepted && vehicles.length === 0 && rejections.length < 20) rejections.push({ kind: "REJECTED", text: "Kein passendes Fahrzeug oder Transportmittel verfügbar.", opportunityId: opportunity.id });
        }
      }
      if (expanded.length === 0) break;
      expanded.sort((a, b) => this.comparePartial(a, b, world, normalized, mandatoryIds));
      beam = this.dedupe(expanded).slice(0, normalized.beamWidth);
      allCandidates.push(...beam);
    }
    allCandidates.push(...beam);
    const localCandidates = this.localSearch(world, allCandidates, normalized);
    let feasible = [...allCandidates, ...localCandidates].filter((candidate) => this.isFinalCandidate(candidate, world, normalized, mandatoryIds));
    if (feasible.length === 0 && normalized.optimizationMode === "DESTINATION") {
      const transfer = this.destinationTransfer(world, normalized, routing);
      if (transfer) feasible = [transfer];
    }
    const unique = this.dedupe(feasible).sort((a, b) => this.compareFinal(a, b, world, normalized));
    const missions: Mission[] = [];
    const seen = new Set<string>();
    for (const candidate of unique) {
      const key = candidate.sequence.join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      const score = scoreState(candidate.state, world.driver.availableFrom, normalized, this.config);
      const explanations: ExplanationItem[] = [
        { kind: "INFO", text: "Alle Hard Constraints der zurückgegebenen Route sind erfüllt." },
        { kind: "INFO", text: `Mehrstufige Suche mit Lookahead-Tiefe ${normalized.lookaheadDepth} und Beam Width ${normalized.beamWidth}.` },
      ];
      if (candidate.sequence.length > 1) explanations.push({ kind: "POSITIVE", text: "Folgeaufträge wurden gegenüber isolierten Einzelaufträgen berücksichtigt." });
      missions.push(buildMission(`mission-${missions.length + 1}`, candidate.state, world.driver.id, world.driver.availableFrom, normalized, score, world.driver.currentLocation, [...explanations, ...rejections.slice(0, 3)]));
      if (missions.length >= normalized.topN) break;
    }
    return missions;
  }

  private vehiclesToTry(world: WorldState, state: SearchState, opportunity: Opportunity) {
    if (opportunity.type !== "VEHICLE_TRANSFER") return [state.currentVehicleId ? world.vehicles.find((vehicle) => vehicle.id === state.currentVehicleId) : undefined];
    const booking = world.confirmedBookings.find((item) => item.opportunityId === opportunity.id && item.status === "CONFIRMED" && item.driverId === world.driver.id);
    if (booking?.vehicleId) return world.vehicles.filter((vehicle) => vehicle.id === booking.vehicleId && !state.usedVehicleIds.includes(vehicle.id));
    return world.vehicles.filter((vehicle) => vehicle.availabilityStatus === "AVAILABLE" && !state.usedVehicleIds.includes(vehicle.id));
  }

  private comparePartial(a: Candidate, b: Candidate, world: WorldState, preferences: MissionPreferences, mandatoryIds: string[]): number {
    const scoreA = partialScore(a.state, world.driver.availableFrom, preferences, this.config, mandatoryIds);
    const scoreB = partialScore(b.state, world.driver.availableFrom, preferences, this.config, mandatoryIds);
    return scoreB - scoreA || a.sequence.join("|").localeCompare(b.sequence.join("|"));
  }

  private compareFinal(a: Candidate, b: Candidate, world: WorldState, preferences: MissionPreferences): number {
    const scoreA = scoreState(a.state, world.driver.availableFrom, preferences, this.config);
    const scoreB = scoreState(b.state, world.driver.availableFrom, preferences, this.config);
    return scoreB.finalScore - scoreA.finalScore || (scoreB.estimatedSurplus.amountMinor - scoreA.estimatedSurplus.amountMinor) || (scoreB.revenuePerHour - scoreA.revenuePerHour) || (scoreA.riskPenalty - scoreB.riskPenalty) || a.sequence.join("|").localeCompare(b.sequence.join("|"));
  }

  private isFinalCandidate(candidate: Candidate, world: WorldState, preferences: MissionPreferences, mandatoryIds: string[]): boolean {
    if (preferences.maxStops !== undefined && candidate.sequence.length > preferences.maxStops) return false;
    if (mandatoryIds.some((id) => !candidate.sequence.includes(id))) return false;
    if (preferences.optimizationMode === "DESTINATION") {
      return Boolean(preferences.targetDestination && preferences.destinationDeadline && candidate.state.location.city === preferences.targetDestination.city && parseTime(candidate.state.currentTime) <= parseTime(preferences.destinationDeadline));
    }
    return candidate.sequence.length > 0;
  }

  private dedupe(candidates: Candidate[]): Candidate[] {
    const seen = new Set<string>();
    return candidates.filter((candidate) => {
      const key = candidate.sequence.join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private localSearch(world: WorldState, candidates: Candidate[], preferences: MissionPreferences): Candidate[] {
    const routing: RoutingProvider = new FixtureRoutingProvider(world);
    const result: Candidate[] = [];
    const seeds = this.dedupe(candidates).sort((a, b) => this.compareFinal(a, b, world, preferences)).slice(0, 8);
    for (const seed of seeds) {
      const variants: string[][] = [];
      if (seed.sequence.length > 1) for (let index = 0; index < seed.sequence.length; index += 1) variants.push(seed.sequence.filter((_, candidateIndex) => candidateIndex !== index));
      for (let index = 0; index < seed.sequence.length; index += 1) {
        for (const replacement of world.opportunities) if (!seed.sequence.includes(replacement.id)) variants.push(seed.sequence.map((id, candidateIndex) => candidateIndex === index ? replacement.id : id));
      }
      for (let index = 0; index < seed.sequence.length; index += 1) for (let other = index + 1; other < seed.sequence.length; other += 1) {
        const swapped = [...seed.sequence];
        const first = swapped[index];
        const second = swapped[other];
        if (first === undefined || second === undefined) continue;
        swapped[index] = second;
        swapped[other] = first;
        variants.push(swapped);
      }
      for (const sequence of variants.slice(0, 40)) {
        const replayed = this.replay(world, sequence, routing, this.config.transferBufferMinutes[preferences.riskProfile]);
        if (replayed) result.push(replayed);
      }
    }
    return result;
  }

  private replay(world: WorldState, sequence: string[], routing: RoutingProvider, transferBufferMinutes: number): Candidate | undefined {
    let state = initialSearchState(world);
    for (const id of sequence) {
      const opportunity = world.opportunities.find((item) => item.id === id);
      if (!opportunity) return undefined;
      const vehicles = this.vehiclesToTry(world, state, opportunity);
      let next: SearchState | undefined;
      for (const vehicle of vehicles) {
        const result = transition(world, state, opportunity, routing, vehicle, transferBufferMinutes);
        if (!result.rejection) { next = result.state; break; }
      }
      if (!next) return undefined;
      state = next;
    }
    return { state, sequence };
  }

  private destinationTransfer(world: WorldState, preferences: MissionPreferences, routing: RoutingProvider): Candidate | undefined {
    if (!preferences.targetDestination || !preferences.destinationDeadline) return undefined;
    const state = initialSearchState(world);
    const latestArrival = Math.min(parseTime(preferences.destinationDeadline), parseTime(world.driver.availableUntil));
    const routes = routing.getRoutes({ origin: state.location, destination: preferences.targetDestination, departureTime: state.currentTime, transportMode: state.transportMode })
      .sort((a, b) => parseTime(a.arrivalTime) - parseTime(b.arrivalTime) || a.cost.amountMinor - b.cost.amountMinor || (a.connectionId ?? "").localeCompare(b.connectionId ?? ""));
    const route = routes.find((candidate) => parseTime(candidate.arrivalTime) <= latestArrival);
    if (!route) return undefined;
    const next: SearchState = { ...state, location: preferences.targetDestination, currentTime: route.arrivalTime, legs: [{ type: route.mode === "PUBLIC_TRANSPORT" ? "TRAIN" : "WALK", origin: state.location, destination: preferences.targetDestination, departureTime: route.departureTime, arrivalTime: route.arrivalTime, revenue: eur(0), cost: route.cost, distanceKm: route.distanceKm, durationMinutes: route.durationMinutes, confidence: route.confidence }], totalCostMinor: route.cost.amountMinor, emptyDistanceKm: route.distanceKm };
    return { state: next, sequence: [] };
  }
}
