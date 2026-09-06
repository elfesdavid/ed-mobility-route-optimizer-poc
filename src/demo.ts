import { createDemoWorld } from "./fixtures/world.js";
import { RouteOptimizer } from "./optimizer/optimizer.js";
import { euroText } from "./utils/money.js";

const world = createDemoWorld();
const optimizer = new RouteOptimizer();
const missions = optimizer.optimize(world, { optimizationMode: "MAX_REVENUE", riskProfile: "NORMAL", lookaheadDepth: 3, maxStops: 3, topN: 3 });

function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

if (missions.length === 0) {
  console.log("Keine feasible Mission gefunden.");
} else {
  missions.forEach((mission, index) => {
    const score = mission.scoreBreakdown;
    console.log(`\nMISSION OPTION ${index + 1}`);
    console.log(mission.optimizationMode);
    mission.legs.filter((leg) => leg.type !== "WAIT").forEach((leg, legIndex) => {
      const title = leg.opportunityId ? world.opportunities.find((opportunity) => opportunity.id === leg.opportunityId)?.title ?? leg.type : leg.type;
      console.log(`${legIndex + 1}. ${title}`);
      console.log(`   ${leg.origin.city} → ${leg.destination.city} | ${leg.departureTime} – ${leg.arrivalTime} | ${leg.revenue.amountMinor > 0 ? `+${euroText(leg.revenue)}` : leg.cost.amountMinor > 0 ? `-${euroText(leg.cost)}` : ""}`);
    });
    console.log(`Revenue: ${euroText(score.totalRevenue)}`);
    console.log(`Costs: ${euroText(score.estimatedTravelCosts)}`);
    console.log(`Estimated surplus: ${euroText(score.estimatedSurplus)}`);
    console.log(`Duration: ${formatDuration(score.missionDurationMinutes)}`);
    console.log(`Revenue/hour: ${score.revenuePerHour.toFixed(2)} €`);
    console.log("WHY THIS ROUTE:");
    mission.explanationItems.filter((item) => item.kind !== "REJECTED").slice(0, 5).forEach((item) => console.log(`- ${item.text}`));
  });
}
