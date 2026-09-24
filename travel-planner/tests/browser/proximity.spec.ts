import { expect, test } from "@playwright/test";
import { meanDistanceKm } from "../../src/features/stays/proximity";
test("stay proximity is a bounded straight-line estimate with unknowns preserved", () => {
  expect(meanDistanceKm({ lat: 0, lng: 0 }, [{ lat: 0, lng: 1 }])).toBeCloseTo(111.195, 2);
  expect(meanDistanceKm(null, [{ lat: 0, lng: 1 }])).toBeNull();
  expect(meanDistanceKm({ lat: 90.1, lng: 0 }, [{ lat: 0, lng: 1 }])).toBeNull();
  expect(meanDistanceKm({ lat: 0, lng: 0 }, [])).toBeNull();
});
