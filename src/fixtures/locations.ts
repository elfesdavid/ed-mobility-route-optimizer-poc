import type { Location } from "../domain/types.js";

export const LOCATIONS: Record<string, Location> = {
  DUSSELDORF: { latitude: 51.2277, longitude: 6.7735, label: "Düsseldorf Hbf", city: "Düsseldorf", countryCode: "DE", timezone: "Europe/Berlin" },
  COLOGNE: { latitude: 50.943, longitude: 6.958, label: "Köln Hbf", city: "Köln", countryCode: "DE", timezone: "Europe/Berlin" },
  DORTMUND: { latitude: 51.5177, longitude: 7.454, label: "Dortmund Hbf", city: "Dortmund", countryCode: "DE", timezone: "Europe/Berlin" },
  MUENSTER: { latitude: 51.956, longitude: 7.635, label: "Münster Hbf", city: "Münster", countryCode: "DE", timezone: "Europe/Berlin" },
  BREMEN: { latitude: 53.083, longitude: 8.813, label: "Bremen Hbf", city: "Bremen", countryCode: "DE", timezone: "Europe/Berlin" },
  HAMBURG: { latitude: 53.552, longitude: 10.006, label: "Hamburg Hbf", city: "Hamburg", countryCode: "DE", timezone: "Europe/Berlin" },
  HANNOVER: { latitude: 52.376, longitude: 9.741, label: "Hannover Hbf", city: "Hannover", countryCode: "DE", timezone: "Europe/Berlin" },
  FRANKFURT: { latitude: 50.107, longitude: 8.663, label: "Frankfurt Hbf", city: "Frankfurt", countryCode: "DE", timezone: "Europe/Berlin" },
  BERLIN: { latitude: 52.525, longitude: 13.369, label: "Berlin Hbf", city: "Berlin", countryCode: "DE", timezone: "Europe/Berlin" },
};

export function locationByCity(city: string): Location {
  const location = Object.values(LOCATIONS).find((item) => item.city === city);
  if (!location) throw new Error(`Unknown fixture city: ${city}`);
  return location;
}
