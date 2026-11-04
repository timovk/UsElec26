// Projection used by every geography-pack coordinate: d3.geoAlbersUsa().scale(1300).translate([487.5, 305])
// (viewBox 0 0 975 610, identical to us-atlas). geoAlbersUsa returns null for points outside its clip
// windows (e.g. far-western Aleutians); for Alaska and Hawaii points we then fall back to the same
// sub-projection *without* clipping, so every block internal point gets a coordinate.
import { geoAlbersUsa, geoConicEqualArea } from 'd3-geo';

export const SCALE = 1300;
export const TRANSLATE = [487.5, 305];
export const albersUsa = geoAlbersUsa().scale(SCALE).translate(TRANSLATE);

const k = SCALE, [x, y] = TRANSLATE;
const alaska = geoConicEqualArea().rotate([154, 0]).center([-2, 58.5]).parallels([55, 65])
  .scale(k * 0.35).translate([x - 0.307 * k, y + 0.201 * k]);
const hawaii = geoConicEqualArea().rotate([157, 0]).center([-3, 19.9]).parallels([8, 18])
  .scale(k).translate([x - 0.205 * k, y + 0.212 * k]);

/** Project [lon, lat] for a point known to lie in state `fips`. */
export function projectPoint(lon, lat, fips) {
  const p = albersUsa([lon, lat]);
  if (p) return p;
  if (fips === '02') return alaska([lon, lat]);
  if (fips === '15') return hawaii([lon, lat]);
  return null;
}
