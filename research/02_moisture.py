"""
02_moisture.py

Turn hourly temperature + RH into 30 daily moisture-exposure increments.

Output:
    data/moisture_30steps.csv
"""

from pathlib import Path
import numpy as np
import pandas as pd

WEATHER_FILE = Path("data/weather_hourly.csv")
OUTPUT_DATA = Path("data/moisture_30steps.csv")

SIMULATION_DAYS = 30
STARTING_TIMBER_MC = 14.0

def wood_emc(temperature_c, relative_humidity_percent):
    T = np.asarray(temperature_c, dtype=float)
    h = np.asarray(relative_humidity_percent, dtype=float) / 100.0
    h = np.clip(h, 0.0, 0.999)

    W = 349 + 1.29 * T + 0.0135 * T**2
    K = 0.805 + 0.000736 * T - 0.00000273 * T**2
    K1 = 6.27 - 0.00938 * T - 0.000303 * T**2
    K2 = 1.91 + 0.0407 * T - 0.000293 * T**2

    term_1 = (K * h) / (1 - K * h)

    term_2 = (
        K1 * K * h
        + 2 * K1 * K2 * K**2 * h**2
    ) / (
        1
        + K1 * K * h
        + K1 * K2 * K**2 * h**2
    )

    return (1800 / W) * (term_1 + term_2)

def main():
    weather = pd.read_csv(
        WEATHER_FILE,
        parse_dates=["simulation_time", "historical_time"],
    )

    weather["emc_percent"] = wood_emc(
        weather["temperature_C"],
        weather["relative_humidity_percent"],
    )

    weather["moisture_pressure_percent"] = np.maximum(
        weather["emc_percent"] - STARTING_TIMBER_MC,
        0.0,
    )

    weather["moisture_exposure_step_percent_hour"] = (
        weather["moisture_pressure_percent"]
    )

    weather["simulation_date"] = weather["simulation_time"].dt.date

    daily = (
        weather.groupby("simulation_date", as_index=False)
        .agg(
            moisture_percent=("emc_percent", "mean"),
            moisture_exposure_increment_percent_hour=(
                "moisture_exposure_step_percent_hour",
                "sum",
            ),
        )
        .iloc[:SIMULATION_DAYS]
        .copy()
    )

    daily["day"] = np.arange(1, len(daily) + 1)
    daily["cumulative_moisture_exposure_percent_hour"] = (
        daily["moisture_exposure_increment_percent_hour"].cumsum()
    )

    day0 = pd.DataFrame({
        "simulation_date": ["t0"],
        "moisture_percent": [STARTING_TIMBER_MC],
        "moisture_exposure_increment_percent_hour": [0.0],
        "day": [0],
        "cumulative_moisture_exposure_percent_hour": [0.0],
    })

    daily = pd.concat([day0, daily], ignore_index=True)

    OUTPUT_DATA.parent.mkdir(parents=True, exist_ok=True)
    daily.to_csv(OUTPUT_DATA, index=False)

    print(f"Saved {OUTPUT_DATA.resolve()}")

if __name__ == "__main__":
    main()
