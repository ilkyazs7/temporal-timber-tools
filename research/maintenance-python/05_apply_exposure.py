"""
05_apply_exposure.py

Apply coverage to the daily UV and moisture increments.

For each cell:

effective UV increment
    = base UV increment
      * (1 - coverage * sun protection efficiency)

effective moisture increment
    = base moisture increment
      * (1 - coverage * moisture protection efficiency)

If coverage=1 and efficiency=1, a cell receives no new exposure that day.

Past accumulated exposure remains.
"""

from pathlib import Path
import json

import numpy as np
import pandas as pd

UV_FILE = Path("data/uv_30steps.csv")
MOISTURE_FILE = Path("data/moisture_30steps.csv")
MASK_FILE = Path("data/coverage_masks.npy")
CONFIG_FILE = Path("data/intervention_config.json")

UV_OUTPUT = Path("data/effective_uv_cumulative.npy")
MOISTURE_OUTPUT = Path("data/effective_moisture_cumulative.npy")

SIMULATION_DAYS = 30
GRID_SIZE = 10

def main():
    uv = pd.read_csv(UV_FILE)
    moisture = pd.read_csv(MOISTURE_FILE)
    coverage = np.load(MASK_FILE)

    with open(CONFIG_FILE, "r", encoding="utf-8") as f:
        config = json.load(f)

    sun_eff = float(config["sun_protection_efficiency"])
    moisture_eff = float(config["moisture_protection_efficiency"])

    uv_increment = uv["uv_increment_uvi_hour"].to_numpy(float)

    moisture_increment = moisture[
        "moisture_exposure_increment_percent_hour"
    ].to_numpy(float)

    effective_uv = np.zeros(
        (SIMULATION_DAYS + 1, GRID_SIZE, GRID_SIZE),
        dtype=float,
    )

    effective_moisture = np.zeros_like(effective_uv)

    for day in range(1, SIMULATION_DAYS + 1):
        mask = coverage[day]

        uv_multiplier = 1.0 - mask * sun_eff
        moisture_multiplier = 1.0 - mask * moisture_eff

        uv_step = uv_increment[day] * uv_multiplier

        moisture_step = (
            moisture_increment[day]
            * moisture_multiplier
        )

        effective_uv[day] = (
            effective_uv[day - 1]
            + uv_step
        )

        effective_moisture[day] = (
            effective_moisture[day - 1]
            + moisture_step
        )

    UV_OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    np.save(UV_OUTPUT, effective_uv)
    np.save(MOISTURE_OUTPUT, effective_moisture)

    print("Effective UV:", effective_uv.shape)
    print("Effective moisture:", effective_moisture.shape)

if __name__ == "__main__":
    main()
