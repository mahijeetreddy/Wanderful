from __future__ import annotations

from pydantic import BaseModel, Field


class ActivityBlock(BaseModel):
    time: str = ""
    period: str = Field(default="activity")
    title: str
    description: str = ""
    location: str = ""
    estimated_cost: float = Field(default=0, ge=0)
    indoor: bool = False
    source_url: str = ""
    rank_score: float = Field(default=0, ge=0, le=100)
    rank_reasons: list[str] = Field(default_factory=list)


class StructuredDay(BaseModel):
    day_number: int = Field(ge=1)
    date: str
    title: str
    summary: str = ""
    activities: list[ActivityBlock] = Field(default_factory=list)
    estimated_cost: float = Field(default=0, ge=0)
    weather_note: str = ""
    transit_note: str = ""
    backup_plan: str = ""


class BudgetCategory(BaseModel):
    category: str
    amount: float = Field(default=0, ge=0)
    note: str = ""


class StructuredItinerary(BaseModel):
    origin: str
    destination: str
    start_date: str
    end_date: str
    currency_code: str = "USD"
    adults: int = Field(default=1, ge=1)
    trip_summary: str = ""
    recommended_hotel_id: str = ""
    recommended_flight_id: str = ""
    locked_hotel_id: str = ""
    locked_flight_id: str = ""
    budget_categories: list[BudgetCategory] = Field(default_factory=list)
    days: list[StructuredDay] = Field(default_factory=list)
    packing_list: list[str] = Field(default_factory=list)
    logistics: list[str] = Field(default_factory=list)
    risks: list[str] = Field(default_factory=list)
    estimated_total: float = Field(default=0, ge=0)
    validation_warnings: list[str] = Field(default_factory=list)
