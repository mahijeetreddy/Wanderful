import { useState } from "react";
import type { PlannerForm, PlannerOptions, ResultTab, StructuredItineraryData } from "../../domain/travel";

export function useTripWorkspace(initialForm: PlannerForm, emptyOptions: PlannerOptions) {
  const [form, setForm] = useState(initialForm);
  const [itinerary, setItinerary] = useState("");
  const [structuredItinerary, setStructuredItinerary] = useState<StructuredItineraryData | null>(null);
  const [activePlanJobId, setActivePlanJobId] = useState<string | null>(null);
  const [options, setOptions] = useState(emptyOptions);
  const [resultTab, setResultTab] = useState<ResultTab>("itinerary");
  return { form, setForm, itinerary, setItinerary, structuredItinerary, setStructuredItinerary, activePlanJobId, setActivePlanJobId, options, setOptions, resultTab, setResultTab };
}
