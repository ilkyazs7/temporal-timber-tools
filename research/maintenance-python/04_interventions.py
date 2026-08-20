"""
04_interventions.py

Create the geometric coverage layer and the maintenance schedule.

coverage[day, y, x]

    0.0 = exposed
    1.0 = fully covered/protected

For now:
- three reproducible random geometric patterns are generated
- a maintenance schedule turns coverage on/off and changes geometry

Later:
the website can create the same JSON structure from user interaction.

Outputs:
    data/intervention_config.json
    data/coverage_masks.npy
    data/maintenance_log.csv
    output/coverage_patterns.png
"""

from pathlib import Path
import json

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

GRID_SIZE = 10
SIMULATION_DAYS = 30
RANDOM_SEED = 42

CONFIG_FILE = Path("data/intervention_config.json")
MASK_FILE = Path("data/coverage_masks.npy")
LOG_FILE = Path("data/maintenance_log.csv")
PATTERN_PLOT = Path("output/coverage_patterns.png")

def random_rectangular_pattern(rng, rectangle_count):
    mask = np.zeros((GRID_SIZE, GRID_SIZE), dtype=float)

    for _ in range(rectangle_count):
        x0 = int(rng.integers(0, GRID_SIZE - 1))
        y0 = int(rng.integers(0, GRID_SIZE - 1))
        width = int(rng.integers(2, 5))
        height = int(rng.integers(2, 5))

        x1 = min(x0 + width, GRID_SIZE)
        y1 = min(y0 + height, GRID_SIZE)

        mask[y0:y1, x0:x1] = 1.0

    return mask

def generate_default_config():
    rng = np.random.default_rng(RANDOM_SEED)

    patterns = {
        "A": random_rectangular_pattern(rng, 3),
        "B": random_rectangular_pattern(rng, 4),
        "C": random_rectangular_pattern(rng, 2),
    }

    config = {
        "grid_size": GRID_SIZE,

        "sun_protection_efficiency": 1.0,
        "moisture_protection_efficiency": 1.0,

        "patterns": {
            key: value.tolist()
            for key, value in patterns.items()
        },

        "maintenance": [
            {
                "day": 0,
                "active": True,
                "pattern": "A",
                "action": "install",
                "note": "Install pattern A",
            },
            {
                "day": 9,
                "active": False,
                "pattern": None,
                "action": "remove",
                "note": "Remove shading",
            },
            {
                "day": 13,
                "active": True,
                "pattern": "B",
                "action": "install",
                "note": "Install pattern B",
            },
            {
                "day": 21,
                "active": True,
                "pattern": "C",
                "action": "replace",
                "note": "Replace B with pattern C",
            },
            {
                "day": 27,
                "active": False,
                "pattern": None,
                "action": "remove",
                "note": "Remove shading",
            },
        ],
    }

    CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)

    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2)

    return config

def load_or_create_config():
    if not CONFIG_FILE.exists():
        return generate_default_config()

    with open(CONFIG_FILE, "r", encoding="utf-8") as f:
        return json.load(f)

def build_daily_masks(config):
    patterns = {
        name: np.asarray(values, dtype=float)
        for name, values in config["patterns"].items()
    }

    events = sorted(
        config["maintenance"],
        key=lambda event: int(event["day"]),
    )

    masks = np.zeros(
        (SIMULATION_DAYS + 1, GRID_SIZE, GRID_SIZE),
        dtype=float,
    )

    active = False
    active_pattern = None
    event_index = 0
    log_rows = []

    for day in range(SIMULATION_DAYS + 1):
        while (
            event_index < len(events)
            and int(events[event_index]["day"]) == day
        ):
            event = events[event_index]

            active = bool(event["active"])
            active_pattern = event["pattern"]

            log_rows.append({
                "day": day,
                "active": active,
                "pattern": active_pattern,
                "action": event["action"],
                "note": event["note"],
            })

            event_index += 1

        if active and active_pattern is not None:
            masks[day] = patterns[active_pattern]

    return masks, pd.DataFrame(log_rows), patterns

def save_pattern_plot(patterns):
    names = list(patterns.keys())

    fig, axes = plt.subplots(
        1,
        len(names),
        figsize=(4 * len(names), 4),
        squeeze=False,
    )

    axes = axes[0]

    for ax, name in zip(axes, names):
        ax.imshow(
            patterns[name],
            vmin=0,
            vmax=1,
            interpolation="nearest",
        )
        ax.set_title(f"Pattern {name}")
        ax.set_xticks(range(GRID_SIZE))
        ax.set_yticks(range(GRID_SIZE))
        ax.grid(alpha=0.2)

    fig.tight_layout()

    PATTERN_PLOT.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(PATTERN_PLOT, dpi=180, bbox_inches="tight")
    plt.close(fig)

def main():
    config = load_or_create_config()
    masks, log, patterns = build_daily_masks(config)

    MASK_FILE.parent.mkdir(parents=True, exist_ok=True)
    np.save(MASK_FILE, masks)
    log.to_csv(LOG_FILE, index=False)

    save_pattern_plot(patterns)

    print("Coverage masks shape:", masks.shape)
    print(f"Saved {CONFIG_FILE.resolve()}")
    print(f"Saved {LOG_FILE.resolve()}")
    print(f"Saved {PATTERN_PLOT.resolve()}")

if __name__ == "__main__":
    main()
