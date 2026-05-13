/** Classify a unit normal (nx, ny) into a cardinal. Screen Y is down: up (−y) = N, right = E. */
export const classifyCardinal = (nx: number, ny: number): "N" | "E" | "S" | "W" => {
  const ang = Math.atan2(nx, -ny);
  const deg = ((ang * 180) / Math.PI + 360) % 360;
  if (deg >= 315 || deg < 45) return "N";
  if (deg < 135) return "E";
  if (deg < 225) return "S";
  return "W";
};
