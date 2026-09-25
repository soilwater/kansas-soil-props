"""Build a single, corrected summary workbook of the Kansas Mesonet soil database.

Run from the repository root:
    python scripts/build_summary_xlsx.py

Starts from kansas_mesonet_soil_database_summary_2025.xlsx, applies the QA/QC corrections,
adds Rosetta van Genuchten parameters, water contents of the air-dry and oven-dry thermal
states and Ksat notes from the full lab database, and a tab with every linked 2-minute KD2 Pro
heat-pulse time series. The qaqc_log tab lists flagged values and corrected measured values;
housekeeping (formatting, renamed columns, filled start temperatures) is not listed.
"""

import re
from datetime import time
from pathlib import Path

import numpy as np
import pandas as pd
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / 'KD2 Pro All Raw Data.xls'
SUMMARY = ROOT / 'kansas_mesonet_soil_database_summary_2025.xlsx'
FULL = ROOT / 'kansas_mesonet_complete_soil_database.xlsx'
ROSETTA = ROOT / 'swrc_vg_parameters.xlsx'
OUT = ROOT / 'kansas_mesonet_soil_database_summary_2026.xlsx'

KEY = ['station_name', 'ring_number']
IDS = ['station_name', 'county', 'latitude', 'longitude', 'ring_number', 'core_number',
       'top_depth', 'bottom_depth', 'nominal_depth']
SUFFIX = {'sat': 'sat', '5kPa': '5kPa', '10kPa': '10kPa', '33kPa': '33kPa', '70kPa': '70kPa',
          'ad2': 'air_dry_2day', 'ad3': 'air_dry_3day', 'od40': 'ovendry_40'}
C_WATER = 4.18      # MJ m-3 K-1
CS_MINERAL = 0.75   # MJ Mg-1 K-1, typical specific heat of soil minerals
C_RATIO_FLOOR = 0.6 # flag C more than 40% below the de Vries estimate (5th percentile at saturation is 0.75)

# Water states at which thermal properties were measured, wettest to driest.
# (id, label, moisture class used by the dashboard, water content column in hydraulic_properties)
STATES = [
    ('sat',   'Saturated',        'Saturated', 'vwc_sat'),
    ('5kPa',  '5 kPa',            '5–33 kPa',  'vwc_5kPa'),
    ('10kPa', '10 kPa',           '5–33 kPa',  'vwc_10kPa'),
    ('33kPa', '33 kPa',           '5–33 kPa',  'vwc_33kPa'),
    ('70kPa', '70 kPa',           '70 kPa',    'vwc_70kPa'),
    ('ad2',   'Air-dry (2 days)', 'Air-dry',   None),
    ('ad3',   'Air-dry (3 days)', 'Air-dry',   None),
    ('od40',  'Oven-dry (40 °C)', 'Oven-dry',  None),
]

log = []


# ---------------------------------------------------------------------------
# Raw KD2 Pro export
# ---------------------------------------------------------------------------
def load_raw():
    # The KD2 Pro export has a broken sheet-dimension record (reports 0 x 0), so
    # pandas returns an empty frame. Read the cell rows through xlrd directly.
    import xlrd
    sheet = xlrd.open_workbook(RAW, ignore_workbook_corruption=True).sheet_by_index(0)
    rows = [r for r in sheet._cell_values[2:] if r and r[0] not in ('', None)]
    R = pd.DataFrame(rows)
    temps = R.iloc[:, 13:73].to_numpy(float)
    return pd.DataFrame({
        'serial': R[0].astype(float), 'k': R[2].astype(float), 'c': R[4].astype(float),
        'd': R[5].astype(float), 'err': R[6].astype(float), 't0': R[7].astype(float),
        'read_time': R[9], 'power': R[11].astype(float),
    }), temps


def match(k, c, d, t, raw, used):
    """Link a summary (λ, C, D, start temperature) to a raw record.

    Returns (raw row index, 'exact'|'near') or (None, None). 'near' means one of λ, C, D differs
    (a transcription typo) while the other three of the four fields agree.
    """
    eq = lambda a, b: np.isclose(a, b, atol=5e-4)
    hits = eq(raw.k, k).astype(int) + eq(raw.c, c) + eq(raw.d, d)
    exact = np.flatnonzero(hits == 3)
    if len(exact) > 1 and not np.isnan(t):
        exact = exact[np.isclose(raw.t0.to_numpy()[exact], t, atol=5e-3)]
    exact = [i for i in exact if i not in used]
    if len(exact) == 1:
        return exact[0], 'exact'
    if np.isnan(t):
        return None, None
    score = hits + np.isclose(raw.t0, t, atol=5e-3)
    near = [i for i in np.flatnonzero(score >= 3) if i not in used]
    if len(near) == 1:
        return near[0], 'near'
    return None, None


def excel_date(serial):
    ts = pd.Timestamp('1899-12-30') + pd.to_timedelta(serial, unit='D')
    # The KD2 Pro clock was not set for some sessions (years 2056, 2062); drop those timestamps.
    return ts.strftime('%Y-%m-%d %H:%M') if 2015 <= ts.year <= 2025 else None


def note(sheet, row, column, old, new, check, action):
    log.append({'sheet': sheet, 'station_name': row['station_name'], 'ring_number': row['ring_number'],
                'core_number': row.get('core_number'), 'nominal_depth': row.get('nominal_depth'),
                'column': column, 'original_value': old, 'corrected_value': new,
                'check': check, 'action': action})


def num(s):
    return pd.to_numeric(s, errors='coerce')


def fix_text_numbers(df, sheet, cols, ids):
    """Numeric columns holding text placeholders (' ', 'NAN') become empty cells."""
    for c in cols:
        bad = df[c].notna() & num(df[c]).isna()
        for i in df.index[bad]:
            note(sheet, ids.loc[i], c, repr(df.at[i, c]), '', 'Data type', 'Text placeholder in a numeric column; set to empty')
        df[c] = num(df[c])


# ---------------------------------------------------------------------------
# Load and clean the summary sheets
# ---------------------------------------------------------------------------
def load_sheets():
    x = pd.ExcelFile(SUMMARY)
    meta = {s: x.parse(s, header=None) for s in ['description', 'references', 'metadata and units']}
    G, H, T = (x.parse(s) for s in ['general_properties', 'hydraulic_properties', 'thermal_properties'])
    for d in (G, H, T):
        d.columns = d.columns.str.strip()
    H = H.dropna(subset=['station_name']).reset_index(drop=True)   # trailing empty row
    for d in (G, H, T):
        d['ring_number'] = d['ring_number'].astype(int)
    ids = G.set_index('ring_number', drop=False)[IDS]
    return meta, G, H, T, ids


def clean_general(G):
    # Lorraine ring 75: sampling_date holds a time; the full database's second date column has 2018-07-23
    for i in G.index[~G['sampling_date'].map(lambda v: hasattr(v, 'year'))]:
        F = pd.read_excel(FULL, 'data')
        good = F.loc[(num(F['ring_number']) == G.at[i, 'ring_number']) & (F['station_name'] == G.at[i, 'station_name']), 'sampling_date.1'].iloc[0]
        note('general_properties', G.loc[i], 'sampling_date', str(G.at[i, 'sampling_date']), str(pd.Timestamp(good).date()),
             'Data type', 'Time stored in the date column; date taken from the full database (sampling_date.1) and matches the other Lorraine rows')
        G.at[i, 'sampling_date'] = good
    G['sampling_date'] = pd.to_datetime(G['sampling_date']).dt.date
    # time stored as a fraction of a day
    def to_time(v):
        if not isinstance(v, float) or np.isnan(v):
            return v
        minutes = int(round(v * 1440))
        return time(minutes // 60 % 24, minutes % 60)
    G['time'] = G['time'].map(to_time)
    G = G.rename(columns={'time': 'sampling_time', 'K': 'K_ppm', 'pHBuf': 'pH_buffer'})
    for i in G.index[G['textural_class'] != G['textural_class'].str.strip()]:
        note('general_properties', G.loc[i], 'textural_class', repr(G.at[i, 'textural_class']), G.at[i, 'textural_class'].strip(),
             'Text format', 'Trailing space removed (created a duplicate class)')
    G['textural_class'] = G['textural_class'].str.strip()
    fix_text_numbers(G, 'general_properties', ['bulk_density', 'particle_density', 'porosity'], G)
    return G


def clean_hydraulic(H, rosetta, full):
    fix_text_numbers(H, 'hydraulic_properties', ['vwc_1500kPa', 'Ksat_cm_per_hr'], H)
    H = H.rename(columns={'K_sat_water_temp': 'Ksat_water_temp'})
    # Ksat notes from the full database, with spelling and spacing tidied
    fixes = {'casuing': 'causing', 'wih': 'with', 'cdetermined': 'determined', 'shrink_swell': 'shrink-swell'}
    def tidy(s):
        if not isinstance(s, str):
            return None
        s = re.sub(r'\s+', ' ', s).strip()
        for a, b in fixes.items():
            s = re.sub(rf'\b{a}\b', b, s)
        return s
    H = H.merge(full[KEY + ['Observations']], on=KEY, how='left').rename(columns={'Observations': 'Ksat_notes'})
    H['Ksat_notes'] = H['Ksat_notes'].map(tidy)
    # Rosetta van Genuchten parameters (one set per station and depth, shared by both cores)
    R = rosetta.rename(columns={'site': 'station_name', 'depth': 'nominal_depth', 'theta_res': 'vg_theta_res',
                                'theta_sat': 'vg_theta_sat', 'alpha': 'vg_alpha_per_cm', 'n': 'vg_n',
                                'model': 'rosetta_model', 'k_sat': 'rosetta_Ksat_cm_per_day'})
    H = H.merge(R[['station_name', 'nominal_depth', 'vg_theta_res', 'vg_theta_sat', 'vg_alpha_per_cm', 'vg_n',
                   'rosetta_model', 'rosetta_Ksat_cm_per_day']], on=['station_name', 'nominal_depth'], how='left')
    return H


def flag_retention(H, G):
    M = H.merge(G[KEY + ['porosity']], on=KEY)
    for _, r in M.iterrows():
        if pd.notna(r.vwc_sat) and pd.notna(r.porosity) and r.vwc_sat > r.porosity + 0.02:
            note('hydraulic_properties', r, 'vwc_sat', round(r.vwc_sat, 4), '', 'θsat vs porosity',
                 f'Flagged, not changed: θsat exceeds porosity ({r.porosity:.3f}) by more than 0.02; likely swelling after wetting')


# ---------------------------------------------------------------------------
# Thermal properties: link to raw KD2 Pro records and correct transcription typos
# ---------------------------------------------------------------------------
def clean_thermal(T, H, G, full, raw, temps):
    T = T.drop(columns=['soil_ring_mass_air_dry_2day', 'soil_ring_mass_air_dry_3day', 'date_air_dry_3day'], errors='ignore')
    T.columns = [c.replace('diffussivity', 'diffusivity').replace('Kpa', 'kPa') for c in T.columns]
    # Water content at each thermal state: retention points, plus air-dry / oven-dry from the full database
    theta = H.merge(full[KEY + ['vwc_air_dry_2day', 'vwc_ovendry_40']], on=KEY, how='left').set_index(KEY)
    state_theta = {'ad2': 'vwc_air_dry_2day', 'od40': 'vwc_ovendry_40'}
    bd = G.set_index(KEY)['bulk_density']
    series, used = [], set()
    for i, r in T.iterrows():
        for sid, label, _, wcol in STATES:
            s = SUFFIX[sid]
            kc, cc, dc, tc = f'thermal_cond_{s}', f'heat_capacity_{s}', f'diffusivity_{s}', f'temp_{s}'
            k, c, d, t = (num(pd.Series([r.get(x)]))[0] for x in (kc, cc, dc, tc))
            if np.isnan(k):
                continue
            j, how = match(k, c, d, t, raw, used)
            if j is None:
                continue
            used.add(j)
            if how == 'near':
                for col, old, new in [(kc, k, raw.k[j]), (cc, c, raw.c[j]), (dc, d, raw.d[j])]:
                    if not np.isclose(old, new, atol=5e-4):
                        note('thermal_properties', r, col, old, new, 'Raw KD2 Pro record',
                             'Transcription typo; replaced with the raw instrument value (record matched on the other 3 of λ, C, D, start temperature)')
                        T.at[i, col] = new
            if np.isnan(t):
                note('thermal_properties', r, tc, '', raw.t0[j], 'Raw KD2 Pro record', 'Missing; filled with the start temperature of the linked raw record')
                T.at[i, tc] = raw.t0[j]
            # Physical plausibility of C against de Vries: C = ρb·cs + θ·Cw
            wcol = wcol or state_theta.get(sid)
            key = (r.station_name, r.ring_number)
            th = theta.at[key, wcol] if wcol else np.nan
            if pd.notna(th) and pd.notna(bd.get(key)):
                expected = bd[key] * CS_MINERAL + C_WATER * th
                ratio = T.at[i, cc] / expected
                if ratio < C_RATIO_FLOOR:
                    note('thermal_properties', r, cc, T.at[i, cc], '', 'Heat capacity vs de Vries',
                         f'Flagged, not changed: {100 * (1 - ratio):.0f}% below the de Vries estimate '
                         f'ρb·cs + θ·Cw = {expected:.2f} MJ m⁻³ K⁻¹ (θ = {th:.3f}, cs = {CS_MINERAL})')
            series.append({**{c: r[c] for c in IDS}, 'water_state': label, 'vwc': th, 'initial_temp': raw.t0[j],
                           'measurement_datetime': excel_date(raw.serial[j]), 'read_time_min': raw.read_time[j],
                           'heater_power_W_per_m': raw.power[j], 'thermal_cond': raw.k[j], 'heat_capacity': raw.c[j],
                           'diffusivity': raw.d[j], 'fit_error': raw.err[j], 'raw_link': how,
                           **{f'temp_{2 * n}s': temps[j][n] for n in range(60)}})
    # Water content of the air-dry and 40 °C oven-dry states, from the full database
    T = T.merge(full[KEY + ['vwc_air_dry_2day', 'vwc_ovendry_40']], on=KEY, how='left')
    order = IDS + [c for s in SUFFIX.values() for c in
                   ([f'vwc_{s}'] if s in ('air_dry_2day', 'ovendry_40') else [])
                   + [f'thermal_cond_{s}', f'heat_capacity_{s}', f'diffusivity_{s}', f'temp_{s}'] if c in T.columns]
    return T[order], pd.DataFrame(series)


# ---------------------------------------------------------------------------
# Workbook writing
# ---------------------------------------------------------------------------
UNITS = [
    (r'^(station_name|county)$', '', 'Kansas Mesonet station and county'),
    (r'^latitude$', '°N', 'Station latitude'), (r'^longitude$', '°E', 'Station longitude'),
    (r'^ring_number$', '', 'Unique core (ring) ID'), (r'^core_number$', '', 'Duplicate core at a depth (1 or 2)'),
    (r'^(top|bottom)_depth$', 'cm', 'Actual core depth recorded in the field'),
    (r'^nominal_depth$', 'cm', 'Nominal depth (sensor depth)'),
    (r'^sampling_date$', '', 'Sampling date'), (r'^sampling_time$', '', 'Sampling time'),
    (r'^(sand|silt|clay)$', '%', 'Particle size (hydrometer, USDA)'), (r'^textural_class$', '', 'USDA textural class'),
    (r'^(bulk|particle)_density$', 'g cm⁻³', 'Bulk density (dry mass / volume); particle density (pycnometer)'),
    (r'^porosity$', 'cm³ cm⁻³', '1 − bulk density / particle density'),
    (r'^[Lab]_(dry|wet)$', '', 'CIELAB color, Nix sensor; wet at 25% gravimetric water'),
    (r'^total_[NC]$', '%', 'LECO combustion'), (r'^OM$', '%', 'Organic matter, loss on ignition'),
    (r'^(Ca|Mg|Na|K_ppm)$', 'ppm', '1 M ammonium acetate extraction'), (r'^P$', 'ppm', 'Mehlich-3'),
    (r'^pH$', '', '1:1 soil:water'), (r'^pH_buffer$', '', 'SMP buffer pH'),
    (r'^vwc_field$', 'cm³ cm⁻³', 'Volumetric water content at sampling'),
    (r'^vwc_sat$', 'cm³ cm⁻³', 'Volumetric water content at saturation'),
    (r'^vwc_\d+kPa$', 'cm³ cm⁻³', 'Volumetric water content at the stated matric potential'),
    (r'^vwc_air_dry_2day$', 'cm³ cm⁻³', 'Water content after 2 days of air drying (full database)'),
    (r'^vwc_ovendry_40$', 'cm³ cm⁻³', 'Water content after oven drying at 40 °C, estimated from the mean 40–105 °C mass difference by texture (full database)'),
    (r'^vwc$', 'cm³ cm⁻³', 'Water content of the core at this water state (blank when not measured)'),
    (r'^Ksat_cm_per_hr$', 'cm h⁻¹', 'Saturated hydraulic conductivity, closed-path permeameter'),
    (r'^Ksat_method$', '', 'Constant or falling head'), (r'^Ksat_water_temp$', '°C', 'Water temperature during Ksat'),
    (r'^Ksat_notes$', '', 'Lab observations on the Ksat measurement (full database)'),
    (r'^vg_theta_(res|sat)$', 'cm³ cm⁻³', 'van Genuchten θr / θs from Rosetta (one set per station and depth)'),
    (r'^vg_alpha_per_cm$', 'cm⁻¹', 'van Genuchten α from Rosetta (multiply by 10.197 for kPa⁻¹)'),
    (r'^vg_n$', '', 'van Genuchten n from Rosetta (m = 1 − 1/n)'),
    (r'^rosetta_model$', '', 'Rosetta model: 5 = texture, BD, θ33, θ1500; 2 = texture and BD'),
    (r'^rosetta_Ksat_cm_per_day$', 'cm d⁻¹', 'Ksat estimated by Rosetta'),
    (r'^thermal_cond', 'W m⁻¹ K⁻¹', 'Thermal conductivity, KD2 Pro SH-1'),
    (r'^heat_capacity', 'MJ m⁻³ K⁻¹', 'Volumetric heat capacity, KD2 Pro SH-1'),
    (r'^diffusivity', 'mm² s⁻¹', 'Thermal diffusivity, KD2 Pro SH-1'),
    (r'^temp_(sat|\d+kPa|air|oven)', '°C', 'Soil temperature at the start of the heat-pulse reading (KD2 Pro Temp(0))'),
    (r'^water_state$', '', 'Water state of the core during the heat-pulse reading'),
    (r'^initial_temp$', '°C', 'Soil temperature at the start of the reading (KD2 Pro Temp(0))'),
    (r'^measurement_datetime$', '', 'KD2 Pro timestamp (blank where the instrument clock was not set)'),
    (r'^read_time_min$', 'min', 'KD2 Pro read time; 60 readings over this time, heater on for the first half'),
    (r'^heater_power_W_per_m$', 'W m⁻¹', 'Heater power per unit length'),
    (r'^fit_error$', '', 'KD2 Pro fit error'),
    (r'^raw_link$', '', 'exact: summary λ, C, D equal the raw record; near: summary had a one-digit typo, corrected'),
    (r'^temp_\d+s$', '°C', 'Temperature at the sensing needle (6 mm from the heater) at this time from the start of the reading'),
]


def describe(col):
    for pat, unit, desc in UNITS:
        if re.search(pat, col):
            return unit, desc
    return '', ''


FONT = Font(name='Arial', size=10)
HEAD = Font(name='Arial', size=10, bold=True)
FILL = PatternFill('solid', fgColor='DDE6F0')


def write_table(ws, df, widths=None, freeze='A2', number_formats=None):
    ws.append(list(df.columns))
    for row in df.itertuples(index=False):
        ws.append([None if (isinstance(v, float) and np.isnan(v)) or v is pd.NaT else v for v in row])
    for cell in ws[1]:
        cell.font, cell.fill = HEAD, FILL
        cell.alignment = Alignment(wrap_text=True, vertical='top')
    for row in ws.iter_rows(min_row=2):
        for cell in row:
            cell.font = FONT
    for j, col in enumerate(df.columns, 1):
        letter = get_column_letter(j)
        ws.column_dimensions[letter].width = (widths or {}).get(col, max(10, min(28, len(col) + 2)))
        fmt = (number_formats or {}).get(col)
        if fmt:
            for cell in ws[letter][1:]:
                cell.number_format = fmt
    ws.freeze_panes = freeze


def write_raw(ws, df):
    for row in df.itertuples(index=False):
        ws.append([None if isinstance(v, float) and np.isnan(v) else v for v in row])
    for row in ws.iter_rows():
        for cell in row:
            cell.font = FONT
            cell.alignment = Alignment(wrap_text=True, vertical='top')
    ws.column_dimensions['A'].width = 34
    for letter in 'BCD':
        ws.column_dimensions[letter].width = 60


def main():
    meta, G, H, T, ids = load_sheets()
    full = pd.read_excel(FULL, 'data')
    full.columns = full.columns.str.strip()
    full = full.dropna(subset=['station_name'])
    full['ring_number'] = num(full['ring_number']).astype(int)
    rosetta = pd.read_excel(ROSETTA)
    raw, temps = load_raw()

    G = clean_general(G)
    H = clean_hydraulic(H, rosetta, full)
    flag_retention(H, G)
    T, pulses = clean_thermal(T, H, G, full, raw, temps)

    log.append({'sheet': 'thermal_properties', 'column': 'heat_capacity_5kPa, heat_capacity_10kPa', 'check': 'Heat capacity vs de Vries',
                'action': 'Flagged, not changed: all 39 cores measured at 5 and 10 kPa (Elmdale 1SE, Hays, Jewell, Parsons, Rossville 2SE, Sedan) '
                          'have C about 30% below the de Vries estimate ρb·cs + θ·Cw (median ratio 0.70), versus 0.91–1.00 for the saturated, '
                          '33 kPa, 70 kPa and air-dry states across all cores. Use C and D at 5 and 10 kPa with caution.'})

    # Report only what matters for using the data: flagged values and changes to measured values.
    # Formatting fixes, renamed columns, filled start temperatures and similar housekeeping are not listed.
    L = pd.DataFrame(log, columns=['sheet', 'station_name', 'ring_number', 'core_number', 'nominal_depth', 'column',
                                   'original_value', 'corrected_value', 'check', 'action'])
    flagged = L['action'].str.startswith('Flagged')
    typo = L['action'].str.startswith('Transcription typo')
    L = L[flagged | typo].copy()
    L['type'] = np.where(L['action'].str.startswith('Flagged'), 'flagged', 'corrected')
    L['issue'] = L['action'].str.replace(r'^Flagged, not changed: ', '', regex=True).str.replace(
        r'^Transcription typo; replaced with the raw instrument value',
        'Transcription typo in the 2025 summary; replaced with the raw KD2 Pro value', regex=True)
    L['value'] = L['original_value']
    L = L.rename(columns={'check': 'evidence'})[
        ['type', 'station_name', 'ring_number', 'core_number', 'nominal_depth', 'sheet', 'column',
         'value', 'corrected_value', 'evidence', 'issue']]
    L.loc[L['type'] == 'flagged', 'corrected_value'] = None
    # Group-level flags (no station) lead their section
    L = L.sort_values(['type', 'evidence', 'station_name', 'ring_number'], ascending=[False, True, True, True],
                      na_position='first', kind='stable')

    variables = [(sheet, c, *describe(c)) for sheet, d in [('general_properties', G), ('hydraulic_properties', H),
                                                           ('thermal_properties', T), ('heat_pulse_timeseries', pulses)]
                 for c in d.columns if not re.match(r'temp_\d+s$', c) or c in ('temp_0s', 'temp_118s')]
    V = pd.DataFrame(variables, columns=['sheet', 'column', 'units', 'description'])
    V.loc[V['column'] == 'temp_0s', 'column'] = 'temp_0s … temp_118s'
    V = V[V['column'] != 'temp_118s']

    wb = Workbook()
    wb.remove(wb.active)
    # Citation and version go right below the header of the first tab
    refs = meta['references']
    citation = refs.loc[refs.apply(lambda r: r.astype(str).str.contains('Recommended citation').any(), axis=1), 0].iloc[0]
    desc = meta['description'].dropna(how='all').reset_index(drop=True)
    top = pd.DataFrame([['How to cite', citation],
                        ['Version', '2026 summary: QA/QC corrections applied (see qaqc_log), Rosetta van Genuchten '
                                    'parameters and heat-pulse time series added. Additional references in the references tab.']],
                       columns=desc.columns)
    desc = pd.concat([desc.iloc[:1], top, desc.iloc[1:]], ignore_index=True)
    ws = wb.create_sheet('description')
    write_raw(ws, desc)
    for cell in ws[1] + ws[2]:
        cell.font = HEAD
    write_raw(wb.create_sheet('references'), meta['references'])
    md = meta['metadata and units'].copy()
    for row in [
        ['van Genuchten parameters', 'Rosetta (model 5: sand, silt, clay, bulk density, θ33, θ1500; model 2 where retention was missing), '
         'one set per station and depth estimated from the core with particle-size data and assigned to both cores', 'θ: cm^3/cm^3; α: 1/cm', 'Soil water processes lab'],
        ['Heat-pulse time series', 'Raw KD2 Pro SH-1 records linked to each core and water state by matching λ, C, D and start temperature. '
         '60 readings at 2 s intervals (2-min read time); heater on for the first 60 s', '°C', 'Soil water processes lab'],
        ['QA/QC', 'The qaqc_log tab lists issues relevant to data use: values flagged as questionable (kept unchanged) and measured '
         'values corrected from the 2025 summary. Formatting fixes and renamed columns are not listed', None, None],
    ]:
        md.loc[len(md)] = row + [None] * (md.shape[1] - len(row))
    write_raw(wb.create_sheet('metadata and units'), md)
    write_table(wb.create_sheet('variables'), V, widths={'sheet': 22, 'column': 30, 'units': 12, 'description': 90})
    fmt3 = '0.000'
    write_table(wb.create_sheet('general_properties'), G, freeze='J2',
                number_formats={'sampling_date': 'yyyy-mm-dd', 'sampling_time': 'hh:mm', 'sand': '0.0', 'silt': '0.0', 'clay': '0.0',
                                'bulk_density': fmt3, 'particle_density': fmt3, 'porosity': fmt3})
    write_table(wb.create_sheet('hydraulic_properties'), H, freeze='J2', widths={'Ksat_notes': 50},
                number_formats={**{c: fmt3 for c in H.columns if c.startswith(('vwc', 'Ksat_cm', 'vg_theta'))}, 'vg_alpha_per_cm': '0.00000', 'vg_n': fmt3})
    write_table(wb.create_sheet('thermal_properties'), T, freeze='J2', number_formats={c: fmt3 for c in T.columns if c.startswith('vwc')})
    write_table(wb.create_sheet('heat_pulse_timeseries'), pulses, freeze='K2', widths={'water_state': 16, 'measurement_datetime': 18},
                number_formats={'vwc': fmt3})
    write_table(wb.create_sheet('qaqc_log'), L, freeze='A2',
                widths={'type': 10, 'station_name': 16, 'sheet': 20, 'column': 26, 'value': 10, 'corrected_value': 10,
                        'evidence': 24, 'issue': 100})
    wb.save(OUT)
    print(f'Wrote {OUT.name}: {len(G)} cores, {len(pulses)} heat-pulse series')
    print(L.groupby(['type', 'check']).size().to_string())


if __name__ == '__main__':
    import sys
    sys.stdout.reconfigure(encoding='utf-8')
    main()
