/** Pure BUA (Built-Up Area) statement — the subset of the BUA Calculator block's `computeStatement`
 *  that produces the two Flow outputs:
 *    • FSI BUA   = max permissible gross BUA (incl. fungible)  — the FSI statement total.
 *    • Non-FSI BUA = parking + other non-FSI area.
 *  Kept identical to BuaCalculatorBlock so the node matches the block. */

const num = (v: unknown, d: number): number => (typeof v === "number" && isFinite(v) ? v : Number(v) || d);

export interface BuaOutputs {
  /** Max permissible gross BUA (zonal + premium + TDR + scheme, plus fungible). m². */
  fsiBua: number;
  /** Non-FSI construction area = parking + other non-FSI. m². */
  nonFsiBua: number;
}

export const computeBua = (params: Record<string, unknown>): BuaOutputs => {
  const plot = Math.max(0, num(params.plotArea, 0));
  const amenityOsRate = num(params.amenityOsRate, 0.1);
  const basicMult = num(params.basicFsiMultiplier, 1);
  const premiumMult = num(params.premiumFsiMultiplier, 0.5);
  const tdrMult = num(params.tdrMultiplier, 0.9);
  const fungRate = num(params.fungibleRate, 0.35);
  const schemeFsi = num(params.schemeFsiSqm, 0);

  const amenityOsM2 = plot * amenityOsRate;
  const netPlotM2 = plot - amenityOsM2;
  const zonalM2 = netPlotM2 * basicMult;
  const premiumM2 = netPlotM2 * premiumMult;
  const tdrM2 = netPlotM2 * tdrMult;
  const totalExFungible = zonalM2 + premiumM2 + tdrM2 + schemeFsi;
  const fungOnZonal = zonalM2 * fungRate;
  const fungOnOthers = (premiumM2 + tdrM2 + schemeFsi) * fungRate;
  const fsiBua = totalExFungible + fungOnZonal + fungOnOthers;

  const parkingM2 = num(params.carParksRequired, 0) * num(params.areaPerCarParkSqm, 30);
  const nonFsiBua = parkingM2 + num(params.otherNonFsiSqm, 0);

  return { fsiBua, nonFsiBua };
};
