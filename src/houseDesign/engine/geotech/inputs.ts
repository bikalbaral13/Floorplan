// Geotechnical Analysis — inputs. A building is to be founded on a sloping
// site: site conditions (area, ground slope, slope height, set-back of the
// building from the crest, groundwater, seismicity), a layered soil profile
// from a borehole, the building loads and the proposed foundation.
// Defaults: a 5-storey RC building on a hillside plot at the northern fringe
// of the Kathmandu Valley (illustrative soil data, not a site investigation).

export interface Layer {
  id: string;
  name: string;
  uscs: string;
  thick: number; // m
  gamma: number; // kN/m³ above water table
  gammaSat: number; // kN/m³ below
  c: number; // kPa effective cohesion c'
  phi: number; // ° effective friction angle φ'
  cu: number; // kPa undrained shear strength (0 = drained material)
  E: number; // MPa drained Young's modulus
  nu: number;
  Cc: number; // compression index (0 = not compressible)
  Cr: number; // recompression index
  e0: number;
  OCR: number;
  cv: number; // m²/year
  N: number; // SPT N60 (field)
  FC: number; // % fines
}

export interface GeoInputs {
  project: { title: string; name: string; client: string; location: string; consultant: string; engineer: string; date: string };
  site: {
    area: number; // m² plot area
    beta: number; // ° slope angle of the hillside below the building
    H: number; // m slope height (crest above toe)
    setback: number; // m from crest to the near edge of the building
    gwt: number; // m depth of groundwater below ground surface
    pga: number; // g peak ground acceleration
    Mw: number; // design earthquake magnitude
    khFactor: number; // kh = factor × PGA for pseudo-static slope analysis
  };
  building: {
    storeys: number;
    Bb: number; // m footprint width (perpendicular to slope)
    Lb: number; // m footprint length
    floorLoad: number; // kPa per floor (DL + LL, service)
  };
  footing: {
    B: number; // m
    L: number; // m
    Df: number; // m
    P: number; // kN service column load
  };
  raft: { Df: number };
  criteria: {
    FSbearing: number;
    sAllowIsolated: number; // mm
    sAllowRaft: number; // mm
    FSslope: number;
    FSslopeSeismic: number;
    FSliq: number;
    method: "IS" | "Vesic" | "Hansen" | "Meyerhof" | "Terzaghi";
  };
  layers: Layer[];
}

const L = (id: string, name: string, uscs: string, thick: number, gamma: number, gammaSat: number, c: number, phi: number, cu: number, E: number, nu: number, Cc: number, Cr: number, e0: number, OCR: number, cv: number, N: number, FC: number): Layer =>
  ({ id, name, uscs, thick, gamma, gammaSat, c, phi, cu, E, nu, Cc, Cr, e0, OCR, cv, N, FC });

export const GEO_DEFAULTS: GeoInputs = {
  project: {
    title: "Geotechnical Investigation and Foundation Design Report",
    name: "Proposed 5-Storey Residential Building",
    client: "Private Owner",
    location: "Budhanilkantha, Kathmandu Valley, Nepal",
    consultant: "Hydropower Studio",
    engineer: "",
    date: "",
  },
  site: { area: 850, beta: 25, H: 12, setback: 6, gwt: 3.0, pga: 0.3, Mw: 7.8, khFactor: 0.5 },
  building: { storeys: 5, Bb: 12, Lb: 15, floorLoad: 12 },
  footing: { B: 2.5, L: 2.5, Df: 1.5, P: 900 },
  raft: { Df: 1.5 },
  criteria: { FSbearing: 3, sAllowIsolated: 50, sAllowRaft: 75, FSslope: 1.5, FSslopeSeismic: 1.1, FSliq: 1.2, method: "IS" },
  layers: [
    L("L1", "Fill / brown silty topsoil", "ML", 1.2, 17, 18, 5, 26, 0, 8, 0.3, 0, 0, 0, 1, 0, 5, 55),
    L("L2", "Stiff grey silty clay", "CL", 4.8, 18.5, 19, 10, 24, 75, 12, 0.35, 0.22, 0.03, 0.8, 2.0, 3, 9, 85),
    L("L3", "Medium dense silty sand", "SM", 6.0, 18.5, 19.5, 0, 33, 0, 35, 0.3, 0, 0, 0, 1, 0, 24, 18),
    L("L4", "Dense sandy gravel", "GW", 4.0, 20, 21, 0, 38, 0, 80, 0.28, 0, 0, 0, 1, 0, 40, 5),
    L("L5", "Weathered phyllite / residual soil", "Rw", 6.0, 21, 22, 25, 36, 0, 200, 0.25, 0, 0, 0, 1, 0, 60, 10),
  ],
};

export function mergeGeo(p: Partial<GeoInputs> | undefined): GeoInputs {
  const d = structuredClone(GEO_DEFAULTS);
  if (!p) return d;
  for (const k of ["project", "site", "building", "footing", "raft", "criteria"] as const) if (p[k]) (d as unknown as Record<string, object>)[k] = { ...(d[k] as object), ...(p[k] as object) };
  if (Array.isArray(p.layers) && p.layers.length) d.layers = p.layers;
  return d;
}
