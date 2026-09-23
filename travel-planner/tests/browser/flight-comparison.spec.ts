import { expect, test } from "@playwright/test";
import { filterFlightOffers, flightStops, initialFilters } from "../../src/features/flights/comparison";
import type { FlightOption } from "../../src/domain/travel";
import { airportTime, arrivalDayChange, journeyLegs } from "../../src/features/flights/journey";

test("unknown prices and durations sort after known values", () => {
  const offers: FlightOption[] = [{ id: "unknown" }, { id: "cheap", total_price: 100, total_duration_minutes: 400 }, { id: "fast", total_price: 200, total_duration_minutes: 200 }];
  expect(filterFlightOffers(offers, { ...initialFilters, sort: "cheapest" }).map((offer) => offer.id)).toEqual(["cheap", "fast", "unknown"]);
  expect(filterFlightOffers(offers, { ...initialFilters, sort: "fastest" }).map((offer) => offer.id)).toEqual(["fast", "cheap", "unknown"]);
  expect(filterFlightOffers(offers, { ...initialFilters, target: "150" })).toHaveLength(3);
  expect(filterFlightOffers(offers, { ...initialFilters, target: "150", strict: true }).map((offer) => offer.id)).toEqual(["cheap"]);
});

test("connecting round trips retain both legs and local calendar-day changes", () => {
  const segments = [
    { from: "LAX", to: "LHR", depart_at: "2027-05-01 22:00", arrive_at: "2027-05-02 16:00" },
    { from: "LHR", to: "LIS", depart_at: "2027-05-02 23:00", arrive_at: "2027-05-03 01:00" },
    { from: "LIS", to: "MAD", depart_at: "2027-05-04 08:00", arrive_at: "2027-05-04 10:00" },
    { from: "MAD", to: "LAX", depart_at: "2027-05-04 12:00", arrive_at: "2027-05-04 15:00" },
  ];
  const legs = journeyLegs({ id: "trip", segments, has_return_details: true, outbound_segment_count: 2 });
  expect(legs.map((leg) => [leg.label, leg.segments[0].from, leg.segments.at(-1)?.to])).toEqual([["Outbound", "LAX", "LIS"], ["Return", "LIS", "LAX"]]);
  expect(arrivalDayChange(segments[0].depart_at, segments[1].arrive_at)).toBe(2);
  expect(arrivalDayChange("2027-05-02 08:00", "2027-05-01 23:00")).toBe(-1);
  expect(arrivalDayChange("2027-02-30 08:00", "2027-03-01 23:00")).toBeNull();
  expect(airportTime("2027-05-01 22:00")).toBe("May 1, 22:00");
  expect(journeyLegs({ id: "historical", segments, has_return_details: true })).toEqual([]);
});

test("stops and local departure filters preserve uncertainty", () => {
  const offer: FlightOption = { id: "round-trip", has_return_details: true, segments: [{ depart_at: "2027-01-01 09:00", travel_class: "Economy" }, { depart_at: "2027-01-04 18:00", travel_class: "Economy" }] };
  expect(flightStops(offer)).toBeNull();
  expect(flightStops({ ...offer, outbound_segment_count: 1 })).toBe(0);
  expect(filterFlightOffers([offer], { ...initialFilters, departure: "1", cabin: "Economy" })).toHaveLength(1);
  expect(filterFlightOffers([offer], { ...initialFilters, stops: "0" })).toHaveLength(0);
  expect(filterFlightOffers([{ ...offer, segments: [{}] }], { ...initialFilters, departure: "0" })).toHaveLength(0);
});
