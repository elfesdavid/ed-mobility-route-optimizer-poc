import { createBaseWorld, createSyntheticOpportunities } from "./fixtures/world.js";
import { RouteOptimizer } from "./optimizer/optimizer.js";

const optimizer = new RouteOptimizer();
for (const count of [50, 100, 250, 500]) {
  const world = createBaseWorld();
  world.opportunities = createSyntheticOpportunities(count);
  const started = performance.now();
  const missions = optimizer.optimize(world, { optimizationMode: "MAX_REVENUE", riskProfile: "NORMAL", beamWidth: 20, lookaheadDepth: 3, maxStops: 3, topN: 3 });
  const elapsed = performance.now() - started;
  console.log(`${count} opportunities: ${elapsed.toFixed(1)} ms, ${missions.length} alternatives`);
}
