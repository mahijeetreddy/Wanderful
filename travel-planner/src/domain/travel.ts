export type PlannerForm = {
  origin: string;
  destination: string;
  start_date: string;
  end_date: string;
  budget: string;
  currency_code: string;
  adults: string;
  interests: string;
};

export type PlanResponse = {
  itinerary?: string;
  options?: PlannerOptions;
  structured_itinerary?: StructuredItineraryData;
  metrics?: Record<string, unknown>;
  error?: string;
};

export type PlanJob = {
  id: string;
  status: "queued" | "collecting" | "planning" | "regenerating" | "complete" | "failed" | "cancelled";
  progress: string;
  options?: PlannerOptions;
  itinerary?: string;
  structured_itinerary?: StructuredItineraryData;
  metrics?: Record<string, unknown>;
  error?: string;
};

export type StructuredActivityData = {
  schedule_conflict?: string;
  source_id?: string;
  time?: string;
  period?: string;
  title: string;
  description?: string;
  location?: string;
  estimated_cost?: number;
  indoor?: boolean;
  source_url?: string;
  rank_score?: number;
  rank_reasons?: string[];
  coordinates?: Coordinates | null;
};

export type StructuredDayData = {
  day_number: number;
  date: string;
  title: string;
  summary?: string;
  activities?: StructuredActivityData[];
  estimated_cost?: number;
  weather_note?: string;
  transit_note?: string;
  backup_plan?: string;
};

export type BudgetCategoryData = {
  category: string;
  amount?: number;
  note?: string;
};

export type StructuredItineraryData = {
  trip_summary?: string;
  currency_code?: string;
  recommended_hotel_id?: string;
  recommended_flight_id?: string;
  locked_hotel_id?: string;
  locked_flight_id?: string;
  days?: StructuredDayData[];
  budget_categories?: BudgetCategoryData[];
  packing_list?: string[];
  logistics?: string[];
  risks?: string[];
  estimated_total?: number;
  validation_warnings?: string[];
};

export type ResultTab = "overview" | "itinerary" | "hotels" | "flights" | "tools" | "raw";

export type PriceInsights = {
  lowest_price?: number | null;
  price_level?: string | null;
  typical_price_range?: [number, number] | null;
};

export type WeatherDay = {
  date: string;
  temp_high?: number | null;
  temp_low?: number | null;
  precip_probability?: number | null;
  condition_group?: string | null;
  conditions_label?: string | null;
};

export type WeatherInfo = {
  units?: string;
  days: WeatherDay[];
};

export type PlannerOptions = {
  provider_status?: Record<string, ProviderStatus>;
  hotels: HotelOption[];
  flights: FlightOption[];
  flight_recovery: FlightRecoverySuggestion[];
  map_center: Coordinates | null;
  price_insights?: PriceInsights | null;
  weather?: WeatherInfo | null;
};

export type Coordinates = {
  lat: number;
  lng: number;
};

export type ProviderStatus = "queued" | "searching" | "success" | "empty" | "unavailable" | "timeout" | "error";
export type SearchSession = {
  id: string;
  kind: "flights" | "hotels";
  status: ProviderStatus;
  context: Record<string, unknown>;
  flights?: FlightOffer[];
  hotels?: HotelOffer[];
  map_center?: Coordinates | null;
  message?: string;
};
export type FlightOffer = FlightOption;
export type HotelOffer = HotelOption;
export type TripSelection = {
  snapshot_id: string;
  kind: "flights" | "hotels";
  status: "selected" | "externally_booked";
  booking_reference?: string;
};

export type HotelOption = {
  property_id?: string;
  room_type?: string | null;
  rate_source?: string | null;
  rate_inclusions?: string[];
  price_amount?: string;
  price_basis?: string;
  completeness?: { status: "complete" | "partial"; missing_fields: string[] };
  snapshot_id?: string;
  provider_reference?: string | null;
  retrieved_at?: string | null;
  stale_after?: string | null;
  freshness?: "snapshot" | "historical";
  search_context?: Record<string, unknown>;
  id: string;
  name: string;
  description?: string | null;
  hotel_class?: string | null;
  rating?: number | string | null;
  reviews?: number | string | null;
  nightly_rate?: string | null;
  extracted_nightly_rate?: number | null;
  estimated_total?: number | null;
  currency?: string | null;
  amenities?: string[];
  link?: string | null;
  coordinates?: Coordinates | null;
  image_thumbnail?: string | null;
  image_url?: string | null;
  rank?: number;
  rank_score?: number;
  rank_reasons?: string[];
  distance_km?: number | null;
};

export type FlightSegment = {
  airline?: string | null;
  flight_number?: string | null;
  from?: string | null;
  to?: string | null;
  depart_at?: string | null;
  arrive_at?: string | null;
  airplane?: string | null;
  travel_class?: string | null;
  duration_minutes?: number | null;
};

export type FlightLayover = {
  id?: string | null;
  name?: string | null;
  duration?: number | null;
  overnight?: boolean;
};

export type CarbonEmissions = {
  this_flight?: number | null;
  typical_for_this_route?: number | null;
  difference_percent?: number | null;
};

export type FlightOption = {
  outbound_duration_minutes?: number | null;
  return_duration_minutes?: number | null;
  outbound_segment_count?: number;
  completeness?: { status: "complete" | "partial"; missing_fields: string[] };
  snapshot_id?: string;
  provider_reference?: string | null;
  retrieved_at?: string | null;
  stale_after?: string | null;
  freshness?: "snapshot" | "historical";
  search_context?: Record<string, unknown>;
  id: string;
  total_price?: number | string | null;
  currency?: string | null;
  total_duration_minutes?: number | null;
  layovers?: FlightLayover[];
  departure_token?: string | null;
  booking_token?: string | null;
  reference?: string | null;
  carbon_emissions?: CarbonEmissions | null;
  segments?: FlightSegment[];
  has_return_details?: boolean;
  rank?: number;
  rank_score?: number;
  rank_reasons?: string[];
};

export type FlightBookingOption = {
  id: string;
  title: string;
  price?: number | string | null;
  currency?: string | null;
  link?: string | null;
  description?: string | null;
  extensions?: string[];
};

export type FlightRecoverySuggestion = {
  type: string;
  label: string;
  instruction: string;
};

export type DayPlan = {
  day: string;
  title: string;
  summary: string;
  bullets: string[];
  details: string[];
};

export type SavedTrip = {
  revision?: number;
  selections?: TripSelection[];
  id: string;
  name: string;
  destination: string;
  dateRange: string;
  savedAt: string;
  form: PlannerForm;
  itinerary: string;
  options: PlannerOptions;
  structuredItinerary?: StructuredItineraryData;
  resultTab: ResultTab;
  shareToken?: string | null;
  constraints?: Record<string, "locked" | "preferred" | "optional" | "avoid">;
  liveState?: Record<string, unknown>;
  budgetState?: BudgetState;
  disruptionHistory?: DisruptionHistoryItem[];
};

export type BudgetExpense = {
  id: string;
  label: string;
  category: string;
  amount: number;
  paid_by: string;
  split_count: number;
  split_between?: string[];
  occurred_at: string;
};

export type BudgetState = {
  expenses?: BudgetExpense[];
  members?: string[];
  settlements?: GroupSettlement[];
  reserve_percent?: number;
  updated_at?: string;
};

export type GroupSettlement = {
  id: string;
  from: string;
  to: string;
  amount: number;
  settled_at: string;
};

export type TravelDocument = {
  id: string;
  name: string;
  category: string;
  mime_type: string;
  size_bytes: number;
  expires_on?: string | null;
  created_at: string;
};

export type BudgetGuardian = {
  currency: string;
  budget: number;
  committed: number;
  actual: number;
  forecast: number;
  reserve: number;
  spendable: number;
  remaining: number;
  status: "on_track" | "watch" | "over_budget";
  alerts: string[];
  breakdown: Array<{ category: string; planned: number; actual: number; variance: number }>;
  expenses: BudgetExpense[];
  reserve_percent: number;
};

export type DisruptionHistoryItem = {
  event: string;
  strategy: string;
  title: string;
  changes: string[];
  cost_delta: number;
  applied_at: string;
};

export type OfflineTripPack = {
  owner_id?: number;
  version: number;
  generated_at: string;
  checksum: string;
  item_count: number;
  trip: { id: string; name: string; destination: string; date_range: string };
  days: StructuredDayData[];
  bookings: { hotel?: HotelOption | null; flight?: FlightOption | null };
  essentials: { packing: string[]; logistics: string[]; risks: string[] };
  emergency: Record<string, string>;
};

export type AuthUser = {
  id: number;
  name: string;
  email: string;
  status?: "pending" | "active" | "rejected";
  role?: "user" | "admin";
};

export type AuthMode = "login" | "register";

export type UserPreferences = {
  budget_style: string;
  travel_style: string;
  likes: string[];
  dislikes: string[];
  home_airport: string;
  preferred_currency: string;
  date_of_birth: string;
  age: number | null;
  memory?: TravelMemory;
};

export type TravelMemory = {
  signals?: Record<string, Record<string, number>>;
  recent_feedback?: Array<{
    title: string;
    sentiment: string;
    tags: string[];
    recorded_at: string;
  }>;
};

export type TripHealthIssue = {
  id: string;
  severity: "critical" | "warning" | "info";
  category: string;
  message: string;
  repair: string;
  items: string[];
};

export type RecommendationEvidence = {
  item_key: string;
  day_number: number;
  activity_index: number;
  title: string;
  source_url: string;
  confidence: "high" | "medium" | "low";
  reasons: string[];
  freshness?: string | null;
  constraint: "locked" | "preferred" | "optional" | "avoid";
};

export type TripHealth = {
  score: number;
  grade: string;
  summary: string;
  issues: TripHealthIssue[];
  evidence: RecommendationEvidence[];
};
