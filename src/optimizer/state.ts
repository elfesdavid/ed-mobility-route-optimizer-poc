import type { Booking, Confidence, Driver, ExplanationItem, Location, MissionLeg, Opportunity, TransportMode, Vehicle, WorldState } from "../domain/types.js";
import type { RouteOption, RoutingProvider } from "../routing/routing-provider.js";
import { checkOpportunity } from "./feasibility.js";
import { eur } from "../utils/money.js";
import { isoAt, maxIso, minutesBetween, parseTime } from "../utils/time.js";

export interface SearchState {
  location: Location;
  currentTime: string;
  transportMode: TransportMode;
  currentVehicleId?: string;
  usedVehicleIds: string[];
  usedOpportunityIds: string[];
  legs: MissionLeg[];
  explanationItems: ExplanationItem[];
  totalRevenueMinor: number;
  totalCostMinor: number;
  lowConfidenceCount: number;
  emptyDistanceKm: number;
  lastBookingId?: string;
}

export interface TransitionResult {
  state: SearchState;
  rejection?: { opportunityId: string; reason: string };
}

function serviceLegType(opportunity: Opportunity): MissionLeg["type"] {
  return opportunity.type === "VEHICLE_TRANSFER" ? "OPPORTUNITY_SERVICE" : "OPPORTUNITY_SERVICE";
}

function routeLegType(mode: TransportMode, customerVehicle: boolean): MissionLeg["type"] {
  if (customerVehicle) return "DRIVE";
  if (mode === "WALKING") return "WALK";
  if (mode === "PUBLIC_TRANSPORT") return "TRAIN";
  if (mode === "TAXI") return "TAXI";
  if (mode === "RIDESHARE") return "RIDESHARE";
  return "DRIVE";
}

function confidenceFor(route: RouteOption, opportunity: Opportunity): Confidence {
  if (route.confidence === "LOW" || opportunity.confidence === "LOW") return "LOW";
  if (route.confidence === "MEDIUM" || opportunity.confidence === "MEDIUM") return "MEDIUM";
  return "HIGH";
}

function addWaitIfNeeded(state: SearchState, destination: Location, until: string): SearchState {
  if (parseTime(until) <= parseTime(state.currentTime)) return state;
  const waitMinutes = minutesBetween(state.currentTime, until);
  return {
    ...state,
    currentTime: until,
    legs: [...state.legs, { type: "WAIT", origin: destination, destination, departureTime: state.currentTime, arrivalTime: until, revenue: eur(0), cost: eur(0), distanceKm: 0, durationMinutes: waitMinutes, confidence: "HIGH" }],
  };
}

function addRoute(state: SearchState, route: RouteOption, destination: Location, customerVehicle = false, vehicleId?: string): SearchState {
  if (route.durationMinutes === 0) return state;
  const confidence = route.confidence;
  return {
    ...state,
    location: destination,
    currentTime: route.arrivalTime,
    legs: [...state.legs, { type: routeLegType(route.mode, customerVehicle), origin: state.location, destination, departureTime: route.departureTime, arrivalTime: route.arrivalTime, vehicleId, revenue: eur(0), cost: route.cost, distanceKm: route.distanceKm, durationMinutes: route.durationMinutes, confidence }],
    totalCostMinor: state.totalCostMinor + route.cost.amountMinor,
    lowConfidenceCount: state.lowConfidenceCount + (confidence === "LOW" ? 1 : 0),
    emptyDistanceKm: state.emptyDistanceKm + route.distanceKm,
  };
}

function findBooking(world: WorldState, opportunityId: string): Booking | undefined {
  return world.confirmedBookings.find((booking) => booking.opportunityId === opportunityId && booking.status === "CONFIRMED" && booking.driverId === world.driver.id);
}

function orderedRoutes(routes: RouteOption[]): RouteOption[] {
  return [...routes].sort((a, b) => parseTime(a.arrivalTime) - parseTime(b.arrivalTime) || a.cost.amountMinor - b.cost.amountMinor || (a.connectionId ?? "").localeCompare(b.connectionId ?? ""));
}

export function initialSearchState(world: WorldState): SearchState {
  return { location: world.driver.currentLocation, currentTime: world.driver.availableFrom, transportMode: world.driver.currentTransportMode, currentVehicleId: world.driver.currentVehicleId, usedVehicleIds: [], usedOpportunityIds: [], legs: [], explanationItems: [], totalRevenueMinor: 0, totalCostMinor: 0, lowConfidenceCount: 0, emptyDistanceKm: 0 };
}

export function transition(world: WorldState, state: SearchState, opportunity: Opportunity, routing: RoutingProvider, vehicle: Vehicle | undefined): TransitionResult {
  if (state.usedOpportunityIds.includes(opportunity.id)) return { state, rejection: { opportunityId: opportunity.id, reason: "Opportunity wurde bereits verwendet." } };
  if (opportunity.type === "VEHICLE_TRANSFER" && vehicle && state.usedVehicleIds.includes(vehicle.id)) return { state, rejection: { opportunityId: opportunity.id, reason: "Dieses Kundenfahrzeug wurde bereits in einer früheren Überführung verwendet." } };
  if (parseTime(state.currentTime) < parseTime(world.driver.availableFrom)) return { state, rejection: { opportunityId: opportunity.id, reason: "Fahrer ist zum Startzeitpunkt noch nicht verfügbar." } };
  if (parseTime(state.currentTime) > parseTime(world.driver.availableUntil)) return { state, rejection: { opportunityId: opportunity.id, reason: "Fahrer ist nicht mehr verfügbar." } };
  if (state.transportMode === "OWN_VEHICLE" && state.currentVehicleId) {
    const currentVehicle = world.vehicles.find((item) => item.id === state.currentVehicleId);
    if (currentVehicle && currentVehicle.currentLocation.city !== state.location.city) return { state, rejection: { opportunityId: opportunity.id, reason: "Eigenes Fahrzeug ist am aktuellen Fahrerstandort nicht erreichbar." } };
  }
  const routes = orderedRoutes(routing.getRoutes({ origin: state.location, destination: opportunity.origin, departureTime: state.currentTime, transportMode: state.transportMode, vehicleId: state.currentVehicleId }));
  let route: RouteOption | undefined;
  let rejection: ReturnType<typeof checkOpportunity> | undefined;
  for (const candidate of routes) {
    rejection = checkOpportunity(world, opportunity, candidate, vehicle, state.transportMode, state.location);
    if (!rejection) {
      route = candidate;
      break;
    }
  }
  if (!route) return { state, rejection: rejection ?? { opportunityId: opportunity.id, reason: "Kein erreichbarer Transfer zum Pickup." } };
  let next = addRoute(state, route, opportunity.origin, false, state.currentVehicleId);
  next = addWaitIfNeeded(next, opportunity.origin, maxIso(next.currentTime, opportunity.pickupWindow.earliest));

  const booking = findBooking(world, opportunity.id);
  if (opportunity.type === "VEHICLE_TRANSFER") {
    const serviceRoutes = orderedRoutes(routing.getRoutes({ origin: opportunity.origin, destination: opportunity.destination, departureTime: next.currentTime, transportMode: "CUSTOMER_VEHICLE", vehicleId: vehicle?.id }));
    let serviceRoute: RouteOption | undefined;
    let serviceEnd: string | undefined;
    for (const candidate of serviceRoutes) {
      const candidateStart = maxIso(candidate.arrivalTime, opportunity.deliveryWindow.earliest);
      const candidateEnd = isoAt(candidateStart, opportunity.estimatedServiceDurationMinutes);
      if (parseTime(candidateEnd) <= parseTime(opportunity.deliveryWindow.latest) && parseTime(candidateEnd) <= parseTime(world.driver.availableUntil)) {
        serviceRoute = candidate;
        serviceEnd = candidateEnd;
        break;
      }
    }
    if (!serviceRoute || !serviceEnd) return { state, rejection: { opportunityId: opportunity.id, reason: "Keine Fahrstrecke für Fahrzeugüberführung innerhalb der Delivery- und Verfügbarkeitsfenster verfügbar." } };
    next = { ...next, location: opportunity.destination, currentTime: serviceEnd, transportMode: "WALKING", currentVehicleId: undefined, usedVehicleIds: vehicle ? [...next.usedVehicleIds, vehicle.id] : next.usedVehicleIds, legs: [...next.legs, { type: serviceLegType(opportunity), origin: opportunity.origin, destination: opportunity.destination, departureTime: next.currentTime, arrivalTime: serviceEnd, opportunityId: opportunity.id, bookingId: booking?.id, vehicleId: vehicle?.id, revenue: opportunity.revenue, cost: eur(0), distanceKm: serviceRoute.distanceKm, durationMinutes: minutesBetween(next.currentTime, serviceEnd), confidence: confidenceFor(serviceRoute, opportunity) }], totalRevenueMinor: next.totalRevenueMinor + opportunity.revenue.amountMinor, lowConfidenceCount: next.lowConfidenceCount + (confidenceFor(serviceRoute, opportunity) === "LOW" ? 1 : 0) };
  } else {
    const deliveryRoutes = orderedRoutes(routing.getRoutes({ origin: opportunity.origin, destination: opportunity.destination, departureTime: next.currentTime, transportMode: next.transportMode, vehicleId: next.currentVehicleId }));
    let deliveryRoute: RouteOption | undefined;
    let completionTime: string | undefined;
    let serviceStart: string | undefined;
    for (const candidate of deliveryRoutes) {
      const candidateStart = maxIso(candidate.arrivalTime, opportunity.deliveryWindow.earliest);
      const candidateEnd = isoAt(candidateStart, opportunity.estimatedServiceDurationMinutes);
      if (parseTime(candidateEnd) <= parseTime(opportunity.deliveryWindow.latest) && parseTime(candidateEnd) <= parseTime(world.driver.availableUntil)) {
        deliveryRoute = candidate;
        serviceStart = candidateStart;
        completionTime = candidateEnd;
        break;
      }
    }
    if (!deliveryRoute || !completionTime || !serviceStart) return { state, rejection: { opportunityId: opportunity.id, reason: "Kein erreichbarer Transfer zur Lieferung innerhalb der Delivery- und Verfügbarkeitsfenster verfügbar." } };
    next = addRoute(next, deliveryRoute, opportunity.destination, false, next.currentVehicleId);
    next = addWaitIfNeeded(next, opportunity.destination, serviceStart);
    next = { ...next, legs: [...next.legs, { type: serviceLegType(opportunity), origin: opportunity.origin, destination: opportunity.destination, departureTime: next.currentTime, arrivalTime: completionTime, opportunityId: opportunity.id, bookingId: booking?.id, vehicleId: next.currentVehicleId, revenue: opportunity.revenue, cost: eur(0), distanceKm: 0, durationMinutes: opportunity.estimatedServiceDurationMinutes, confidence: confidenceFor(deliveryRoute, opportunity) }], currentTime: completionTime, totalRevenueMinor: next.totalRevenueMinor + opportunity.revenue.amountMinor, lowConfidenceCount: next.lowConfidenceCount + (confidenceFor(deliveryRoute, opportunity) === "LOW" ? 1 : 0) };
  }
  return { state: { ...next, usedOpportunityIds: [...next.usedOpportunityIds, opportunity.id], lastBookingId: booking?.id, explanationItems: [...next.explanationItems, { kind: "POSITIVE", text: `+${(opportunity.revenue.amountMinor / 100).toFixed(2)} € ${opportunity.title}`, opportunityId: opportunity.id }] } };
}
