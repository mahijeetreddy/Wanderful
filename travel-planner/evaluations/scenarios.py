from __future__ import annotations

from datetime import date, timedelta


DESTINATIONS = [
    ("Tokyo", "food, neighborhoods, temples"),
    ("Paris", "art, cafes, architecture"),
    ("Seoul", "local food, shopping, hiking"),
    ("Honolulu", "quiet beaches, snorkeling, scenic drives"),
    ("Seattle", "coffee, markets, nature"),
    ("New York", "theater, food, museums"),
    ("London", "history, markets, music"),
    ("Mexico City", "food, art, neighborhoods"),
    ("Barcelona", "architecture, beaches, tapas"),
    ("Vancouver", "hiking, food, waterfront"),
]


def evaluation_scenarios() -> list[dict[str, object]]:
    start = date.today() + timedelta(days=60)
    scenarios: list[dict[str, object]] = []
    for destination_index, (destination, interests) in enumerate(DESTINATIONS):
        for variant in range(5):
            days = [2, 4, 6, 9, 14][variant]
            budget = [600, 1200, 2400, 4200, 7000][variant]
            scenarios.append(
                {
                    "id": f"{destination.lower().replace(' ', '-')}-{variant + 1}",
                    "origin": "LAX",
                    "destination": destination,
                    "start_date": (start + timedelta(days=destination_index * 3)).isoformat(),
                    "end_date": (start + timedelta(days=destination_index * 3 + days - 1)).isoformat(),
                    "budget": budget,
                    "currency_code": "USD",
                    "adults": 1 if variant < 3 else 2,
                    "interests": interests,
                    "failure_profile": ["none", "missing_flights", "missing_hotels", "rain", "provider_timeout"][variant],
                }
            )
    return scenarios
