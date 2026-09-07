import { describe, expect, it } from "vitest";
import { createBaseWorld, createDemoWorld, createSyntheticOpportunities, opportunity, cargo } from "../src/fixtures/world.js";
import { LOCATIONS } from "../src/fixtures/locations.js";
import { RouteOptimizer } from "../src/optimizer/optimizer.js";
import { FixtureRoutingProvider } from "../src/routing/routing-provider.js";
import { initialSearchState, transition } from "../src/optimizer/state.js";
import { replan } from "../src/optimizer/replanning.js";
import { DEFAULT_CONFIG, type Mission, type WorldState } from "../src/domain/types.js";
import { scoreLegs } from "../src/scoring/scoring.js";
import { eur } from "../src/utils/money.js";

const optimizer = new RouteOptimizer();

describe("Route optimizer proof of concept", () => {
  it("A – rejects an opportunity with an unreachable hard pickup window", () => {
    const world = createBaseWorld();
    world.opportunities = [opportunity("late-pickup", "DIRECT_ORDER", "Hamburg urgent", "HAMBURG", "BREMEN", 10000, "2026-09-07T06:00:00.000Z", "2026-09-07T06:30:00.000Z", "2026-09-07T08:00:00.000Z", "2026-09-07T12:00:00.000Z", 10, [cargo("Tiny", "TINY", 1)])];
    expect(optimizer.optimize(world, { optimizationMode: "MAX_REVENUE", riskProfile: "NORMAL" })).toHaveLength(0);
  });

  it("B – does not use a vehicle that is in another city", () => {
    const world = createBaseWorld();
    world.driver.currentLocation = LOCATIONS.HAMBURG;
    world.driver.currentTransportMode = "PUBLIC_TRANSPORT";
    world.driver.availableFrom = "2026-09-07T06:00:00.000Z";
    world.opportunities = [opportunity("washer", "CARGO_TRANSPORT", "Waschmaschine Hamburg → Bremen", "HAMBURG", "BREMEN", 14000, "2026-09-07T06:00:00.000Z", "2026-09-07T08:00:00.000Z", "2026-09-07T08:00:00.000Z", "2026-09-07T14:00:00.000Z", 10, [cargo("Waschmaschine", "MEDIUM", 75)])];
    expect(optimizer.optimize(world, { optimizationMode: "MAX_REVENUE", riskProfile: "NORMAL" })).toHaveLength(0);
  });

  it("C – allows a tiny parcel on public transport but not a washing machine", () => {
    const world = createBaseWorld();
    world.driver.currentLocation = LOCATIONS.HAMBURG;
    world.driver.currentTransportMode = "PUBLIC_TRANSPORT";
    world.opportunities = [opportunity("parcel", "CARGO_TRANSPORT", "Paket Hamburg → Bremen", "HAMBURG", "BREMEN", 4000, "2026-09-07T06:00:00.000Z", "2026-09-07T08:00:00.000Z", "2026-09-07T07:00:00.000Z", "2026-09-07T12:00:00.000Z", 10, [cargo("Paket", "TINY", 1)])];
    const missions = optimizer.optimize(world, { optimizationMode: "MAX_REVENUE", riskProfile: "NORMAL" });
    expect(missions[0]?.scoreBreakdown.totalRevenue.amountMinor).toBe(4000);
    world.opportunities.push(opportunity("washer-2", "CARGO_TRANSPORT", "Waschmaschine Hamburg → Bremen", "HAMBURG", "BREMEN", 14000, "2026-09-07T06:00:00.000Z", "2026-09-07T08:00:00.000Z", "2026-09-07T08:00:00.000Z", "2026-09-07T14:00:00.000Z", 10, [cargo("Waschmaschine", "MEDIUM", 75)]));
    expect(optimizer.optimize(world, { optimizationMode: "MAX_REVENUE", riskProfile: "NORMAL" })[0]?.scoreBreakdown.totalRevenue.amountMinor).toBe(4000);
  });

  it("D – finds the profitable three-step lookahead chain", () => {
    const world = createBaseWorld();
    world.opportunities = [
      opportunity("a", "VEHICLE_TRANSFER", "A Düsseldorf → Frankfurt", "DUSSELDORF", "FRANKFURT", 16000, "2026-09-07T06:00:00.000Z", "2026-09-07T07:00:00.000Z", "2026-09-07T09:00:00.000Z", "2026-09-07T18:00:00.000Z", 30),
      opportunity("b", "VEHICLE_TRANSFER", "B Düsseldorf → Hamburg", "DUSSELDORF", "HAMBURG", 12000, "2026-09-07T06:00:00.000Z", "2026-09-07T07:00:00.000Z", "2026-09-07T09:00:00.000Z", "2026-09-07T16:00:00.000Z", 30),
      opportunity("c", "CARGO_TRANSPORT", "Cargo Hamburg → Bremen", "HAMBURG", "BREMEN", 13000, "2026-09-07T10:00:00.000Z", "2026-09-07T16:00:00.000Z", "2026-09-07T12:00:00.000Z", "2026-09-07T20:00:00.000Z", 10, [cargo("Dokumente", "TINY", 1)]),
      opportunity("d", "VEHICLE_TRANSFER", "D Bremen → Köln", "BREMEN", "COLOGNE", 18000, "2026-09-07T15:00:00.000Z", "2026-09-07T21:00:00.000Z", "2026-09-07T18:00:00.000Z", "2026-09-08T04:00:00.000Z", 30),
    ];
    const mission = optimizer.optimize(world, { optimizationMode: "MAX_REVENUE", riskProfile: "NORMAL", lookaheadDepth: 3, maxStops: 3, topN: 1 })[0];
    expect(mission).toBeDefined();
    expect([...new Set(mission?.legs.flatMap((leg) => leg.opportunityId ? [leg.opportunityId] : []))]).toEqual(["b", "c", "d"]);
    expect(mission?.scoreBreakdown.totalRevenue.amountMinor).toBe(43000);
  });

  it("E – returns a pure transfer route in destination mode", () => {
    const world = createBaseWorld();
    const mission = optimizer.optimize(world, { optimizationMode: "DESTINATION", riskProfile: "NORMAL", targetDestination: LOCATIONS.BERLIN, destinationDeadline: "2026-09-07T22:00:00.000Z" })[0];
    expect(mission?.legs.at(-1)?.destination.city).toBe("Berlin");
    expect(mission?.legs.every((leg) => !leg.opportunityId)).toBe(true);
    expect(mission?.legs.at(-1)?.arrivalTime && Date.parse(mission.legs.at(-1)?.arrivalTime ?? "") <= Date.parse("2026-09-07T22:00:00.000Z")).toBe(true);
  });

  it("F – retains a confirmed booking despite a better alternative", () => {
    const world = createBaseWorld();
    const confirmed = opportunity("confirmed", "DIRECT_ORDER", "Confirmed Düsseldorf → Köln", "DUSSELDORF", "COLOGNE", 5000, "2026-09-07T06:00:00.000Z", "2026-09-07T08:00:00.000Z", "2026-09-07T07:00:00.000Z", "2026-09-07T14:00:00.000Z", 10, [cargo("Paket", "TINY", 1)]);
    const better = opportunity("better", "DIRECT_ORDER", "Better Düsseldorf → Köln", "DUSSELDORF", "COLOGNE", 25000, "2026-09-07T06:00:00.000Z", "2026-09-07T08:00:00.000Z", "2026-09-07T07:00:00.000Z", "2026-09-07T14:00:00.000Z", 10, [cargo("Paket", "TINY", 1)]);
    world.opportunities = [confirmed, better];
    world.confirmedBookings = [{ id: "booking-1", opportunityId: "confirmed", driverId: world.driver.id, status: "CONFIRMED", bookedAt: world.snapshotAt }];
    const mission = optimizer.optimize(world, { optimizationMode: "MAX_REVENUE", riskProfile: "NORMAL", maxStops: 2, topN: 1 })[0];
    expect(mission?.legs.some((leg) => leg.opportunityId === "confirmed")).toBe(true);
  });

  it("G – keeps completed legs immutable during replanning", () => {
    const world = createBaseWorld();
    world.driver.currentLocation = LOCATIONS.DUSSELDORF;
    world.opportunities = [opportunity("future-cargo", "CARGO_TRANSPORT", "Hamburg → Bremen", "HAMBURG", "BREMEN", 5000, "2026-09-07T10:00:00.000Z", "2026-09-07T16:00:00.000Z", "2026-09-07T12:00:00.000Z", "2026-09-07T18:00:00.000Z", 10, [cargo("Dokumente", "TINY", 1)])];
    const active: Mission = { id: "active", driverId: world.driver.id, startTime: world.driver.availableFrom, startLocation: LOCATIONS.DUSSELDORF, optimizationMode: "MAX_REVENUE", riskProfile: "NORMAL", legs: [{ type: "TRAIN", origin: LOCATIONS.DUSSELDORF, destination: LOCATIONS.HAMBURG, departureTime: "2026-09-07T06:00:00.000Z", arrivalTime: "2026-09-07T10:00:00.000Z", revenue: eur(0), cost: eur(2990), distanceKm: 390, durationMinutes: 240, confidence: "HIGH" }, { type: "TRAIN", origin: LOCATIONS.HAMBURG, destination: LOCATIONS.BREMEN, departureTime: "2026-09-07T10:00:00.000Z", arrivalTime: "2026-09-07T11:00:00.000Z", revenue: eur(0), cost: eur(1990), distanceKm: 120, durationMinutes: 60, confidence: "HIGH" }], scoreBreakdown: { totalRevenue: eur(0), estimatedTravelCosts: eur(4980), estimatedOtherCosts: eur(0), estimatedSurplus: eur(-4980), missionDurationMinutes: 300, revenuePerHour: 0, emptyDistanceKm: 510, riskPenalty: 0, softConstraintPenalty: 0, finalScore: -4980 }, explanationItems: [] };
    const result = replan(active, world, "2026-09-07T11:30:00.000Z", { optimizationMode: "MAX_REVENUE", riskProfile: "NORMAL" });
    expect(result.preservedLegs).toHaveLength(2);
    expect(result.missions[0]?.legs[0]?.arrivalTime).toBe("2026-09-07T10:00:00.000Z");
  });

  it("H – is deterministic", () => {
    const world = createDemoWorld();
    const preferences = { optimizationMode: "MAX_REVENUE" as const, riskProfile: "NORMAL" as const, maxStops: 3, lookaheadDepth: 3 };
    expect(JSON.stringify(optimizer.optimize(world, preferences))).toBe(JSON.stringify(optimizer.optimize(world, preferences)));
  });

  it("I – does not mutate WorldState", () => {
    const world = createDemoWorld();
    const before = JSON.stringify(world);
    optimizer.optimize(world, { optimizationMode: "BALANCED", riskProfile: "SAFE" });
    expect(JSON.stringify(world)).toBe(before);
  });

  it("J – returned missions obey delivery windows and do not duplicate opportunities", () => {
    const world = createBaseWorld();
    world.opportunities = createSyntheticOpportunities(50);
    const missions = optimizer.optimize(world, { optimizationMode: "MAX_REVENUE", riskProfile: "NORMAL", maxStops: 3, lookaheadDepth: 3 });
    expect(missions.length).toBeGreaterThan(0);
    for (const mission of missions) {
      const ids = mission.legs.flatMap((leg) => leg.opportunityId ? [leg.opportunityId] : []);
      expect(new Set(ids).size).toBe(ids.length);
      for (const [index, leg] of mission.legs.entries()) {
        const previous = mission.legs[index - 1];
        if (previous) expect(Date.parse(leg.departureTime)).toBeGreaterThanOrEqual(Date.parse(previous.arrivalTime));
        if (!leg.opportunityId) continue;
        const opportunityItem = world.opportunities.find((opportunity) => opportunity.id === leg.opportunityId);
        expect(opportunityItem).toBeDefined();
        expect(Date.parse(leg.arrivalTime)).toBeLessThanOrEqual(Date.parse(opportunityItem?.deliveryWindow.latest ?? leg.arrivalTime));
        expect(Date.parse(leg.arrivalTime)).toBeGreaterThanOrEqual(Date.parse(opportunityItem?.deliveryWindow.earliest ?? leg.arrivalTime));
      }
    }
  });

  it("K – rejects a mission whose service ends after the delivery deadline", () => {
    const world = createBaseWorld();
    world.opportunities = [opportunity("late-service", "DIRECT_ORDER", "Late service", "DUSSELDORF", "COLOGNE", 10000, "2026-09-07T06:00:00.000Z", "2026-09-07T06:30:00.000Z", "2026-09-07T10:00:00.000Z", "2026-09-07T10:05:00.000Z", 60, [cargo("Tiny", "TINY", 1)])];
    expect(optimizer.optimize(world, { optimizationMode: "MAX_REVENUE", riskProfile: "NORMAL" })).toHaveLength(0);
  });

  it("L – never exceeds maxStops even when lookaheadDepth is larger", () => {
    const world = createDemoWorld();
    const mission = optimizer.optimize(world, { optimizationMode: "MAX_REVENUE", riskProfile: "NORMAL", lookaheadDepth: 3, maxStops: 1, topN: 1 })[0];
    expect(mission).toBeDefined();
    expect(new Set(mission!.legs.flatMap((leg) => leg.opportunityId ? [leg.opportunityId] : [])).size).toBe(1);
  });

  it("L2 – lookaheadDepth limits the actually searched chain", () => {
    const world = createDemoWorld();
    const mission = optimizer.optimize(world, { optimizationMode: "MAX_REVENUE", riskProfile: "NORMAL", lookaheadDepth: 1, maxStops: 3, topN: 1 })[0];
    expect(mission).toBeDefined();
    expect(new Set(mission!.legs.flatMap((leg) => leg.opportunityId ? [leg.opportunityId] : [])).size).toBe(1);
  });

  it("M – does not force confirmed bookings belonging to another driver", () => {
    const world = createBaseWorld();
    world.opportunities = [
      opportunity("other-driver-job", "DIRECT_ORDER", "Other driver job", "DUSSELDORF", "COLOGNE", 1000, "2026-09-07T06:00:00.000Z", "2026-09-07T07:00:00.000Z", "2026-09-07T07:00:00.000Z", "2026-09-07T12:00:00.000Z", 10),
      opportunity("available-job", "DIRECT_ORDER", "Available job", "DUSSELDORF", "COLOGNE", 10000, "2026-09-07T06:00:00.000Z", "2026-09-07T07:00:00.000Z", "2026-09-07T07:00:00.000Z", "2026-09-07T12:00:00.000Z", 10),
    ];
    world.confirmedBookings = [{ id: "other-booking", opportunityId: "other-driver-job", driverId: "someone-else", status: "CONFIRMED", bookedAt: world.snapshotAt }];
    const mission = optimizer.optimize(world, { optimizationMode: "MAX_REVENUE", riskProfile: "NORMAL", maxStops: 1, topN: 1 })[0];
    expect(mission?.legs.some((leg) => leg.opportunityId === "available-job")).toBe(true);
    expect(mission?.legs.some((leg) => leg.opportunityId === "other-driver-job")).toBe(false);
  });

  it("N – does not use an unavailable current vehicle", () => {
    const world = createBaseWorld();
    world.driver.currentTransportMode = "OWN_VEHICLE";
    world.driver.currentVehicleId = "vehicle-mercedes-a";
    world.vehicles[0].availabilityStatus = "UNAVAILABLE";
    world.opportunities = [opportunity("unavailable-vehicle", "DIRECT_ORDER", "Unavailable vehicle", "DUSSELDORF", "COLOGNE", 10000, "2026-09-07T06:00:00.000Z", "2026-09-07T07:00:00.000Z", "2026-09-07T07:00:00.000Z", "2026-09-07T12:00:00.000Z", 10)];
    expect(optimizer.optimize(world, { optimizationMode: "MAX_REVENUE", riskProfile: "NORMAL" })).toHaveLength(0);
  });

  it("O – blocks replanning while a leg is still in progress", () => {
    const world = createBaseWorld();
    const active: Mission = { id: "active", driverId: world.driver.id, startTime: world.driver.availableFrom, startLocation: LOCATIONS.DUSSELDORF, optimizationMode: "MAX_REVENUE", riskProfile: "NORMAL", legs: [{ type: "TRAIN", origin: LOCATIONS.DUSSELDORF, destination: LOCATIONS.HAMBURG, departureTime: "2026-09-07T06:00:00.000Z", arrivalTime: "2026-09-07T10:00:00.000Z", revenue: eur(0), cost: eur(2990), distanceKm: 390, durationMinutes: 240, confidence: "HIGH" }], scoreBreakdown: { totalRevenue: eur(0), estimatedTravelCosts: eur(2990), estimatedOtherCosts: eur(0), estimatedSurplus: eur(-2990), missionDurationMinutes: 240, revenuePerHour: 0, emptyDistanceKm: 390, riskPenalty: 0, softConstraintPenalty: 0, finalScore: -2990 }, explanationItems: [] };
    const result = replan(active, world, "2026-09-07T08:00:00.000Z", { optimizationMode: "MAX_REVENUE", riskProfile: "NORMAL" });
    expect(result.missions).toHaveLength(0);
    expect(result.warnings[0]?.text).toContain("REPLAN_BLOCKED_IN_PROGRESS");
  });

  it("AB – warns early when a confirmed pickup window has already expired", () => {
    const world = createBaseWorld();
    const expired = opportunity("expired-confirmed", "DIRECT_ORDER", "Abgelaufener bestätigter Auftrag", "HAMBURG", "BREMEN", 10000, "2026-09-07T06:00:00.000Z", "2026-09-07T10:00:00.000Z", "2026-09-07T11:00:00.000Z", "2026-09-07T18:00:00.000Z", 10, [cargo("Paket", "TINY", 1)]);
    world.opportunities = [expired];
    world.confirmedBookings = [{ id: "expired-booking", opportunityId: expired.id, driverId: world.driver.id, status: "CONFIRMED", bookedAt: world.snapshotAt }];
    const active: Mission = { id: "completed-leg", driverId: world.driver.id, startTime: world.driver.availableFrom, startLocation: LOCATIONS.DUSSELDORF, optimizationMode: "MAX_REVENUE", riskProfile: "NORMAL", legs: [{ type: "TRAIN", origin: LOCATIONS.DUSSELDORF, destination: LOCATIONS.HAMBURG, departureTime: "2026-09-07T06:00:00.000Z", arrivalTime: "2026-09-07T10:30:00.000Z", revenue: eur(0), cost: eur(2990), distanceKm: 390, durationMinutes: 270, confidence: "HIGH" }], scoreBreakdown: { totalRevenue: eur(0), estimatedTravelCosts: eur(2990), estimatedOtherCosts: eur(0), estimatedSurplus: eur(-2990), missionDurationMinutes: 270, revenuePerHour: 0, emptyDistanceKm: 390, riskPenalty: 0, softConstraintPenalty: 0, finalScore: -2990 }, explanationItems: [] };
    const result = replan(active, world, "2026-09-07T11:00:00.000Z", { optimizationMode: "MAX_REVENUE", riskProfile: "NORMAL" });
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.text).toContain("Pickup-Zeitfenster");
  });

  it("AC – treats leg departure as in progress and leg arrival as completed", () => {
    const world = createBaseWorld();
    const active: Mission = { id: "boundary", driverId: world.driver.id, startTime: world.driver.availableFrom, startLocation: LOCATIONS.DUSSELDORF, optimizationMode: "MAX_REVENUE", riskProfile: "NORMAL", legs: [{ type: "TRAIN", origin: LOCATIONS.DUSSELDORF, destination: LOCATIONS.HAMBURG, departureTime: "2026-09-07T06:00:00.000Z", arrivalTime: "2026-09-07T10:00:00.000Z", revenue: eur(0), cost: eur(2990), distanceKm: 390, durationMinutes: 240, confidence: "HIGH" }], scoreBreakdown: { totalRevenue: eur(0), estimatedTravelCosts: eur(2990), estimatedOtherCosts: eur(0), estimatedSurplus: eur(-2990), missionDurationMinutes: 240, revenuePerHour: 0, emptyDistanceKm: 390, riskPenalty: 0, softConstraintPenalty: 0, finalScore: -2990 }, explanationItems: [] };
    const atDeparture = replan(active, world, "2026-09-07T06:00:00.000Z", { optimizationMode: "MAX_REVENUE", riskProfile: "NORMAL" });
    expect(atDeparture.warnings[0]?.text).toContain("REPLAN_BLOCKED_IN_PROGRESS");
    const atArrival = replan(active, world, "2026-09-07T10:00:00.000Z", { optimizationMode: "MAX_REVENUE", riskProfile: "NORMAL" });
    expect(atArrival.warnings).toHaveLength(0);
    expect(atArrival.preservedLegs).toHaveLength(1);
  });

  it("P – records the selected feasible connection when a slower alternative exists", () => {
    const world = createBaseWorld();
    const firstConnection = world.transitConnections.find((connection) => connection.id === "dus-col");
    expect(firstConnection).toBeDefined();
    world.transitConnections.unshift({ ...firstConnection!, id: "dus-col-too-late", durationMinutes: 240 });
    world.opportunities = [opportunity("alternative-pickup", "DIRECT_ORDER", "Alternative pickup", "COLOGNE", "DORTMUND", 10000, "2026-09-07T06:00:00.000Z", "2026-09-07T07:00:00.000Z", "2026-09-07T07:00:00.000Z", "2026-09-07T14:00:00.000Z", 10, [cargo("Tiny", "TINY", 1)])];
    const mission = optimizer.optimize(world, { optimizationMode: "MAX_REVENUE", riskProfile: "NORMAL" })[0];
    expect(mission).toBeDefined();
    expect(mission?.legs.find((leg) => leg.connectionId)?.connectionId).toBe("dus-col");
  });

  it("Q – records the earliest feasible delivery connection deterministically", () => {
    const world = createBaseWorld();
    const firstConnection = world.transitConnections.find((connection) => connection.id === "dus-col");
    expect(firstConnection).toBeDefined();
    world.transitConnections.unshift({ ...firstConnection!, id: "dus-col-too-slow", durationMinutes: 300 });
    world.opportunities = [opportunity("alternative-delivery", "DIRECT_ORDER", "Alternative delivery", "DUSSELDORF", "COLOGNE", 10000, "2026-09-07T06:00:00.000Z", "2026-09-07T07:00:00.000Z", "2026-09-07T06:00:00.000Z", "2026-09-07T08:00:00.000Z", 10, [cargo("Tiny", "TINY", 1)])];
    const mission = optimizer.optimize(world, { optimizationMode: "MAX_REVENUE", riskProfile: "NORMAL" })[0];
    expect(mission).toBeDefined();
    expect(mission?.legs.find((leg) => leg.connectionId)?.connectionId).toBe("dus-col");
    expect(mission?.legs.find((leg) => leg.opportunityId === "alternative-delivery")?.arrivalTime).toBe("2026-09-07T06:45:00.000Z");
  });

  it("R – rejects more than one parcel on the conservative public-transport capacity", () => {
    const world = createBaseWorld();
    world.driver.currentLocation = LOCATIONS.HAMBURG;
    world.driver.currentTransportMode = "PUBLIC_TRANSPORT";
    world.opportunities = [opportunity("too-many-parcels", "CARGO_TRANSPORT", "Two parcels", "HAMBURG", "BREMEN", 4000, "2026-09-07T06:00:00.000Z", "2026-09-07T08:00:00.000Z", "2026-09-07T07:00:00.000Z", "2026-09-07T12:00:00.000Z", 10, [cargo("Parcel 1", "TINY", 1), cargo("Parcel 2", "TINY", 1)])];
    expect(optimizer.optimize(world, { optimizationMode: "MAX_REVENUE", riskProfile: "NORMAL" })).toHaveLength(0);
  });

  it("S – rejects vehicle cargo whose total weight exceeds the cargo profile", () => {
    const world = createBaseWorld();
    world.driver.currentTransportMode = "OWN_VEHICLE";
    world.driver.currentVehicleId = "vehicle-mercedes-a";
    world.opportunities = [opportunity("too-heavy", "DIRECT_ORDER", "Too heavy", "DUSSELDORF", "COLOGNE", 10000, "2026-09-07T06:00:00.000Z", "2026-09-07T07:00:00.000Z", "2026-09-07T07:00:00.000Z", "2026-09-07T12:00:00.000Z", 10, [cargo("Heavy", "TINY", 400)])];
    expect(optimizer.optimize(world, { optimizationMode: "MAX_REVENUE", riskProfile: "NORMAL" })).toHaveLength(0);
  });

  it("T – moves the driver's own vehicle with an own-vehicle route", () => {
    const world = createBaseWorld();
    world.driver.currentTransportMode = "OWN_VEHICLE";
    world.driver.currentVehicleId = "vehicle-mercedes-a";
    const first = opportunity("own-first", "DIRECT_ORDER", "Düsseldorf → Köln", "DUSSELDORF", "COLOGNE", 10000, "2026-09-07T06:00:00.000Z", "2026-09-07T07:00:00.000Z", "2026-09-07T07:00:00.000Z", "2026-09-07T12:00:00.000Z", 10, [cargo("Paket", "TINY", 1)]);
    const second = opportunity("own-second", "DIRECT_ORDER", "Köln → Dortmund", "COLOGNE", "DORTMUND", 10000, "2026-09-07T07:00:00.000Z", "2026-09-07T12:00:00.000Z", "2026-09-07T08:00:00.000Z", "2026-09-07T16:00:00.000Z", 10, [cargo("Paket", "TINY", 1)]);
    const routing = new FixtureRoutingProvider(world);
    const firstResult = transition(world, initialSearchState(world), first, routing, world.vehicles[0]);
    expect(firstResult.rejection).toBeUndefined();
    expect(firstResult.state.currentVehicleLocation?.city).toBe("Köln");
    const secondResult = transition(world, firstResult.state, second, routing, world.vehicles[0]);
    expect(secondResult.rejection).toBeUndefined();
  });

  it("U – destination mode respects driver availability", () => {
    const world = createBaseWorld();
    world.driver.availableUntil = "2026-09-07T10:00:00.000Z";
    const missions = optimizer.optimize(world, { optimizationMode: "DESTINATION", riskProfile: "NORMAL", targetDestination: LOCATIONS.BERLIN, destinationDeadline: "2026-09-07T22:00:00.000Z" });
    expect(missions).toHaveLength(0);
  });

  it("V – applies the configured risk transfer buffer", () => {
    const world = createBaseWorld();
    world.driver.currentTransportMode = "PUBLIC_TRANSPORT";
    world.opportunities = [opportunity("buffered-job", "DIRECT_ORDER", "Düsseldorf → Köln", "DUSSELDORF", "COLOGNE", 10000, "2026-09-07T06:00:00.000Z", "2026-09-07T07:00:00.000Z", "2026-09-07T06:00:00.000Z", "2026-09-07T07:05:00.000Z", 10, [cargo("Paket", "TINY", 1)])];
    expect(optimizer.optimize(world, { optimizationMode: "MAX_REVENUE", riskProfile: "NORMAL" })).toHaveLength(1);
    expect(optimizer.optimize(world, { optimizationMode: "MAX_REVENUE", riskProfile: "SAFE" })).toHaveLength(0);
  });

  it("W – preserves taxi mode when replanning after a completed taxi leg", () => {
    const world = createBaseWorld();
    world.opportunities = [opportunity("taxi-follow-up", "DIRECT_ORDER", "Köln → Berlin", "COLOGNE", "BERLIN", 10000, "2026-09-07T07:00:00.000Z", "2026-09-07T12:00:00.000Z", "2026-09-07T08:00:00.000Z", "2026-09-07T23:00:00.000Z", 10)];
    const active: Mission = { id: "taxi-active", driverId: world.driver.id, startTime: world.driver.availableFrom, startLocation: LOCATIONS.DUSSELDORF, optimizationMode: "MAX_REVENUE", riskProfile: "NORMAL", legs: [{ type: "TAXI", origin: LOCATIONS.DUSSELDORF, destination: LOCATIONS.COLOGNE, departureTime: "2026-09-07T06:00:00.000Z", arrivalTime: "2026-09-07T07:00:00.000Z", revenue: eur(0), cost: eur(2500), distanceKm: 40, durationMinutes: 60, confidence: "HIGH" }], scoreBreakdown: { totalRevenue: eur(0), estimatedTravelCosts: eur(2500), estimatedOtherCosts: eur(0), estimatedSurplus: eur(-2500), missionDurationMinutes: 60, revenuePerHour: 0, emptyDistanceKm: 40, riskPenalty: 0, softConstraintPenalty: 0, finalScore: -2500 }, explanationItems: [] };
    const result = replan(active, world, "2026-09-07T07:00:00.000Z", { optimizationMode: "MAX_REVENUE", riskProfile: "NORMAL" });
    expect(result.missions[0]?.legs.filter((leg) => leg.type === "TAXI")).toHaveLength(2);
  });

  it("X – does not revive a missed transit connection", () => {
    const world = createBaseWorld();
    world.driver.currentTransportMode = "PUBLIC_TRANSPORT";
    world.transitConnections = world.transitConnections.filter((connection) => connection.id !== "dus-col");
    const pastConnection = world.transitConnections.find((connection) => connection.id === "dus-fra");
    expect(pastConnection).toBeDefined();
    world.transitConnections = [
      { ...pastConnection!, id: "dus-col-past", destination: LOCATIONS.COLOGNE, departureTime: "2026-09-07T05:00:00.000Z", arrivalTime: "2026-09-07T05:30:00.000Z" },
      { ...pastConnection!, id: "dus-col-later", destination: LOCATIONS.COLOGNE, departureTime: "2026-09-07T06:30:00.000Z", arrivalTime: "2026-09-07T07:05:00.000Z" },
    ];
    world.opportunities = [opportunity("timed-job", "DIRECT_ORDER", "Düsseldorf → Köln", "DUSSELDORF", "COLOGNE", 10000, "2026-09-07T06:00:00.000Z", "2026-09-07T08:00:00.000Z", "2026-09-07T07:00:00.000Z", "2026-09-07T12:00:00.000Z", 10, [cargo("Paket", "TINY", 1)])];
    const mission = optimizer.optimize(world, { optimizationMode: "MAX_REVENUE", riskProfile: "NORMAL" })[0];
    expect(mission?.legs.find((leg) => leg.opportunityId === "timed-job")?.arrivalTime).toBe("2026-09-07T07:15:00.000Z");
  });

  it("Y – exposes carried cargo and does not count cargo transport as empty distance", () => {
    const world = createBaseWorld();
    world.driver.currentTransportMode = "PUBLIC_TRANSPORT";
    world.opportunities = [opportunity("cargo-state", "CARGO_TRANSPORT", "Paket Düsseldorf → Köln", "DUSSELDORF", "COLOGNE", 10000, "2026-09-07T06:00:00.000Z", "2026-09-07T08:00:00.000Z", "2026-09-07T07:00:00.000Z", "2026-09-07T12:00:00.000Z", 10, [cargo("Paket", "TINY", 1)])];
    const transitionResult = transition(world, initialSearchState(world), world.opportunities[0]!, new FixtureRoutingProvider(world), undefined);
    expect(transitionResult.rejection).toBeUndefined();
    expect(transitionResult.state.carriedCargo).toHaveLength(0);
    const mission = optimizer.optimize(world, { optimizationMode: "MAX_REVENUE", riskProfile: "NORMAL", topN: 1 })[0];
    expect(mission).toBeDefined();
    expect(mission?.legs.some((leg) => leg.cargoItems?.some((item) => item.description === "Paket"))).toBe(true);
    expect(mission?.scoreBreakdown.emptyDistanceKm).toBe(0);
    expect(scoreLegs(mission!.legs, world.driver.availableFrom, { optimizationMode: "MAX_REVENUE", riskProfile: "NORMAL" }, DEFAULT_CONFIG).emptyDistanceKm).toBe(0);
  });

  it("Z – keeps a negative positioning leg when the complete lookahead chain is profitable", () => {
    const world = createBaseWorld();
    world.driver.currentTransportMode = "PUBLIC_TRANSPORT";
    const positioning = opportunity("positioning", "DIRECT_ORDER", "Positionierung Düsseldorf → Hamburg", "DUSSELDORF", "HAMBURG", 1000, "2026-09-07T06:00:00.000Z", "2026-09-07T07:00:00.000Z", "2026-09-07T07:00:00.000Z", "2026-09-07T12:00:00.000Z", 10, [cargo("Paket", "TINY", 1)]);
    const followUp = opportunity("profitable-follow-up", "DIRECT_ORDER", "Folgeauftrag Hamburg → Bremen", "HAMBURG", "BREMEN", 20000, "2026-09-07T10:00:00.000Z", "2026-09-07T16:00:00.000Z", "2026-09-07T12:00:00.000Z", "2026-09-07T20:00:00.000Z", 10, [cargo("Paket", "TINY", 1)]);
    world.opportunities = [positioning, followUp];
    const mission = optimizer.optimize(world, { optimizationMode: "MAX_REVENUE", riskProfile: "NORMAL", lookaheadDepth: 2, maxStops: 2, topN: 1, excludeNegativeContribution: true })[0];
    expect(mission).toBeDefined();
    expect([...new Set(mission?.legs.flatMap((leg) => leg.opportunityId ? [leg.opportunityId] : []))]).toEqual(["positioning", "profitable-follow-up"]);
    expect(mission?.scoreBreakdown.totalRevenue.amountMinor).toBe(21000);

    world.opportunities = [positioning];
    expect(optimizer.optimize(world, { optimizationMode: "MAX_REVENUE", riskProfile: "NORMAL", excludeNegativeContribution: true })).toHaveLength(0);
  });

  it("AA – enforces passenger capacity for vehicle transport", () => {
    const world = createBaseWorld();
    world.driver.currentTransportMode = "OWN_VEHICLE";
    world.driver.currentVehicleId = "vehicle-mercedes-a";
    const passenger = opportunity("passenger-job", "PASSENGER", "Fahrgast Düsseldorf → Köln", "DUSSELDORF", "COLOGNE", 12000, "2026-09-07T06:00:00.000Z", "2026-09-07T07:00:00.000Z", "2026-09-07T07:00:00.000Z", "2026-09-07T12:00:00.000Z", 10);
    passenger.passengerCount = 4;
    world.opportunities = [passenger];
    expect(optimizer.optimize(world, { optimizationMode: "MAX_REVENUE", riskProfile: "NORMAL" })).toHaveLength(1);
    passenger.passengerCount = 5;
    expect(optimizer.optimize(world, { optimizationMode: "MAX_REVENUE", riskProfile: "NORMAL" })).toHaveLength(0);
  });
});
