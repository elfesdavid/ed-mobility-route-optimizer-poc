export function parseTime(value: string): number {
  return Date.parse(value);
}

export function isoAt(base: string, minutes: number): string {
  return new Date(parseTime(base) + minutes * 60_000).toISOString();
}

export function minutesBetween(start: string, end: string): number {
  return Math.round((parseTime(end) - parseTime(start)) / 60_000);
}

export function maxIso(a: string, b: string): string {
  return parseTime(a) >= parseTime(b) ? a : b;
}

export function isWithin(value: string, window: { earliest: string; latest: string }): boolean {
  const point = parseTime(value);
  return point >= parseTime(window.earliest) && point <= parseTime(window.latest);
}
