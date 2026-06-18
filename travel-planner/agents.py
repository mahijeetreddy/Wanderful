from __future__ import annotations

import os
from pathlib import Path

os.environ.setdefault(
    "CREWAI_STORAGE_DIR",
    str(Path.cwd() / ".crewai_runtime"),
)
os.environ["LOCALAPPDATA"] = os.getenv("CREWAI_LOCALAPPDATA", str(Path.cwd() / ".crewai_runtime"))

from crewai import Agent, LLM

from tools import FlightSearchTool, HotelSearchTool, LocalSearchTool, WeatherForecastTool


def _verbose() -> bool:
    return os.getenv("CREW_VERBOSE", "false").lower() == "true"


def create_llm() -> LLM:
    provider = os.getenv("LLM_PROVIDER", "").strip().lower()
    model = os.getenv("LLM_MODEL", os.getenv("OPENAI_MODEL_NAME", "gemini-2.5-flash"))
    if provider == "groq" and os.getenv("GROQ_MODEL"):
        model = os.getenv("GROQ_MODEL", model)

    if provider == "groq" or model.startswith("groq/"):
        if not model.startswith("groq/"):
            model = f"groq/{model}"
        return LLM(
            model=model,
            api_key=os.getenv("GROQ_API_KEY"),
            timeout=120,
        )

    if model.startswith("gemini/"):
        model = model.removeprefix("gemini/")

    if provider == "gemini" or model.startswith("gemini-"):
        return LLM(
            model=model,
            api_key=os.getenv("GEMINI_API_KEY"),
            provider="gemini",
            timeout=120,
        )

    return LLM(
        model=model,
        api_key=os.getenv("OPENAI_API_KEY"),
        provider="openai",
        timeout=120,
    )


def create_orchestrator_agent() -> Agent:
    llm = create_llm()
    return Agent(
        role="OrchestratorAgent - Senior Travel Strategy Manager",
        goal=(
            "Turn traveler inputs and specialist agent outputs into a realistic, "
            "budget-aware travel plan with clear tradeoffs and next actions."
        ),
        backstory=(
            "You are a seasoned travel operations lead who coordinates flights, "
            "lodging, weather, logistics, and local experiences. You are precise "
            "about budgets, cautious about uncertain live data, and excellent at "
            "turning fragmented research into a polished itinerary."
        ),
        allow_delegation=False,
        verbose=_verbose(),
        max_iter=12,
        max_retry_limit=2,
        allow_code_execution=False,
        llm=llm,
    )


def create_flight_agent() -> Agent:
    llm = create_llm()
    return Agent(
        role="FlightAgent - Airfare and Routing Specialist",
        goal=(
            "Find practical flight options that balance total price, routing quality, "
            "travel duration, and budget constraints."
        ),
        backstory=(
            "You specialize in interpreting live flight offers. You compare routes, "
            "connection complexity, travel times, and fare data, then explain the "
            "best options in plain language with provider reference details."
        ),
        tools=[FlightSearchTool()],
        allow_delegation=False,
        verbose=_verbose(),
        max_iter=10,
        max_retry_limit=2,
        allow_code_execution=False,
        llm=llm,
    )


def create_hotel_agent() -> Agent:
    llm = create_llm()
    return Agent(
        role="HotelAgent - Accommodation Curator",
        goal=(
            "Find three distinct accommodation options that fit the destination, "
            "traveler interests, dates, and nightly budget."
        ),
        backstory=(
            "You are an accommodation researcher who balances cost, location, "
            "comfort, and traveler fit. You make budget pressure explicit and avoid "
            "pretending that unavailable live inventory was found."
        ),
        tools=[HotelSearchTool()],
        allow_delegation=False,
        verbose=_verbose(),
        max_iter=10,
        max_retry_limit=2,
        allow_code_execution=False,
        llm=llm,
    )


def create_weather_logistics_agent() -> Agent:
    llm = create_llm()
    return Agent(
        role="WeatherLogisticsAgent - Forecast and Practicalities Specialist",
        goal=(
            "Use live weather data where available to produce packing, mobility, "
            "currency, timing, and travel logistics guidance."
        ),
        backstory=(
            "You are a logistics planner who turns weather forecasts and destination "
            "context into useful preparation advice. You distinguish confirmed "
            "forecast data from general destination guidance."
        ),
        tools=[WeatherForecastTool()],
        allow_delegation=False,
        verbose=_verbose(),
        max_iter=10,
        max_retry_limit=2,
        allow_code_execution=False,
        llm=llm,
    )


def create_activity_agent() -> Agent:
    llm = create_llm()
    return Agent(
        role="ActivityAgent - Local Itinerary Designer",
        goal=(
            "Build a cohesive day-by-day activity plan using traveler interests, "
            "weather context, hotel/location assumptions, and live web search results."
        ),
        backstory=(
            "You are a local-experience planner who designs efficient daily routes "
            "with realistic pacing, meal ideas, indoor/outdoor backups, and links "
            "to source material where available."
        ),
        tools=[LocalSearchTool()],
        allow_delegation=False,
        verbose=_verbose(),
        max_iter=14,
        max_retry_limit=2,
        allow_code_execution=False,
        llm=llm,
    )


def create_travel_agents() -> dict[str, Agent]:
    return {
        "orchestrator": create_orchestrator_agent(),
        "flight": create_flight_agent(),
        "hotel": create_hotel_agent(),
        "weather_logistics": create_weather_logistics_agent(),
        "activity": create_activity_agent(),
    }
