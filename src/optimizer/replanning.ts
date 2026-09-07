import { DEFAULT_CONFIG, type ExplanationItem, type Mission, type WorldState } from "../domain/types.js";
import { RouteOptimizer } from "./optimizer.js";
import type { MissionPreferences } from "../domain/types.js";
import { parseTime } from "../utils/time.js";
import { scoreLegs } from "../scoring/scoring.js";

export interface ReplanResult {
  missions: Mission[];
  preservedLegs: Mission["legs"];
  warnings: ExplanationItem[];
}

function legIsInProgress(leg: Mission["legs"][number], currentTime: string): boolean {
  return parseTime(leg.departureTime) <= parseTime(currentTime) && parseTime(currentTime) < parseTime(leg.arrivalTime);
}

function locationAtCurrentTime(mission: Mission, currentTime: string): Mission["startLocation"] {
  const past = mission.legs.filter((leg) => parseTime(leg.arrivalTime) <= parseTime(currentTime));
  return past.at(-1)?.destination ?? mission.startLocation;
}

function transportModeFromLeg(leg: Mission["legs"][number] | undefined): WorldState["driver"]["currentTransportMode"] {
  return leg?.transportMode ?? "WALKING";
}

export function replan(activeMission: Mission, updatedWorld: WorldState, currentTime: string, preferences: MissionPreferences, optimizer = new RouteOptimizer()): ReplanResult {
  const inProgress = activeMission.legs.find((leg) => legIsInProgress(leg, currentTime));
  if (inProgress) {
    const warning: ExplanationItem = { kind: "NEGATIVE", text: `REPLAN_BLOCKED_IN_PROGRESS: Das aktuelle Leg ${inProgress.type} läuft bis ${inProgress.arrivalTime}. Für ein sicheres Replanning wird der exakte Zwischenstand benötigt.`, opportunityId: inProgress.opportunityId };
    return { missions: [], preservedLegs: activeMission.legs.filter((leg) => parseTime(leg.arrivalTime) <= parseTime(currentTime)), warnings: [warning] };
  }
  const preservedLegs = activeMission.legs.filter((leg) => parseTime(leg.arrivalTime) <= parseTime(currentTime));
  const currentLocation = locationAtCurrentTime(activeMission, currentTime);
  const completedOpportunityIds = new Set(preservedLegs.flatMap((leg) => leg.opportunityId ? [leg.opportunityId] : []));
  const lastPreservedLeg = preservedLegs.at(-1);
  const currentTransportMode = transportModeFromLeg(lastPreservedLeg);
  const currentVehicleId = currentTransportMode === "OWN_VEHICLE"
    ? [...preservedLegs].reverse().find((leg) => leg.vehicleId)?.vehicleId
    : undefined;
  const futureOpportunities = new Set(updatedWorld.opportunities.map((opportunity) => opportunity.id));
  const warnings: ExplanationItem[] = [];
  const warnedBookingIds = new Set<string>();
  for (const booking of updatedWorld.confirmedBookings.filter((item) => item.status === "CONFIRMED" && item.driverId === updatedWorld.driver.id)) {
    const opportunity = updatedWorld.opportunities.find((item) => item.id === booking.opportunityId);
    const pickupExpired = opportunity ? parseTime(opportunity.pickupWindow.latest) < parseTime(currentTime) : false;
    if (!opportunity || !futureOpportunities.has(booking.opportunityId) || opportunity.status !== "AVAILABLE" || pickupExpired) {
      const reason = !opportunity || opportunity.status !== "AVAILABLE"
        ? "im aktualisierten WorldState nicht mehr verfügbar"
        : `das Pickup-Zeitfenster endete bereits um ${opportunity.pickupWindow.latest}`;
      warnings.push({ kind: "NEGATIVE", text: `CONFIRMED_BOOKING_AT_RISK: Auftrag ${booking.opportunityId} ist ${reason}.`, opportunityId: booking.opportunityId });
      warnedBookingIds.add(booking.opportunityId);
    }
  }
  const replanningWorld: WorldState = structuredClone({
    ...updatedWorld,
    opportunities: updatedWorld.opportunities.filter((opportunity) => !completedOpportunityIds.has(opportunity.id)),
    confirmedBookings: updatedWorld.confirmedBookings.filter((booking) => !completedOpportunityIds.has(booking.opportunityId)),
    vehicles: updatedWorld.vehicles.map((vehicle) => vehicle.id === currentVehicleId ? { ...vehicle, currentLocation } : vehicle),
    driver: { ...updatedWorld.driver, currentLocation, currentTransportMode, currentVehicleId, availableFrom: currentTime },
  });
  const missions = optimizer.optimize(replanningWorld, preferences);
  for (const booking of updatedWorld.confirmedBookings.filter((item) => item.status === "CONFIRMED" && item.driverId === updatedWorld.driver.id)) {
    if (!warnedBookingIds.has(booking.opportunityId) && !missions.some((mission) => mission.legs.some((leg) => leg.opportunityId === booking.opportunityId))) {
      warnings.push({ kind: "NEGATIVE", text: `CONFIRMED_BOOKING_AT_RISK: Auftrag ${booking.opportunityId} ist ab ${currentTime} nicht mehr erreichbar.`, opportunityId: booking.opportunityId });
    }
  }
  const withPast = missions.map((mission) => {
    const legs = [...preservedLegs, ...mission.legs];
    return { ...mission, startTime: activeMission.startTime, startLocation: activeMission.startLocation, legs, scoreBreakdown: scoreLegs(legs, activeMission.startTime, preferences, DEFAULT_CONFIG), explanationItems: [...warnings, { kind: "INFO" as const, text: `Vergangenheit bis ${currentTime} wurde unverändert übernommen.` }, ...mission.explanationItems] };
  });
  return { missions: withPast, preservedLegs, warnings };
}
