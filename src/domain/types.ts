export type Currency = "EUR";

export interface Money {
  amountMinor: number;
  currency: Currency;
}

export interface Location {
  latitude: number;
  longitude: number;
  label: string;
  city: string;
  countryCode: string;
  timezone: string;
}

export interface TimeWindow {
  earliest: string;
  latest: string;
}

export type TransportMode =
  | "WALKING"
  | "PUBLIC_TRANSPORT"
  | "OWN_VEHICLE"
  | "CUSTOMER_VEHICLE"
  | "TAXI"
  | "RIDESHARE";

export interface Driver {
  id: string;
  name: string;
  currentLocation: Location;
  currentTransportMode: TransportMode;
  currentVehicleId?: string;
  availableFrom: string;
  availableUntil: string;
}

export type VehicleAvailability = "AVAILABLE" | "IN_USE" | "UNAVAILABLE";
export type VehicleType = "CAR" | "VAN" | "TRUCK";
export type SizeClass = "TINY" | "SMALL" | "MEDIUM" | "LARGE" | "OVERSIZED";

export interface CargoProfile {
  maxLengthCm: number;
  maxWidthCm: number;
  maxHeightCm: number;
  maxWeightKg: number;
  sizeClass: SizeClass;
}

export interface Vehicle {
  id: string;
  name: string;
  currentLocation: Location;
  availabilityStatus: VehicleAvailability;
  vehicleType: VehicleType;
  cargoProfile: CargoProfile;
  seatsTotal: number;
  seatsAvailable: number;
}

export interface CargoItem {
  description: string;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  weightKg: number;
  quantity: number;
  fragile: boolean;
  stackable: boolean;
  mustRemainUpright: boolean;
  sizeClass: SizeClass;
}

export type OpportunityType =
  | "VEHICLE_TRANSFER"
  | "CARGO_TRANSPORT"
  | "PASSENGER"
  | "DIRECT_ORDER";
export type Confidence = "HIGH" | "MEDIUM" | "LOW";
export type OpportunityStatus = "AVAILABLE" | "UNKNOWN" | "UNAVAILABLE";

export interface OpportunityConstraints {
  requiredVehicleType?: VehicleType;
  allowsExternalCargo?: boolean;
  preferredTransportModes?: TransportMode[];
}

export interface Opportunity {
  id: string;
  source: string;
  externalId?: string;
  type: OpportunityType;
  title: string;
  origin: Location;
  destination: Location;
  pickupWindow: TimeWindow;
  deliveryWindow: TimeWindow;
  revenue: Money;
  estimatedServiceDurationMinutes: number;
  cargoItems: CargoItem[];
  passengerCount?: number;
  constraints: OpportunityConstraints;
  observedAt: string;
  lastVerifiedAt: string;
  confidence: Confidence;
  status: OpportunityStatus;
}

export type BookingStatus = "RESERVED" | "CONFIRMED" | "STARTED" | "COMPLETED" | "CANCELLED";

export interface Booking {
  id: string;
  opportunityId: string;
  driverId: string;
  vehicleId?: string;
  status: BookingStatus;
  bookedAt: string;
  cancellationPenalty?: Money;
}

export type MissionLegType =
  | "WALK"
  | "DRIVE"
  | "TRAIN"
  | "BUS"
  | "FLIGHT"
  | "TAXI"
  | "RIDESHARE"
  | "OPPORTUNITY_SERVICE"
  | "WAIT";

export interface MissionLeg {
  type: MissionLegType;
  transportMode: TransportMode;
  continuationTransportMode?: TransportMode;
  origin: Location;
  destination: Location;
  departureTime: string;
  arrivalTime: string;
  opportunityId?: string;
  bookingId?: string;
  vehicleId?: string;
  connectionId?: string;
  cargoItems?: CargoItem[];
  revenue: Money;
  cost: Money;
  distanceKm: number;
  durationMinutes: number;
  confidence: Confidence;
}

export type OptimizationMode =
  | "MAX_REVENUE"
  | "MAX_REVENUE_PER_HOUR"
  | "MAX_ESTIMATED_SURPLUS"
  | "BALANCED"
  | "DESTINATION";
export type RiskProfile = "SAFE" | "NORMAL" | "AGGRESSIVE";

export interface ScoreBreakdown {
  totalRevenue: Money;
  estimatedTravelCosts: Money;
  estimatedOtherCosts: Money;
  estimatedSurplus: Money;
  missionDurationMinutes: number;
  revenuePerHour: number;
  emptyDistanceKm: number;
  riskPenalty: number;
  softConstraintPenalty: number;
  finalScore: number;
}

export interface ExplanationItem {
  kind: "POSITIVE" | "NEGATIVE" | "REJECTED" | "INFO";
  text: string;
  opportunityId?: string;
}

export interface Mission {
  id: string;
  driverId: string;
  startTime: string;
  startLocation: Location;
  optimizationMode: OptimizationMode;
  riskProfile: RiskProfile;
  targetDestination?: Location;
  destinationDeadline?: string;
  legs: MissionLeg[];
  scoreBreakdown: ScoreBreakdown;
  explanationItems: ExplanationItem[];
}

export interface TransitConnection {
  id: string;
  origin: Location;
  destination: Location;
  mode: TransportMode;
  departureTime?: string;
  arrivalTime?: string;
  durationMinutes: number;
  cost: Money;
  distanceKm: number;
  confidence: Confidence;
}

export interface WorldState {
  snapshotAt: string;
  driver: Driver;
  vehicles: Vehicle[];
  confirmedBookings: Booking[];
  opportunities: Opportunity[];
  transitConnections: TransitConnection[];
}

export interface MissionPreferences {
  optimizationMode: OptimizationMode;
  riskProfile: RiskProfile;
  beamWidth?: number;
  lookaheadDepth?: number;
  maxStops?: number;
  topN?: number;
  excludeNegativeContribution?: boolean;
  targetDestination?: Location;
  destinationDeadline?: string;
}

export interface OptimizerConfig {
  transferBufferMinutes: Record<RiskProfile, number>;
  riskPenaltyPerLowConfidence: Record<RiskProfile, number>;
  softEarlyFinishPenaltyPerMinute: number;
  maxAlternatives: number;
  balancedWeights: {
    revenue: number;
    surplus: number;
    revenuePerHour: number;
    risk: number;
  };
}

export const DEFAULT_CONFIG: OptimizerConfig = {
  transferBufferMinutes: { SAFE: 30, NORMAL: 15, AGGRESSIVE: 5 },
  riskPenaltyPerLowConfidence: { SAFE: 18, NORMAL: 10, AGGRESSIVE: 5 },
  softEarlyFinishPenaltyPerMinute: 0.1,
  maxAlternatives: 3,
  balancedWeights: { revenue: 0.55, surplus: 0.25, revenuePerHour: 0.2, risk: 1 },
};

export function cloneWorldState(world: WorldState): WorldState {
  return structuredClone(world);
}
