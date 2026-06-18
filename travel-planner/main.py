from __future__ import annotations

import sys
import os
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path

os.environ.setdefault(
    "CREWAI_STORAGE_DIR",
    str(Path.cwd() / ".crewai_runtime"),
)
os.environ["LOCALAPPDATA"] = os.getenv("CREWAI_LOCALAPPDATA", str(Path.cwd() / ".crewai_runtime"))
os.environ.setdefault("CREWAI_TRACING_ENABLED", "false")
os.environ.setdefault("PYTHONIOENCODING", "utf-8")
for stream in (sys.stdout, sys.stderr):
    if hasattr(stream, "reconfigure"):
        stream.reconfigure(encoding="utf-8", errors="replace")
if os.getenv("USE_SYSTEM_PROXY", "false").lower() != "true":
    for proxy_var in (
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "ALL_PROXY",
        "http_proxy",
        "https_proxy",
        "all_proxy",
    ):
        os.environ.pop(proxy_var, None)

from crewai import Crew, Process
from dotenv import load_dotenv

from agents import create_travel_agents
from tasks import create_travel_tasks


DATE_FORMAT = "%Y-%m-%d"


@dataclass(frozen=True)
class TravelInputs:
    origin: str
    destination: str
    start_date: str
    end_date: str
    budget: str
    interests: str
    currency_code: str = "USD"
    adults: int = 1

    def as_crew_inputs(self) -> dict[str, str | int]:
        return {
            "origin": self.origin,
            "destination": self.destination,
            "start_date": self.start_date,
            "end_date": self.end_date,
            "budget": self.budget,
            "interests": self.interests,
            "currency_code": self.currency_code,
            "adults": self.adults,
        }


def _prompt_required(label: str) -> str:
    while True:
        value = input(f"{label}: ").strip()
        if value:
            return value
        print(f"{label} is required.")


def _prompt_date(label: str) -> str:
    while True:
        value = _prompt_required(label)
        try:
            datetime.strptime(value, DATE_FORMAT)
            return value
        except ValueError:
            print("Please enter the date in YYYY-MM-DD format.")


def _prompt_budget() -> str:
    while True:
        value = _prompt_required("Total budget")
        normalized = value.replace(",", "").replace("$", "").strip()
        try:
            amount = Decimal(normalized)
        except InvalidOperation:
            print("Please enter a numeric budget, for example 2500.")
            continue
        if amount <= 0:
            print("Budget must be greater than zero.")
            continue
        return f"{amount:.2f}"


def _prompt_currency() -> str:
    value = input("Currency code [USD]: ").strip().upper() or "USD"
    while len(value) != 3 or not value.isalpha():
        print("Currency code must be a 3-letter ISO code, for example USD or EUR.")
        value = input("Currency code [USD]: ").strip().upper() or "USD"
    return value


def _prompt_adults() -> int:
    value = input("Adult travelers [1]: ").strip()
    if not value:
        return 1
    while True:
        try:
            adults = int(value)
        except ValueError:
            print("Adult travelers must be a number from 1 to 9.")
        else:
            if 1 <= adults <= 9:
                return adults
            print("Adult travelers must be between 1 and 9.")
        value = input("Adult travelers [1]: ").strip() or "1"


def collect_inputs() -> TravelInputs:
    print("Enter trip details. Airport/city IATA codes work best for origin and destination.")
    origin = _prompt_required("Origin")
    destination = _prompt_required("Destination")

    while True:
        start_date = _prompt_date("Start date (YYYY-MM-DD)")
        end_date = _prompt_date("End date (YYYY-MM-DD)")
        start = datetime.strptime(start_date, DATE_FORMAT).date()
        end = datetime.strptime(end_date, DATE_FORMAT).date()
        if end > start:
            break
        print("End date must be after start date.")

    budget = _prompt_budget()
    currency_code = _prompt_currency()
    adults = _prompt_adults()
    interests = _prompt_required("Interests (comma separated or short phrase)")

    return TravelInputs(
        origin=origin,
        destination=destination,
        start_date=start_date,
        end_date=end_date,
        budget=budget,
        interests=interests,
        currency_code=currency_code,
        adults=adults,
    )


def build_travel_crew() -> Crew:
    agents = create_travel_agents()
    tasks = create_travel_tasks(agents)
    return Crew(
        agents=list(agents.values()),
        tasks=tasks,
        process=Process.sequential,
        verbose=os.getenv("CREW_VERBOSE", "false").lower() == "true",
        max_rpm=int(os.getenv("CREW_MAX_RPM", "4")),
        tracing=os.getenv("CREWAI_TRACING_ENABLED", "false").lower() == "true",
    )


def run() -> str:
    load_dotenv()
    travel_inputs = collect_inputs()
    crew = build_travel_crew()
    result = crew.kickoff(inputs=travel_inputs.as_crew_inputs())
    return str(result)


def main() -> int:
    try:
        final_itinerary = run()
    except KeyboardInterrupt:
        print("\nTravel planning cancelled.")
        return 130
    except Exception as exc:
        print(f"Travel planner failed: {exc}", file=sys.stderr)
        return 1

    print("\n\n=== FINAL TRAVEL PLAN ===\n")
    print(final_itinerary)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
