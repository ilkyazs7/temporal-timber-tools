"""
06_rgb.py

Predict RGB with CELL-SPECIFIC effective UV exposure.

Covered cells receive less/no UV and therefore change less/no further
while the cover is active.

Moisture is protected and tracked separately, but is not yet used as
an RGB coefficient because the current two-image calibration does not
separate UV response from moisture response.

Output:
    data/rgb_states.npy
"""

from pathlib import Path

from PIL import Image
import numpy as np

IMAGE_T0 = "t-01.png"
IMAGE_T1 = "t-02.png"

GRID_SIZE = 10

# Replace with real accumulated UVI·h between calibration images.
CALIBRATION_UV_DOSE = 120.0

EFFECTIVE_UV_FILE = Path("data/effective_uv_cumulative.npy")
RGB_OUTPUT = Path("data/rgb_states.npy")

def image_to_grid(image_path, grid_size=10):
    img = np.asarray(
        Image.open(image_path).convert("RGB"),
        dtype=float,
    )

    height, width, _ = img.shape
    grid = np.zeros((grid_size, grid_size, 3), dtype=float)

    for row in range(grid_size):
        for col in range(grid_size):
            y0 = int(row * height / grid_size)
            y1 = int((row + 1) * height / grid_size)
            x0 = int(col * width / grid_size)
            x1 = int((col + 1) * width / grid_size)

            grid[row, col] = (
                img[y0:y1, x0:x1]
                .mean(axis=(0, 1))
            )

    return grid

def main():
    if CALIBRATION_UV_DOSE <= 0:
        raise ValueError("CALIBRATION_UV_DOSE must be > 0.")

    calibration_t0 = image_to_grid(IMAGE_T0, GRID_SIZE)
    calibration_t1 = image_to_grid(IMAGE_T1, GRID_SIZE)

    observed_rgb_change = (
        calibration_t1
        - calibration_t0
    )

    rgb_change_per_uv = (
        observed_rgb_change
        / CALIBRATION_UV_DOSE
    )

    # Prediction begins from current/later image.
    rgb_today = calibration_t1.copy()

    effective_uv = np.load(EFFECTIVE_UV_FILE)

    states = []

    for day in range(effective_uv.shape[0]):
        local_uv = effective_uv[day][..., None]

        predicted = (
            rgb_today
            + rgb_change_per_uv * local_uv
        )

        states.append(
            np.clip(predicted, 0, 255)
        )

    states = np.asarray(states)

    RGB_OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    np.save(RGB_OUTPUT, states)

    print("RGB states shape:", states.shape)

if __name__ == "__main__":
    main()
