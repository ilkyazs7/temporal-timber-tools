# Maintenance web prototype

Copy these files into:

docs/tools/maintenance/

Expected structure:

docs/
  tools/
    maintenance/
      index.html
      style.css
      app.js
      assets/
        t-01.png
        t-02.png

The two calibration images are optional at page load because the UI also lets
you choose them manually. For the published version, putting them in assets/
makes the model load them automatically.

## Current flow

1. Search location.
2. Choose 1 / 3 / 6 / 12 month horizon.
3. Fetch same calendar period from the previous year using Open-Meteo.
4. Convert hourly UV into accumulated UVI·h.
5. Convert temperature + RH to timber EMC and cumulative moisture-exposure %·h.
6. Read t-01 and t-02 as 10×10 average RGB fields.
7. Draw/save 10×10 coverage patterns.
8. Add timestamped maintenance events:
   - Add pattern
   - Remove pattern
   - Replace pattern
9. Apply coverage locally to future UV/moisture increments.
10. Predict local RGB using the existing empirical calibration logic.

## Current constants

STARTING_TIMBER_MC = 14.0
CALIBRATION_UV_DOSE = 120.0
WEATHERING_RATE_SCALE = 0.55
SUN_PROTECTION_EFFICIENCY = 1.0
MOISTURE_PROTECTION_EFFICIENCY = 1.0

These are near the top of app.js.

## Scientific note

Moisture exposure is spatially suppressed by coverage and tracked through time,
but it is not yet used as an independent RGB coefficient. With the present
two-image calibration, UV and moisture effects cannot be separately identified.
