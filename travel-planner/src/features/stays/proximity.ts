import type { Coordinates } from "../../domain/travel";
function valid(point?: Coordinates | null): point is Coordinates {
  return !!point && Number.isFinite(point.lat) && Number.isFinite(point.lng) && Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180;
}
export function meanDistanceKm(hotel: Coordinates | null | undefined, places: Coordinates[]): number | null {
  const known = places.filter(valid);
  if (!valid(hotel) || !known.length) return null;
  const radians = (value: number) => value * Math.PI / 180;
  return known.reduce((sum, point) => {
    const a = Math.sin(radians(point.lat - hotel.lat) / 2) ** 2 + Math.cos(radians(hotel.lat)) * Math.cos(radians(point.lat)) * Math.sin(radians(point.lng - hotel.lng) / 2) ** 2;
    return sum + 6371 * 2 * Math.asin(Math.sqrt(Math.min(1, a)));
  }, 0) / known.length;
}
