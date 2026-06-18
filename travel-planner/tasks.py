from __future__ import annotations

import os
from pathlib import Path

os.environ.setdefault(
    "CREWAI_STORAGE_DIR",
    str(Path.cwd() / ".crewai_runtime"),
)
os.environ["LOCALAPPDATA"] = os.getenv("CREWAI_LOCALAPPDATA", str(Path.cwd() / ".crewai_runtime"))

from crewai import Agent, Task


def create_budget_strategy_task(agent: Agent) -> Task:
    return Task(
        description=(
            "Analyze the traveler request:\n"
            "- Origin: {origin}\n"
            "- Destination: {destination}\n"
            "- Dates: {start_date} to {end_date}\n"
            "- Total budget: {budget} {currency_code}\n"
            "- Interests: {interests}\n\n"
            "Create a practical budget strategy. Allocate the budget across flights, "
            "lodging, food, local transportation, activities, and contingency. "
            "State assumptions, trip length, per-night lodging target, and any "
            "budget risks before specialist research begins."
        ),
        expected_output=(
            "A concise Markdown budget strategy with category limits, nightly hotel "
            "target, flight target, assumptions, and budget risks."
        ),
        agent=agent,
    )


def create_flight_search_task(agent: Agent, context: list[Task]) -> Task:
    return Task(
        description=(
            "Using the budget strategy, search for live flight options from {origin} "
            "to {destination}. Use departure date {start_date} and return date "
            "{end_date}. Prefer options within the flight budget, but include the "
            "best available alternatives if no option fits.\n\n"
            "Return route details, total prices, airlines, timing, connection notes, "
            "and any SerpAPI booking tokens, property tokens, or booking references available."
        ),
        expected_output=(
            "Markdown section with 3-5 ranked flight options, prices, route summaries, "
            "booking/reference links or tokens, and a clear recommendation."
        ),
        agent=agent,
        context=context,
    )


def create_accommodation_search_task(agent: Agent, context: list[Task]) -> Task:
    return Task(
        description=(
            "Using the budget strategy, search for accommodations in {destination} "
            "for {start_date} to {end_date}. Find three distinct options that fit "
            "the nightly budget and traveler interests: {interests}.\n\n"
            "Compare location fit, likely traveler experience, total price, room "
            "details, cancellation notes, and booking/provider references."
        ),
        expected_output=(
            "Markdown section with exactly 3 accommodation options when inventory "
            "allows, including price, location notes, pros/cons, and references."
        ),
        agent=agent,
        context=context,
    )


def create_logistics_task(agent: Agent, context: list[Task]) -> Task:
    return Task(
        description=(
            "Pull the live weather forecast for {destination} from {start_date} to "
            "{end_date}. Use the weather data plus general travel knowledge to "
            "create a logistics plan.\n\n"
            "Include packing guidance, weather risks, local transportation advice, "
            "currency/payment notes, visa/document reminders, connectivity tips, "
            "and what forecast data is unavailable if the dates exceed the API window."
        ),
        expected_output=(
            "Markdown logistics section with forecast summary, packing list, local "
            "practicalities, and explicit uncertainty notes."
        ),
        agent=agent,
        context=context,
    )


def create_itinerary_generation_task(agent: Agent, context: list[Task]) -> Task:
    return Task(
        description=(
            "Build a day-by-day itinerary for {destination} from {start_date} to "
            "{end_date}. Use traveler interests ({interests}), the accommodation "
            "findings, and the weather/logistics context. Use local web search to "
            "find attractions, neighborhoods, restaurants, and activity ideas.\n\n"
            "Create realistic pacing with morning, afternoon, and evening blocks. "
            "Include indoor/outdoor backups where weather could interfere and cite "
            "links from search results where available."
        ),
        expected_output=(
            "A structured Markdown day-by-day itinerary with meal suggestions, "
            "activity links, timing notes, transit assumptions, and weather backups."
        ),
        agent=agent,
        context=context,
    )


def create_final_compilation_task(agent: Agent, context: list[Task]) -> Task:
    return Task(
        description=(
            "Review all specialist outputs for the trip from {origin} to {destination} "
            "from {start_date} to {end_date}. Compile a final Markdown travel plan.\n\n"
            "The final document must include:\n"
            "1. Executive trip summary\n"
            "2. Budget allocation and estimated cost breakdown\n"
            "3. Recommended flight option with alternatives\n"
            "4. Three accommodation options or a clear inventory limitation note\n"
            "5. Weather, packing, and logistics plan\n"
            "6. Day-by-day itinerary\n"
            "7. Booking/reference links, booking tokens, and property tokens\n"
            "8. Risks, assumptions, and next steps\n\n"
            "Do not invent live prices or links. If a tool was unavailable because an "
            "API key was missing, preserve that fact and provide a placeholder action "
            "for the user to add the credential."
        ),
        expected_output=(
            "A polished, highly structured Markdown itinerary string with budget "
            "adherence checks, links/references, and concrete next actions."
        ),
        agent=agent,
        context=context,
    )


def create_travel_tasks(agents: dict[str, Agent]) -> list[Task]:
    budget_task = create_budget_strategy_task(agents["orchestrator"])
    flight_task = create_flight_search_task(agents["flight"], [budget_task])
    hotel_task = create_accommodation_search_task(agents["hotel"], [budget_task])
    logistics_task = create_logistics_task(
        agents["weather_logistics"],
        [budget_task, flight_task, hotel_task],
    )
    itinerary_task = create_itinerary_generation_task(
        agents["activity"],
        [budget_task, hotel_task, logistics_task],
    )
    final_task = create_final_compilation_task(
        agents["orchestrator"],
        [budget_task, flight_task, hotel_task, logistics_task, itinerary_task],
    )
    return [
        budget_task,
        flight_task,
        hotel_task,
        logistics_task,
        itinerary_task,
        final_task,
    ]


def create_fast_itinerary_task(agent: Agent) -> Task:
    return Task(
        description=(
            "Create a polished Markdown travel itinerary using only the supplied trip data.\n\n"
            "Traveler inputs:\n"
            "- Origin: {origin}\n"
            "- Destination: {destination}\n"
            "- Dates: {start_date} to {end_date}\n"
            "- Total budget: {budget} {currency_code}\n"
            "- Adults: {adults}\n"
            "- Interests: {interests}\n\n"
            "Live provider data and provider status blocks:\n"
            "{trip_data}\n\n"
            "Important constraints:\n"
            "- Do not call, invent, or reference external tools.\n"
            "- Do not invent live prices, booking links, or availability.\n"
            "- If provider data contains an error or limitation, include it as a clear note.\n"
            "- Build a practical day-by-day plan from the available data."
        ),
        expected_output=(
            "A structured Markdown itinerary with trip summary, cost breakdown, "
            "flight/hotel/weather/activity sections, day-by-day plan, risks, and next actions."
        ),
        agent=agent,
    )
