"""
01_weather.py

Download hourly weather for the same 30 calendar days from the previous year.

Output:
    data/weather_hourly.csv
"""

from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

import pandas as pd
import requests

LOCATION_NAME = "77 Massachusetts Ave, Cambridge, MA 02139"
LATITUDE = 42.3591
LONGITUDE = -71.0935
TIMEZONE = "America/New_York"

SIMULATION_DAYS = 30
OUTPUT = Path("data/weather_hourly.csv")

def previous_year(date_value):
    try:
        return date_value.replace(year=date_value.year - 1)
    except ValueError:
        return date_value.replace(year=date_value.year - 1, day=28)

def main():
    today = datetime.now(ZoneInfo(TIMEZONE)).date()
    historical_start = previous_year(today)
    historical_end = historical_start + timedelta(days=SIMULATION_DAYS - 1)

    print(f"Location: {LOCATION_NAME}")
    print(f"Simulation t0: {today}")
    print(f"Historical analogue: {historical_start} -> {historical_end}")

    url = "https://historical-forecast-api.open-meteo.com/v1/forecast"

    params = {
        "latitude": LATITUDE,
        "longitude": LONGITUDE,
        "start_date": historical_start.isoformat(),
        "end_date": historical_end.isoformat(),
        "hourly": (
            "uv_index,"
            "temperature_2m,"
            "relative_humidity_2m,"
            "precipitation"
        ),
        "timezone": TIMEZONE,
    }

    response = requests.get(url, params=params, timeout=30)
    response.raise_for_status()

    h = response.json()["hourly"]

    df = pd.DataFrame({
        "historical_time": pd.to_datetime(h["time"]),
        "uv_index": h["uv_index"],
        "temperature_C": h["temperature_2m"],
        "relative_humidity_percent": h["relative_humidity_2m"],
        "precipitation_mm": h["precipitation"],
    })

    shift = pd.Timestamp(today) - pd.Timestamp(historical_start)
    df["simulation_time"] = df["historical_time"] + shift

    df = df[
        [
            "simulation_time",
            "historical_time",
            "uv_index",
            "temperature_C",
            "relative_humidity_percent",
            "precipitation_mm",
        ]
    ]

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(OUTPUT, index=False)

    print(f"Saved {len(df)} hourly rows to {OUTPUT.resolve()}")

if __name__ == "__main__":
    main()
