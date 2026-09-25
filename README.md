# kansas-soil-props
A dataset of soil physical properties for the Kansas Mesonet

## Corrected summary workbook

`kansas_mesonet_soil_database_summary_2026.xlsx` is the 2025 summary with QA/QC corrections
applied. It adds Rosetta van Genuchten parameters, water contents of the air-dry and oven-dry
thermal states, Ksat notes, and a `heat_pulse_timeseries` tab with all 1,448 linked KD2 Pro
records. The `qaqc_log` tab lists issues relevant to data use: flagged values (kept unchanged)
and the measured values corrected from the 2025 summary. Rebuild it with:

```
python scripts/build_summary_xlsx.py
```

## Dashboard

`docs/` is a dependency-free (plain HTML, CSS, JS) explorer for the data, published with
GitHub Pages. It can also be opened locally from `docs/index.html` with no server or internet
connection.

Scatter, Histogram and Texture triangle show one row per core. Thermal properties are available
there as per-state variables (e.g. λ saturated, λ 33 kPa).

- **Scatter**: any two variables on a square plot, with log axes, a least-squares fit
  (n, r, R², equation), a table view and CSV export. Points can be colored by texture group,
  depth, any numeric variable, or the **measured soil color** (CIELAB converted to sRGB).
  Click a point to inspect the core.
- **Histogram**: any variable, adjustable bins, log scale, optional small multiples by depth.
- **Texture triangle**: USDA triangle with the same coloring options.
- **Heat pulse**: for one core, the raw KD2 Pro SH-1 ΔT curves for every water state (peaks
  marked, optional ideal line-source model), next to λ, C or D vs water content for that core
  against all other cores. The C panel includes the de Vries mixing line
  C = ρb·cs + θ·Cw (cs = 0.75 MJ Mg⁻¹ K⁻¹).

The URL hash stores the current view, so a specific plot can be bookmarked or shared.

### Rebuilding the data

The data are built in two steps. The first builds the corrected workbook from the 2025 summary,
the raw KD2 Pro export, the Rosetta parameters and the full lab database. The second builds
`docs/data/soil_data.js` from the corrected workbook only. It also copies the workbook into
`docs/data/` for the dashboard's "Download data" link, so the `docs/` folder can be hosted on
its own:

```
python scripts/build_summary_xlsx.py
python scripts/build_data.py
```

Requires pandas, numpy, openpyxl and xlrd.

### How raw heat-pulse curves are linked to cores

The 2025 summary records λ, C and D for each core and water state but not which KD2 Pro record
they came from. `build_summary_xlsx.py` matches each (λ, C, D) triplet against the raw export:

- 1,424 of 1,448 measurements match exactly one raw record. Two cores that share an identical
  triplet are separated by the probe start temperature.
- 24 measurements differ from their raw record by a single transcription typo (e.g. 0.652 vs
  0.642). They are linked when 3 of 4 fields (λ, C, D, start temperature) agree, corrected to
  the raw value in the 2026 workbook, and marked "typo corrected" in the dashboard. The same
  values appear in the full lab database, so the typos date from data entry.
- The remaining 1,425 raw records belong to other projects or verification runs and are not used.

All linked records use a 2-min read time: 60 readings at 2 s intervals, heater on for the first
60 s. Some raw timestamps fall in 2056 or 2062 because the KD2 Pro clock was not set. Those
timestamps are dropped.

### Water retention curves

The retention curve in the core panel uses van Genuchten (1980) parameters (m = 1 − 1/n) from
Rosetta in `swrc_vg_parameters.xlsx`. There is one set per station and depth, estimated from
the core with particle-size data (sand, clay, BD, θ33 and θ1500; model 5). The three Richfield
depths without retention data use texture and BD only (model 2). Duplicate cores at a depth are
treated as comparable, so both cores share the curve; the panel plots the selected core's own
measured points and their RMSE against the curve. Rosetta reports α in cm⁻¹; the build script
converts it to kPa⁻¹ (1 kPa = 10.197 cm H₂O). The parameters are also available as variables in
the Scatter and Histogram views.

`kansas_mesonet_complete_soil_database.xlsx` (the full lab database) is not used by the
dashboard. The bulk density, porosity, retention, Ksat, texture and thermal values in the summary
match it exactly for every core.

### Data notes

- Particle size and soil color were measured on one core of each pair, and chemistry on the
  other. The build script shares these values with the paired core at the same station and depth.
- At 5 and 10 kPa (39 cores; Elmdale 1SE, Hays, Jewell, Parsons, Rossville 2SE, Sedan), heat
  capacity is often well below the saturated and 33 kPa values at nearly the same θ. Solving
  C = ρb·cs + θ·Cw for cs gives ≈0.1 MJ Mg⁻¹ K⁻¹ for these states, versus ≈0.6 for the
  saturated, 33 and 70 kPa states.
- One Lorraine row has a time (12:57:36) in its `sampling_date` cell. The station's date from its
  other rows is used instead.
