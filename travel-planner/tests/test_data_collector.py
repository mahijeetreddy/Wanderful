import json

from data_collector import normalize_weather


def test_normalize_weather_extracts_daily_summaries():
    provider_result = json.dumps(
        {
            "destination": "Seattle, US",
            "source": "OpenWeather 5-day / 3-hour forecast",
            "units": "imperial",
            "notice": None,
            "daily_forecast": [
                {
                    "date": "2026-08-01",
                    "temperature_range": "58 to 66",
                    "temp_high": 66.4,
                    "temp_low": 58.1,
                    "max_precip_probability": "80%",
                    "precip_probability": 80,
                    "common_conditions": ["light rain", "overcast clouds"],
                    "condition_group": "Rain",
                },
                {
                    "date": "2026-08-02",
                    "temperature_range": "60 to 72",
                    "temp_high": 72.0,
                    "temp_low": 60.0,
                    "max_precip_probability": "0%",
                    "precip_probability": 0,
                    "common_conditions": ["clear sky"],
                    "condition_group": "Clear",
                },
            ],
        }
    )

    result = normalize_weather(provider_result)

    assert result["units"] == "imperial"
    assert [day["date"] for day in result["days"]] == ["2026-08-01", "2026-08-02"]

    rainy_day = result["days"][0]
    assert rainy_day["temp_high"] == 66.4
    assert rainy_day["temp_low"] == 58.1
    assert rainy_day["precip_probability"] == 80
    assert rainy_day["condition_group"] == "Rain"
    assert rainy_day["conditions_label"] == "Light Rain"

    clear_day = result["days"][1]
    assert clear_day["condition_group"] == "Clear"
    assert clear_day["precip_probability"] == 0


def test_normalize_weather_returns_none_for_unavailable_text():
    assert normalize_weather("Weather forecast unavailable: set OPENWEATHER_API_KEY in your environment or .env file.") is None
    assert normalize_weather(json.dumps({"destination": "Nowhere", "notice": "No forecast entries overlap the requested travel dates."})) is None
