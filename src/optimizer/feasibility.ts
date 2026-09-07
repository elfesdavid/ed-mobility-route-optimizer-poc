import type { CargoItem, Location, Opportunity, SizeClass, TransportMode, Vehicle, WorldState } from "../domain/types.js";
import type { RouteOption } from "../routing/routing-provider.js";
import { isoAt, parseTime } from "../utils/time.js";

const sizeRank: Record<SizeClass, number> = { TINY: 1, SMALL: 2, MEDIUM: 3, LARGE: 4, OVERSIZED: 5 };

export interface Rejection {
  opportunityId: string;
  reason: string;
}

export function cargoFitsTransport(items: CargoItem[], transportMode: TransportMode, vehicle: Vehicle | undefined, opportunity: Opportunity): boolean {
  if (items.length === 0) return true;
  if (opportunity.type === "VEHICLE_TRANSFER") return items.length === 0;
  const maximum = transportMode === "PUBLIC_TRANSPORT" || transportMode === "WALKING" ? 1 : vehicle?.cargoProfile ? sizeRank[vehicle.cargoProfile.sizeClass] : 0;
  if (transportMode === "CUSTOMER_VEHICLE" && opportunity.constraints.allowsExternalCargo !== true) return false;
  if (items.some((item) => !Number.isInteger(item.quantity) || item.quantity <= 0)) return false;
  const units = items.reduce((sum, item) => sum + item.quantity, 0);
  if ((transportMode === "PUBLIC_TRANSPORT" || transportMode === "WALKING") && units > 1) return false;
  if (!items.every((item) => sizeRank[item.sizeClass] <= maximum)) return false;
  if (!vehicle?.cargoProfile || (transportMode !== "OWN_VEHICLE" && transportMode !== "CUSTOMER_VEHICLE")) return true;
  const profile = vehicle.cargoProfile;
  const totalWeight = items.reduce((sum, item) => sum + item.weightKg * item.quantity, 0);
  const totalVolume = items.reduce((sum, item) => sum + item.lengthCm * item.widthCm * item.heightCm * item.quantity, 0);
  const profileVolume = profile.maxLengthCm * profile.maxWidthCm * profile.maxHeightCm;
  return items.every((item) => item.lengthCm <= profile.maxLengthCm && item.widthCm <= profile.maxWidthCm && item.heightCm <= profile.maxHeightCm)
    && totalWeight <= profile.maxWeightKg
    && totalVolume <= profileVolume;
}

export function passengerFitsTransport(transportMode: TransportMode, vehicle: Vehicle | undefined, opportunity: Opportunity): boolean {
  if (opportunity.type !== "PASSENGER") return true;
  const passengerCount = opportunity.passengerCount ?? 1;
  if (!Number.isInteger(passengerCount) || passengerCount <= 0) return false;
  if (transportMode === "TAXI" || transportMode === "RIDESHARE") return true;
  if (transportMode !== "OWN_VEHICLE" && transportMode !== "CUSTOMER_VEHICLE") return false;
  return Boolean(vehicle && vehicle.seatsAvailable >= passengerCount);
}

export function vehicleCanBeUsed(transportMode: TransportMode, currentLocation: Location, vehicle: Vehicle | undefined, opportunity: Opportunity, currentVehicleLocation?: Location): string | undefined {
  if (opportunity.constraints.requiredVehicleType && vehicle?.vehicleType !== opportunity.constraints.requiredVehicleType) return "Benötigter Fahrzeugtyp ist nicht verfügbar.";
  if (transportMode !== "OWN_VEHICLE" && transportMode !== "CUSTOMER_VEHICLE" && opportunity.type !== "VEHICLE_TRANSFER") return undefined;
  if (!vehicle) return "Kein Fahrzeug für die Fahrzeugüberführung verfügbar.";
  if (vehicle.availabilityStatus !== "AVAILABLE") return "Fahrzeug ist nicht verfügbar.";
  if (opportunity.type !== "VEHICLE_TRANSFER" && currentVehicleLocation) {
    if (currentVehicleLocation.city !== currentLocation.city) return `Eigenes Fahrzeug befindet sich in ${currentVehicleLocation.city}, nicht am Fahrerstandort ${currentLocation.city}.`;
    return undefined;
  }
  const expectedLocation = opportunity.type === "VEHICLE_TRANSFER" ? opportunity.origin : currentLocation;
  if (vehicle.currentLocation.city !== expectedLocation.city) return `Fahrzeug befindet sich in ${vehicle.currentLocation.city}, nicht am benötigten Standort.`;
  return undefined;
}

export function isRouteTimeFeasible(route: RouteOption, opportunity: Opportunity, transferBufferMinutes = 0): string | undefined {
  const bufferedArrival = isoAt(route.arrivalTime, transferBufferMinutes);
  if (parseTime(bufferedArrival) > parseTime(opportunity.pickupWindow.latest)) return `Pickup nicht erreichbar: ETA ${route.arrivalTime} plus ${transferBufferMinutes} Minuten Puffer, spätester Pickup ${opportunity.pickupWindow.latest}.`;
  return undefined;
}

export function checkOpportunity(world: WorldState, opportunity: Opportunity, route: RouteOption, vehicle: Vehicle | undefined, transportMode: TransportMode, currentLocation: Location, currentVehicleLocation?: Location, transferBufferMinutes = 0): Rejection | undefined {
  if (opportunity.status !== "AVAILABLE") return { opportunityId: opportunity.id, reason: "Opportunity ist nicht verfügbar." };
  const timeProblem = isRouteTimeFeasible(route, opportunity, transferBufferMinutes);
  if (timeProblem) return { opportunityId: opportunity.id, reason: timeProblem };
  const vehicleProblem = vehicleCanBeUsed(transportMode, currentLocation, vehicle, opportunity, currentVehicleLocation);
  if (vehicleProblem) return { opportunityId: opportunity.id, reason: vehicleProblem };
  if (!cargoFitsTransport(opportunity.cargoItems, transportMode, vehicle, opportunity)) return { opportunityId: opportunity.id, reason: "Cargo passt nicht zum aktuellen Transportmittel oder Fahrzeug." };
  if (!passengerFitsTransport(transportMode, vehicle, opportunity)) return { opportunityId: opportunity.id, reason: "Passagierkapazität oder Transportmittel reicht nicht aus." };
  return undefined;
}
