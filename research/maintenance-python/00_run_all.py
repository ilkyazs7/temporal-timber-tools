"""
00_run_all.py

Run the complete Temporal Timber shading + maintenance pipeline:

    python 00_run_all.py
"""

from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parent

SCRIPTS = [
    "01_weather.py",
    "02_moisture.py",
    "03_uv.py",
    "04_interventions.py",
    "05_apply_exposure.py",
    "06_rgb.py",
    "07_animation.py",
]

def main():
    required = [ROOT / "t-01.png", ROOT / "t-02.png"]
    missing = [p.name for p in required if not p.exists()]

    if missing:
        print("Missing:", ", ".join(missing))
        print("Place t-01.png and t-02.png beside 00_run_all.py.")
        sys.exit(1)

    (ROOT / "data").mkdir(exist_ok=True)
    (ROOT / "output").mkdir(exist_ok=True)
    (ROOT / "output" / "frames").mkdir(parents=True, exist_ok=True)

    for script in SCRIPTS:
        print("\n" + "=" * 72)
        print("RUNNING", script)
        print("=" * 72)

        result = subprocess.run(
            [sys.executable, str(ROOT / script)],
            cwd=ROOT,
        )

        if result.returncode != 0:
            print(f"\n{script} failed. Pipeline stopped.")
            sys.exit(result.returncode)

    print("\nDONE")
    print("Final GIF:")
    print("  output/timber_prediction_with_maintenance.gif")
    print("Intervention geometry:")
    print("  data/intervention_config.json")
    print("Maintenance log:")
    print("  data/maintenance_log.csv")

if __name__ == "__main__":
    main()
