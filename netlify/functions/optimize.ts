import { createDemoWorld } from "../../src/fixtures/world.js";
import { LOCATIONS } from "../../src/fixtures/locations.js";
import { RouteOptimizer } from "../../src/optimizer/optimizer.js";
import type { OptimizationMode, RiskProfile, TransportMode } from "../../src/domain/types.js";

type NetlifyEvent = {
  queryStringParameters?: Record<string, string | undefined>;
};

const optimizer = new RouteOptimizer();
const modes: OptimizationMode[] = ["MAX_REVENUE", "MAX_REVENUE_PER_HOUR", "MAX_ESTIMATED_SURPLUS", "BALANCED", "DESTINATION"];
const risks: RiskProfile[] = ["SAFE", "NORMAL", "AGGRESSIVE"];
const transportModes: TransportMode[] = ["WALKING", "PUBLIC_TRANSPORT", "OWN_VEHICLE", "TAXI"];
const locationKeys = Object.keys(LOCATIONS) as Array<keyof typeof LOCATIONS>;

function optimizeDemo(parameters: Record<string, string | undefined>): string {
  const requestedMode = parameters.mode as OptimizationMode | undefined;
  const requestedRisk = parameters.risk as RiskProfile | undefined;
  const requestedStart = parameters.start as keyof typeof LOCATIONS | undefined;
  const requestedTransport = parameters.transport as TransportMode | undefined;
  const optimizationMode = requestedMode && modes.includes(requestedMode) ? requestedMode : "MAX_REVENUE";
  const riskProfile = requestedRisk && risks.includes(requestedRisk) ? requestedRisk : "NORMAL";
  const start = requestedStart && locationKeys.includes(requestedStart) ? requestedStart : "DUSSELDORF";
  const transportMode = requestedTransport && transportModes.includes(requestedTransport) ? requestedTransport : "WALKING";
  const world = createDemoWorld();
  world.driver.currentLocation = LOCATIONS[start];
  world.driver.currentTransportMode = transportMode;
  if (transportMode === "OWN_VEHICLE") {
    world.driver.currentVehicleId = "vehicle-mercedes-a";
    world.vehicles[0].currentLocation = LOCATIONS[start];
  } else {
    world.driver.currentVehicleId = undefined;
  }
  const preferences = {
    optimizationMode,
    riskProfile,
    topN: 3,
    ...(optimizationMode === "DESTINATION" ? { targetDestination: LOCATIONS.BERLIN, destinationDeadline: "2026-09-07T22:00:00.000Z" } : {}),
  };
  return JSON.stringify({
    generatedAt: new Date().toISOString(),
    demo: true,
    scenario: { start, transportMode },
    preferences,
    missions: optimizer.optimize(world, preferences),
  });
}

export async function handler(event: NetlifyEvent) {
  return {
    statusCode: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
    body: optimizeDemo(event.queryStringParameters ?? {}),
  };
}
