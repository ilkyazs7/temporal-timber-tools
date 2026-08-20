"""
07_animation.py

Animate the original 10x10 analytical plot with shading + maintenance.

Each cell:
    RGB background = local predicted RGB history
    green line     = local cumulative moisture exposure
    purple line    = local cumulative UV exposure

A thicker border means the cell is currently covered.

The horizontal axis stays fixed:
    t0 -> t1 divided into 30 daily positions.

Output:
    output/timber_prediction_with_maintenance.gif
"""

from pathlib import Path

from PIL import Image
import matplotlib.pyplot as plt
import numpy as np

GRID_SIZE = 10
SIMULATION_DAYS = 30

RGB_FILE = Path("data/rgb_states.npy")
UV_FILE = Path("data/effective_uv_cumulative.npy")
MOISTURE_FILE = Path("data/effective_moisture_cumulative.npy")
COVERAGE_FILE = Path("data/coverage_masks.npy")

FRAME_DIR = Path("output/frames")
GIF_FILE = Path("output/timber_prediction_with_maintenance.gif")

MOISTURE_COLOR = "#006d5b"
UV_COLOR = "#6f2dbd"

def make_rgb_background(cell_states, current_day):
    background = np.ones(
        (1, SIMULATION_DAYS + 1, 3),
        dtype=float,
    ) * 0.94

    background[0, :current_day + 1, :] = (
        cell_states[:current_day + 1] / 255.0
    )

    return np.repeat(background, 30, axis=0)

def draw_frame(
    day,
    rgb_states,
    uv,
    moisture,
    coverage,
    output_file,
):
    all_x = np.arange(SIMULATION_DAYS + 1) / SIMULATION_DAYS
    current_x = all_x[:day + 1]

    uv_max = max(float(uv.max()), 1.0)
    moisture_max = max(float(moisture.max()), 1.0)

    fig, axes = plt.subplots(
        GRID_SIZE,
        GRID_SIZE,
        figsize=(18, 18),
        squeeze=False,
    )

    for row in range(GRID_SIZE):
        for col in range(GRID_SIZE):
            ax = axes[row, col]
            ax.set_box_aspect(1)

            local_rgb_states = rgb_states[:, row, col, :]

            ax.imshow(
                make_rgb_background(
                    local_rgb_states,
                    day,
                ),
                aspect="auto",
                extent=(0, 1, 0, 1),
                interpolation="nearest",
                alpha=0.62,
                zorder=0,
            )

            local_uv = uv[:day + 1, row, col]
            local_moisture = moisture[:day + 1, row, col]

            ax.plot(
                current_x,
                local_moisture / moisture_max,
                color=MOISTURE_COLOR,
                linewidth=2,
                zorder=3,
            )

            ax.plot(
                current_x,
                local_uv / uv_max,
                color=UV_COLOR,
                linewidth=2,
                zorder=3,
            )

            ax.scatter(
                [current_x[-1]],
                [local_moisture[-1] / moisture_max],
                color=MOISTURE_COLOR,
                edgecolor="white",
                s=14,
                zorder=4,
            )

            ax.scatter(
                [current_x[-1]],
                [local_uv[-1] / uv_max],
                color=UV_COLOR,
                edgecolor="white",
                s=14,
                zorder=4,
            )

            if coverage[day, row, col] > 0:
                for spine in ax.spines.values():
                    spine.set_linewidth(2.5)
                    spine.set_alpha(1.0)
            else:
                for spine in ax.spines.values():
                    spine.set_linewidth(0.8)
                    spine.set_alpha(0.4)

            for step in range(1, SIMULATION_DAYS):
                ax.axvline(
                    step / SIMULATION_DAYS,
                    linewidth=0.18,
                    alpha=0.10,
                    zorder=1,
                )

            ax.set_xlim(0, 1)
            ax.set_ylim(0, 1)
            ax.set_xticks(
                [0, 1],
                ["t0", "t1"],
                fontsize=5,
            )
            ax.set_yticks([])
            ax.set_title(
                f"({col},{row})",
                fontsize=6,
                pad=2,
            )

    covered_cells = int(
        np.count_nonzero(coverage[day] > 0)
    )

    fig.suptitle(
        (
            f"Day {day}/30 — "
            "RGB background | moisture (green) | UV (purple)\n"
            f"Covered cells today: {covered_cells}/100"
        ),
        fontsize=15,
        y=0.995,
    )

    fig.supxlabel(
        "t0 → t1 divided into 30 daily steps",
        fontsize=12,
    )
    fig.supylabel(
        "Grid y position",
        fontsize=12,
    )

    fig.subplots_adjust(
        left=0.04,
        right=0.995,
        bottom=0.04,
        top=0.955,
        wspace=0.08,
        hspace=0.18,
    )

    output_file.parent.mkdir(parents=True, exist_ok=True)

    fig.savefig(
        output_file,
        dpi=120,
        bbox_inches="tight",
    )

    plt.close(fig)

def main():
    rgb = np.load(RGB_FILE)
    uv = np.load(UV_FILE)
    moisture = np.load(MOISTURE_FILE)
    coverage = np.load(COVERAGE_FILE)

    FRAME_DIR.mkdir(parents=True, exist_ok=True)

    for old in FRAME_DIR.glob("frame_*.png"):
        old.unlink()

    paths = []

    for day in range(SIMULATION_DAYS + 1):
        path = FRAME_DIR / f"frame_{day:03d}.png"

        print(f"Rendering {day}/30")

        draw_frame(
            day,
            rgb,
            uv,
            moisture,
            coverage,
            path,
        )

        paths.append(path)

    images = [
        Image.open(path).convert("RGB")
        for path in paths
    ]

    images[0].save(
        GIF_FILE,
        save_all=True,
        append_images=images[1:],
        duration=250,
        loop=0,
        optimize=False,
    )

    for image in images:
        image.close()

    print(f"Saved GIF to {GIF_FILE.resolve()}")

if __name__ == "__main__":
    main()
