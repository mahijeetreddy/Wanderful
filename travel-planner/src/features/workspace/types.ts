import type { FlightOption, HotelOption, PlannerForm } from "../../domain/travel";
export type PersonalPreferences = { pace: string; walking: string; flight_time: string; stay_priority: string; interests: string };
export type InboxBooking = { title: string; kind: string; reference: string; start_date: string; end_date: string; time: string; address: string; notes: string; status: "draft" | "confirmed" | "cancelled" };
export type Scenario = { name: string; base_revision: number; form: PlannerForm; currency: string; exponent: number; travel_total_minor: number | null; baseline_travel_total_minor: number | null; expected_trip_total_minor?: number | null; budget_remaining_minor?: number | null; delta_minor: number | null; available_hours: number | null; warnings: string[]; activity_windows: Record<string, string>; selected: { flights?: FlightOption; hotels?: HotelOption }; impacts: { affected_activities: { title: string; locked: boolean }[] }[] };
export type ToolRecord = { id: string; type: "scenario"; data: Scenario } | { id: string; type: "inbox"; data: InboxBooking };
export const field = "mt-2 min-h-11 w-full rounded-xl border border-white/25 bg-[#14282e] px-3 py-2 text-white";
export const primary = "min-h-11 rounded-full bg-[#91e4db] px-5 py-2 font-medium text-[#092322] disabled:opacity-50";
export const secondary = "min-h-11 rounded-full border border-white/25 px-5 py-2 text-white disabled:opacity-50";
export function message(error: unknown) { return error instanceof Error ? error.message : "Could not complete this request."; }
