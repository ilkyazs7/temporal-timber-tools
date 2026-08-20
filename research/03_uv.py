"""
03_uv.py

Turn hourly UV Index into 30 daily UV-exposure increments.

Output:
    data/uv_30steps.csv
"""

from pathlib import Path
import numpy as np
import pandas as pd

WEATHER_FILE = Path("data/weather_hourly.csv")
OUTPUT_DATA = Path("data/uv_30steps.csv")

SIMULATION_DAYS = 30

def main():
    weather = pd.read_csv(
        WEATHER_FILE,
        parse_dates=["simulation_time", "historical_time"],
    )

    weather["uv_index"] = (
        pd.to_numeric(weather["uv_index"], errors="coerce")
        .fillna(0.0)
        .clip(lower=0.0)
    )

    weather["uv_exposure_step_uvi_hour"] = weather["uv_index"]
    weather["simulation_date"] = weather["simulation_time"].dt.date

    daily = (
        weather.groupby("simulation_date", as_index=False)
        .agg(
            uv_increment_uvi_hour=("uv_exposure_step_uvi_hour", "sum"),
        )
        .iloc[:SIMULATION_DAYS]
        .copy()
    )

    daily["day"] = np.arange(1, len(daily) + 1)
    daily["cumulative_uv_uvi_hour"] = (
        daily["uv_increment_uvi_hour"].cumsum()
    )

    day0 = pd.DataFrame({
        "simulation_date": ["t0"],
        "uv_increment_uvi_hour": [0.0],
        "day": [0],
        "cumulative_uv_uvi_hour": [0.0],
    })

    daily = pd.concat([day0, daily], ignore_index=True)

    OUTPUT_DATA.parent.mkdir(parents=True, exist_ok=True)
    daily.to_csv(OUTPUT_DATA, index=False)

    print(f"Saved {OUTPUT_DATA.resolve()}")

if __name__ == "__main__":
    main()
