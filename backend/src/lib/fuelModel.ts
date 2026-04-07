/**
 * Fuel Efficiency Model — Layers 2 & 3
 *
 * Layer 2 — Admiralty Coefficient
 *   The Admiralty Coefficient (C_adm) is a hull-specific constant that relates
 *   displacement, speed, and shaft power at any operating condition:
 *
 *     C_adm = Δ^(2/3) × V^3 / P
 *
 *   where Δ = displacement [metric tonnes], V = speed [knots], P = shaft power [kW].
 *   C_adm is derived once at the vessel's design conditions (full load, NCR, design speed).
 *   It is then used to predict power at any other displacement and speed.
 *
 * Layer 3 — Speed-Power Curve with SFOC correction and hull condition penalties
 *   Fuel consumption adds three corrections on top of the Admiralty power estimate:
 *   a) Partial-load SFOC correction: slow-speed diesel SFOC rises as load falls below MCR.
 *      sfocFactor(L) = 0.455 × L^(-0.2) + 0.545   (L = P / MCR, clamped to [0.10, 1.0])
 *      Evaluates to 1.0 at L = 1.0 by construction. Source: CIMAC slow-speed diesel curve.
 *   b) Hull fouling penalty: biofouling adds ~0.033 % resistance per day out of drydock,
 *      capped at 20 %. Source: IMO MEPC biofouling resistance studies.
 *   c) Trim penalty: off-design trim adds ~0.5 % resistance per metre of trim.
 *
 *   Final fuel rate [t/h] = P_actual [kW] × SFOC_actual [g/kWh] / 1,000,000
 */

export interface VesselFuelParams {
  dwt: number;               // deadweight tonnes (100 % cargo capacity)
  lightshipTonnage: number;  // lightship (empty) weight in metric tonnes
  enginePower: number;       // MCR — Maximum Continuous Rating in kW
  designSpeed: number;       // design speed in knots (achieved at NCR = 85 % MCR, full load)
  maxSpeed: number;          // maximum speed in knots (typically ballast / NCR)
  sfocRefGPerKwh: number;    // reference SFOC at 100 % MCR load, in g/kWh
  lastDrydockDate: string;   // ISO date string of last drydock (for fouling calculation)
}

// ── Layer 2 helpers ────────────────────────────────────────────────────────────

/**
 * Compute actual displacement for a given cargo load.
 * @param cargoLoadPercent  0–100 % of DWT
 */
export function computeDisplacement(
  params: VesselFuelParams,
  cargoLoadPercent: number,
): number {
  const cargo = params.dwt * (cargoLoadPercent / 100);
  return params.lightshipTonnage + cargo;
}

/**
 * Derive the Admiralty Coefficient from vessel design specifications.
 *
 * We assume the vessel achieves design speed at NCR = 85 % of MCR when
 * fully loaded (lightship + DWT). This is standard practice for merchant ships.
 *
 *   C_adm = Δ_full^(2/3) × V_design^3 / P_NCR
 */
export function computeAdmiraltyCoefficient(params: VesselFuelParams): number {
  const deltaFull = params.lightshipTonnage + params.dwt;  // full-load displacement [t]
  const pNcr = params.enginePower * 0.85;                  // NCR [kW]
  return Math.pow(deltaFull, 2 / 3) * Math.pow(params.designSpeed, 3) / pNcr;
}

/**
 * Compute the ideal shaft power required at a given speed and displacement
 * using the Admiralty law:
 *
 *   P = Δ^(2/3) × V^3 / C_adm
 */
export function computeShaftPower(
  params: VesselFuelParams,
  speedKnots: number,
  displacementTonnes: number,
): number {
  const cAdm = computeAdmiraltyCoefficient(params);
  return Math.pow(displacementTonnes, 2 / 3) * Math.pow(speedKnots, 3) / cAdm;
}

// ── Layer 3 helpers ────────────────────────────────────────────────────────────

/**
 * SFOC partial-load correction factor for slow-speed 2-stroke diesel engines.
 *
 *   sfocFactor(L) = 0.455 × L^(-0.2) + 0.545
 *
 * Returns 1.0 at L = 1.0 (full MCR). Increases as load decreases.
 * L is clamped to [0.10, 1.0] to avoid singularity at zero load.
 *
 * For 4-stroke medium-speed engines (OSVs) the exponent is slightly different
 * but the same formula is a close approximation at operating loads > 50 %.
 */
export function sfocCorrectionFactor(loadFactor: number): number {
  const L = Math.max(0.10, Math.min(1.0, loadFactor));
  return 0.455 * Math.pow(L, -0.2) + 0.545;
}

/**
 * Hull fouling resistance penalty factor.
 * Biofouling increases hull resistance by approximately 0.033 % per day,
 * saturating at 20 % (typical end-of-docking-cycle penalty).
 *
 *   foulingFactor = 1 + min(days × 0.00033, 0.20)
 */
export function computeFoulingFactor(lastDrydockDate: string): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  const days = (Date.now() - new Date(lastDrydockDate).getTime()) / msPerDay;
  const penalty = Math.min(Math.max(days, 0) * 0.00033, 0.20);
  return 1 + penalty;
}

/**
 * Trim resistance correction factor.
 * Off-design trim (difference between aft and forward draft) increases resistance.
 * Model: 0.5 % per metre of trim magnitude (conservative mid-range for tankers).
 */
export function computeTrimFactor(trimMetres: number): number {
  return 1 + Math.abs(trimMetres) * 0.005;
}

// ── Combined fuel consumption model ───────────────────────────────────────────

export interface FuelConsumptionResult {
  /** Ideal shaft power from Admiralty law, before hull-condition corrections [kW] */
  idealShaftPowerKw: number;
  /** Actual shaft power after fouling and trim corrections [kW] */
  actualShaftPowerKw: number;
  /** True when actualShaftPowerKw has been clamped to MCR */
  powerLimited: boolean;
  /** Load factor = actualShaftPowerKw / MCR */
  loadFactor: number;
  /** Actual SFOC after partial-load correction [g/kWh] */
  sfocGPerKwh: number;
  /** Fuel consumption rate [t/h] */
  fuelTonnesPerHour: number;
  /** Fuel consumption per day [t/day] */
  fuelTonnesPerDay: number;
  /** Fuel consumption per nautical mile [t/nm] */
  fuelTonnesPerNm: number;
  /** Admiralty Coefficient derived for this vessel */
  admiraltyCoeff: number;
  /** Displacement at the given cargo load [t] */
  displacementTonnes: number;
  /** Hull fouling factor (1.0 = clean hull, 1.20 = 20 % penalty) */
  foulingFactor: number;
  /** Trim factor (1.0 = design trim) */
  trimFactor: number;
}

/**
 * Full fuel consumption calculation combining Layers 2 and 3.
 *
 * @param params           Vessel hull and engine parameters
 * @param speedKnots       Operating speed [kn]
 * @param cargoLoadPercent Cargo load as percentage of DWT [0–100]
 * @param trimMetres       Trim in metres (|aft draft − fwd draft|), default 0
 */
export function computeFuelConsumption(
  params: VesselFuelParams,
  speedKnots: number,
  cargoLoadPercent: number,
  trimMetres: number = 0,
): FuelConsumptionResult {
  const displacementTonnes = computeDisplacement(params, cargoLoadPercent);
  const admiraltyCoeff = computeAdmiraltyCoefficient(params);
  const foulingFactor = computeFoulingFactor(params.lastDrydockDate);
  const trimFactor = computeTrimFactor(trimMetres);

  // Ideal power from Admiralty law (clean hull, design trim)
  const idealShaftPowerKw = Math.pow(displacementTonnes, 2 / 3) * Math.pow(speedKnots, 3) / admiraltyCoeff;

  // Apply hull-condition penalties, then cap at MCR
  const uncappedPower = idealShaftPowerKw * foulingFactor * trimFactor;
  const powerLimited = uncappedPower > params.enginePower;
  const actualShaftPowerKw = Math.min(uncappedPower, params.enginePower);

  // Load factor and SFOC
  const loadFactor = actualShaftPowerKw / params.enginePower;
  const sfocGPerKwh = params.sfocRefGPerKwh * sfocCorrectionFactor(loadFactor);

  // Fuel rate: P [kW] × SFOC [g/kWh] = [g/h]  →  / 1,000,000 → [t/h]
  const fuelTonnesPerHour = (actualShaftPowerKw * sfocGPerKwh) / 1_000_000;
  const fuelTonnesPerDay = fuelTonnesPerHour * 24;
  // speed [kn] = [nm/h], so fuel [t/h] / speed [nm/h] = [t/nm]
  const fuelTonnesPerNm = fuelTonnesPerHour / speedKnots;

  return {
    idealShaftPowerKw: round(idealShaftPowerKw, 1),
    actualShaftPowerKw: round(actualShaftPowerKw, 1),
    powerLimited,
    loadFactor: round(loadFactor, 4),
    sfocGPerKwh: round(sfocGPerKwh, 2),
    fuelTonnesPerHour: round(fuelTonnesPerHour, 4),
    fuelTonnesPerDay: round(fuelTonnesPerDay, 2),
    fuelTonnesPerNm: round(fuelTonnesPerNm, 5),
    admiraltyCoeff: round(admiraltyCoeff, 1),
    displacementTonnes: round(displacementTonnes, 0),
    foulingFactor: round(foulingFactor, 4),
    trimFactor: round(trimFactor, 4),
  };
}

// ── Speed-power curve builder ──────────────────────────────────────────────────

export interface SpeedCurvePoint {
  speed: number;
  fuelPerDay: number;       // t/day
  fuelPerNm: number;        // t/nm
  shaftPowerKw: number;     // actual shaft power [kW]
  loadFactor: number;       // fraction of MCR
  sfocGPerKwh: number;      // g/kWh
  co2PerDay: number;        // tCO2/day  (VLSFO Cf = 3.151, IMO MEPC.308(73))
  costPerDay: number;       // USD/day
  powerLimited: boolean;    // true when speed requires more than MCR
  isOptimal: boolean;       // true at design speed ± 0.3 kn
  isTarget: boolean;        // true at requested targetSpeed ± 0.3 kn
}

/** CO2 conversion factor for VLSFO per IMO MEPC.308(73) [tCO2/tFuel] */
const CO2_FACTOR_VLSFO = 3.151;

/**
 * Build a speed-power curve from minSpeed (50 % of design) to maxSpeed
 * in 0.5-knot increments.
 *
 * @param params               Vessel parameters
 * @param cargoLoadPercent     0–100 % of DWT
 * @param trimMetres           Trim magnitude in metres
 * @param targetSpeed          Optional highlighted speed
 * @param fuelPriceUsdPerTonne Bunker price for cost column (default USD 620/t)
 */
export function buildSpeedPowerCurve(
  params: VesselFuelParams,
  cargoLoadPercent: number,
  trimMetres: number = 0,
  targetSpeed?: number,
  fuelPriceUsdPerTonne: number = 620,
): SpeedCurvePoint[] {
  const minSpeed = params.designSpeed * 0.5;
  const maxSpeed = params.maxSpeed;
  const points: SpeedCurvePoint[] = [];

  for (let v = minSpeed; v <= maxSpeed + 0.01; v += 0.5) {
    const speed = round(v, 1);
    const fc = computeFuelConsumption(params, speed, cargoLoadPercent, trimMetres);
    points.push({
      speed,
      fuelPerDay: fc.fuelTonnesPerDay,
      fuelPerNm: fc.fuelTonnesPerNm,
      shaftPowerKw: fc.actualShaftPowerKw,
      loadFactor: fc.loadFactor,
      sfocGPerKwh: fc.sfocGPerKwh,
      co2PerDay: round(fc.fuelTonnesPerDay * CO2_FACTOR_VLSFO, 2),
      costPerDay: round(fc.fuelTonnesPerDay * fuelPriceUsdPerTonne, 0),
      powerLimited: fc.powerLimited,
      isOptimal: Math.abs(speed - params.designSpeed) < 0.3,
      isTarget: targetSpeed !== undefined && Math.abs(speed - targetSpeed) < 0.3,
    });
  }

  return points;
}

// ── Internal utility ───────────────────────────────────────────────────────────

function round(value: number, decimals: number): number {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}
