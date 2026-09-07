import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createDemoWorld } from "./fixtures/world.js";
import { LOCATIONS } from "./fixtures/locations.js";
import { RouteOptimizer } from "./optimizer/optimizer.js";
import type { OptimizationMode, RiskProfile, TransportMode } from "./domain/types.js";

const port = Number(process.env.PORT ?? 3000);
const projectRoot = process.cwd();
const optimizer = new RouteOptimizer();
const modes: OptimizationMode[] = ["MAX_REVENUE", "MAX_REVENUE_PER_HOUR", "MAX_ESTIMATED_SURPLUS", "BALANCED", "DESTINATION"];
const risks: RiskProfile[] = ["SAFE", "NORMAL", "AGGRESSIVE"];
const transportModes: TransportMode[] = ["WALKING", "PUBLIC_TRANSPORT", "OWN_VEHICLE", "TAXI"];
const locationKeys = Object.keys(LOCATIONS) as Array<keyof typeof LOCATIONS>;

function send(response: import("node:http").ServerResponse, status: number, contentType: string, body: string): void {
  response.writeHead(status, { "content-type": contentType, "cache-control": "no-store" });
  response.end(body);
}

function optimizeDemo(url: URL): string {
  const requestedMode = url.searchParams.get("mode") as OptimizationMode | null;
  const requestedRisk = url.searchParams.get("risk") as RiskProfile | null;
  const requestedStart = url.searchParams.get("start") as keyof typeof LOCATIONS | null;
  const requestedTransport = url.searchParams.get("transport") as TransportMode | null;
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
  return JSON.stringify({ generatedAt: new Date().toISOString(), demo: true, scenario: { start, transportMode }, preferences, missions: optimizer.optimize(world, preferences) });
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  if (request.method !== "GET") {
    send(response, 405, "text/plain; charset=utf-8", "Method Not Allowed");
    return;
  }
  if (url.pathname === "/api/optimize") {
    send(response, 200, "application/json; charset=utf-8", optimizeDemo(url));
    return;
  }
  const assets: Record<string, [string, string]> = {
    "/": ["public/index.html", "text/html; charset=utf-8"],
    "/app.js": ["public/app.js", "text/javascript; charset=utf-8"],
    "/styles.css": ["public/styles.css", "text/css; charset=utf-8"],
    "/favicon.svg": ["public/favicon.svg", "image/svg+xml"],
  };
  const asset = assets[url.pathname];
  if (!asset) {
    send(response, 404, "text/plain; charset=utf-8", "Not Found");
    return;
  }
  try {
    send(response, 200, asset[1], readFileSync(join(projectRoot, asset[0]), "utf8"));
  } catch {
    send(response, 500, "text/plain; charset=utf-8", "Asset konnte nicht geladen werden.");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`ED Mobility Demo läuft auf http://127.0.0.1:${port}`);
});
