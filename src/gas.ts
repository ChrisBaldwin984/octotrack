/**
 * SMETS2 gas meters report consumption in m³; bills are in kWh.
 * Industry-standard conversion: m³ × volume correction × calorific value ÷ 3.6
 */
const VOLUME_CORRECTION = 1.02264

export function m3ToKwh(m3: number, calorificValue: number): number {
  return (m3 * VOLUME_CORRECTION * calorificValue) / 3.6
}
