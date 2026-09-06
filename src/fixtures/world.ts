import type { CargoItem, Opportunity, TransitConnection, Vehicle, WorldState } from "../domain/types.js";
import { LOCATIONS } from "./locations.js";
import { eur } from "../utils/money.js";

const snapshot = "2026-09-07T06:00:00.000Z";
const w = (start: string, end: string) => ({ earliest: start, latest: end });
const cargo = (description: string, sizeClass: CargoItem["sizeClass"], weightKg: number): CargoItem => ({
  description, lengthCm: sizeClass === "TINY" ? 30 : sizeClass === "SMALL" ? 60 : 180,
  widthCm: sizeClass === "TINY" ? 20 : sizeClass === "SMALL" ? 40 : 80,
  heightCm: sizeClass === "TINY" ? 15 : sizeClass === "SMALL" ? 40 : 90,
  weightKg, quantity: 1, fragile: false, stackable: sizeClass !== "LARGE", mustRemainUpright: false, sizeClass,
});

const opportunity = (
  id: string, type: Opportunity["type"], title: string, origin: keyof typeof LOCATIONS, destination: keyof typeof LOCATIONS,
  revenueMinor: number, pickupStart: string, pickupEnd: string, deliveryStart: string, deliveryEnd: string,
  serviceMinutes: number, items: CargoItem[] = [], confidence: Opportunity["confidence"] = "HIGH",
): Opportunity => ({
  id, source: "fixture", externalId: id, type, title, origin: LOCATIONS[origin], destination: LOCATIONS[destination],
  pickupWindow: w(pickupStart, pickupEnd), deliveryWindow: w(deliveryStart, deliveryEnd), revenue: eur(revenueMinor),
  estimatedServiceDurationMinutes: serviceMinutes, cargoItems: items, constraints: {}, observedAt: snapshot,
  lastVerifiedAt: snapshot, confidence, status: "AVAILABLE",
});

export const BASE_VEHICLES: Vehicle[] = [
  { id: "vehicle-mercedes-a", name: "Mercedes A-Klasse", currentLocation: LOCATIONS.DUSSELDORF, availabilityStatus: "AVAILABLE", vehicleType: "CAR", cargoProfile: { maxLengthCm: 180, maxWidthCm: 100, maxHeightCm: 90, maxWeightKg: 350, sizeClass: "MEDIUM" }, seatsTotal: 5, seatsAvailable: 4 },
  { id: "vehicle-van-hamburg", name: "Transporter Hamburg", currentLocation: LOCATIONS.HAMBURG, availabilityStatus: "AVAILABLE", vehicleType: "VAN", cargoProfile: { maxLengthCm: 300, maxWidthCm: 170, maxHeightCm: 180, maxWeightKg: 1000, sizeClass: "LARGE" }, seatsTotal: 3, seatsAvailable: 2 },
  { id: "vehicle-car-bremen", name: "Kompaktwagen Bremen", currentLocation: LOCATIONS.BREMEN, availabilityStatus: "AVAILABLE", vehicleType: "CAR", cargoProfile: { maxLengthCm: 180, maxWidthCm: 100, maxHeightCm: 90, maxWeightKg: 350, sizeClass: "MEDIUM" }, seatsTotal: 5, seatsAvailable: 4 },
];

const transit = (id: string, from: keyof typeof LOCATIONS, to: keyof typeof LOCATIONS, minutes: number, costMinor: number, distanceKm: number, mode: TransitConnection["mode"] = "PUBLIC_TRANSPORT"): TransitConnection => ({
  id, origin: LOCATIONS[from], destination: LOCATIONS[to], mode, durationMinutes: minutes, cost: eur(costMinor), distanceKm, confidence: "HIGH",
});

export const BASE_CONNECTIONS: TransitConnection[] = [
  transit("dus-ham", "DUSSELDORF", "HAMBURG", 240, 2990, 390),
  transit("ham-bre", "HAMBURG", "BREMEN", 60, 1990, 120),
  transit("bre-cgn", "BREMEN", "COLOGNE", 190, 2990, 310),
  transit("dus-fra", "DUSSELDORF", "FRANKFURT", 150, 2490, 220),
  transit("fra-ber", "FRANKFURT", "BERLIN", 250, 3990, 550),
  transit("dus-ber", "DUSSELDORF", "BERLIN", 300, 4990, 570),
  transit("dus-col", "DUSSELDORF", "COLOGNE", 35, 1290, 45),
  transit("col-dor", "COLOGNE", "DORTMUND", 75, 1590, 95),
  transit("dor-mue", "DORTMUND", "MUENSTER", 45, 1190, 65),
  transit("mue-ham", "MUENSTER", "HAMBURG", 150, 2490, 180),
  transit("ham-han", "HAMBURG", "HANNOVER", 80, 1990, 150),
  transit("han-ber", "HANNOVER", "BERLIN", 120, 2490, 250),
  transit("col-fra", "COLOGNE", "FRANKFURT", 80, 1990, 170),
  transit("fra-col", "FRANKFURT", "COLOGNE", 80, 1990, 170),
  transit("ham-dus", "HAMBURG", "DUSSELDORF", 240, 2990, 390),
  transit("bre-ham", "BREMEN", "HAMBURG", 60, 1990, 120),
  transit("cgn-bre", "COLOGNE", "BREMEN", 190, 2990, 310),
  transit("ber-dus", "BERLIN", "DUSSELDORF", 300, 4990, 570),
];

export function createBaseWorld(): WorldState {
  return {
    snapshotAt: snapshot,
    driver: { id: "driver-david", name: "David", currentLocation: LOCATIONS.DUSSELDORF, currentTransportMode: "WALKING", currentVehicleId: undefined, availableFrom: snapshot, availableUntil: "2026-09-07T23:00:00.000Z" },
    vehicles: structuredClone(BASE_VEHICLES), confirmedBookings: [], opportunities: [], transitConnections: structuredClone(BASE_CONNECTIONS),
  };
}

export function createSyntheticOpportunities(count = 50): Opportunity[] {
  const cities = Object.keys(LOCATIONS) as Array<keyof typeof LOCATIONS>;
  const result: Opportunity[] = [];
  for (let index = 0; result.length < count; index += 1) {
    const origin = cities[index % cities.length];
    const destination = cities[(index * 3 + 2) % cities.length];
    if (origin === destination) continue;
    const hour = 6 + (index % 10);
    const start = `2026-09-07T${String(hour).padStart(2, "0")}:00:00.000Z`;
    const pickupEnd = `2026-09-07T${String(Math.min(hour + 3, 21)).padStart(2, "0")}:00:00.000Z`;
    const deliveryEnd = `2026-09-07T23:00:00.000Z`;
    const type: Opportunity["type"] = index % 3 === 0 ? "VEHICLE_TRANSFER" : index % 3 === 1 ? "CARGO_TRANSPORT" : "DIRECT_ORDER";
    result.push(opportunity(`synthetic-${result.length + 1}`, type, `${type} ${LOCATIONS[origin].city} → ${LOCATIONS[destination].city}`, origin, destination, 6000 + ((index * 137) % 26000), start, pickupEnd, start, deliveryEnd, 20 + (index % 5) * 10, type === "VEHICLE_TRANSFER" ? [] : [cargo(index % 4 === 0 ? "Kleine Sendung" : "Paket", index % 4 === 0 ? "TINY" : "SMALL", index % 4 === 0 ? 2 : 12)], index % 7 === 0 ? "LOW" : index % 3 === 0 ? "MEDIUM" : "HIGH"));
  }
  return result;
}

export function createDemoWorld(): WorldState {
  const world = createBaseWorld();
  world.opportunities = [
    opportunity("demo-dus-ham", "VEHICLE_TRANSFER", "Fahrzeugüberführung Düsseldorf → Hamburg", "DUSSELDORF", "HAMBURG", 21000, "2026-09-07T06:00:00.000Z", "2026-09-07T07:00:00.000Z", "2026-09-07T11:00:00.000Z", "2026-09-07T15:00:00.000Z", 30),
    opportunity("demo-ham-bre-cargo", "CARGO_TRANSPORT", "Cargo Hamburg → Bremen", "HAMBURG", "BREMEN", 4000, "2026-09-07T11:00:00.000Z", "2026-09-07T16:00:00.000Z", "2026-09-07T16:00:00.000Z", "2026-09-07T20:00:00.000Z", 15, [cargo("Dokumente", "TINY", 1)]),
    opportunity("demo-bre-col", "VEHICLE_TRANSFER", "Fahrzeugüberführung Bremen → Köln", "BREMEN", "COLOGNE", 17000, "2026-09-07T16:00:00.000Z", "2026-09-07T20:00:00.000Z", "2026-09-07T20:00:00.000Z", "2026-09-08T03:00:00.000Z", 30),
    opportunity("demo-dus-fra", "VEHICLE_TRANSFER", "Fahrzeugüberführung Düsseldorf → Frankfurt", "DUSSELDORF", "FRANKFURT", 16000, "2026-09-07T06:00:00.000Z", "2026-09-07T07:00:00.000Z", "2026-09-07T10:00:00.000Z", "2026-09-07T14:00:00.000Z", 30),
    opportunity("demo-fra-col", "DIRECT_ORDER", "Direktauftrag Frankfurt → Köln", "FRANKFURT", "COLOGNE", 9000, "2026-09-07T12:00:00.000Z", "2026-09-07T18:00:00.000Z", "2026-09-07T14:00:00.000Z", "2026-09-07T22:00:00.000Z", 20, [cargo("Paket", "SMALL", 8)]),
    opportunity("demo-ham-han", "CARGO_TRANSPORT", "Cargo Hamburg → Hannover", "HAMBURG", "HANNOVER", 5500, "2026-09-07T11:00:00.000Z", "2026-09-07T18:00:00.000Z", "2026-09-07T13:00:00.000Z", "2026-09-07T20:00:00.000Z", 15, [cargo("Ersatzteil", "TINY", 3)]),
  ];
  return world;
}

export { opportunity, cargo };
