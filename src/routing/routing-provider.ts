import type { Location, Money, TransportMode, TransitConnection, WorldState } from "../domain/types.js";
import { eur } from "../utils/money.js";
import { isoAt, parseTime } from "../utils/time.js";

export interface RouteRequest {
  origin: Location;
  destination: Location;
  departureTime: string;
  transportMode: TransportMode;
  vehicleId?: string;
}

export interface RouteOption {
  mode: TransportMode;
  departureTime: string;
  arrivalTime: string;
  durationMinutes: number;
  cost: Money;
  distanceKm: number;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  connectionId?: string;
}

export interface RoutingProvider {
  getRoutes(request: RouteRequest): RouteOption[];
}

function sameLocation(a: Location, b: Location): boolean {
  return a.city === b.city;
}

function haversineKm(a: Location, b: Location): number {
  const radians = (value: number) => value * Math.PI / 180;
  const dLat = radians(b.latitude - a.latitude);
  const dLon = radians(b.longitude - a.longitude);
  const lat1 = radians(a.latitude);
  const lat2 = radians(b.latitude);
  const x = Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

export class FixtureRoutingProvider implements RoutingProvider {
  private readonly connections: TransitConnection[];

  constructor(world: WorldState) {
    this.connections = world.transitConnections;
  }

  getRoutes(request: RouteRequest): RouteOption[] {
    if (sameLocation(request.origin, request.destination)) {
      return [{ mode: request.transportMode, departureTime: request.departureTime, arrivalTime: request.departureTime, durationMinutes: 0, cost: eur(0), distanceKm: 0, confidence: "HIGH" }];
    }
    const direct = this.connections.filter((connection) => connection.origin.city === request.origin.city && connection.destination.city === request.destination.city);
    const matching = direct.filter((connection) => {
      if (request.transportMode === "OWN_VEHICLE" || request.transportMode === "CUSTOMER_VEHICLE") return false;
      return connection.mode === "PUBLIC_TRANSPORT";
    });
    if (matching.length > 0) {
      return matching.flatMap((connection) => {
        const route = this.fromConnection(connection, request.departureTime);
        return route ? [route] : [];
      });
    }

    const distanceKm = haversineKm(request.origin, request.destination);
    const durationMinutes = request.transportMode === "WALKING" ? Math.ceil(distanceKm / 5 * 60) : Math.ceil(distanceKm / 85 * 60) + 15;
    const costMinor = request.transportMode === "WALKING" || request.transportMode === "OWN_VEHICLE" || request.transportMode === "CUSTOMER_VEHICLE" ? 0 : Math.round(distanceKm * 18);
    return [{ mode: request.transportMode, departureTime: request.departureTime, arrivalTime: isoAt(request.departureTime, durationMinutes), durationMinutes, cost: eur(costMinor), distanceKm: Math.round(distanceKm * 10) / 10, confidence: "MEDIUM" }];
  }

  private fromConnection(connection: TransitConnection, departureTime: string): RouteOption | undefined {
    const departure = connection.departureTime ?? departureTime;
    if (parseTime(departure) < parseTime(departureTime)) return undefined;
    const arrival = connection.arrivalTime ?? isoAt(departure, connection.durationMinutes);
    if (parseTime(arrival) < parseTime(departure)) return undefined;
    return { mode: connection.mode, departureTime: departure, arrivalTime: arrival, durationMinutes: Math.max(0, Math.round((parseTime(arrival) - parseTime(departure)) / 60_000)), cost: connection.cost, distanceKm: connection.distanceKm, confidence: connection.confidence, connectionId: connection.id };
  }
}
