import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';
import * as shapefile from 'shapefile';
import { unzipTo } from './fetch.mjs';
import { CACHE } from './util.mjs';

/** Extract a shapefile zip (each into its own directory) and return paths of .shp/.dbf. */
export function extractShp(zipPath) {
  const name = basename(zipPath, '.zip');
  const dir = join(CACHE, 'x', 'shp', name);
  if (!existsSync(join(dir, `${name}.shp`))) unzipTo(zipPath, dir);
  return { shp: join(dir, `${name}.shp`), dbf: join(dir, `${name}.dbf`) };
}

export async function readFeatures(zipPath) {
  const { shp, dbf } = extractShp(zipPath);
  return shapefile.read(shp, dbf, { encoding: 'utf-8' });
}

export async function readDbf(zipPath) {
  const { dbf } = extractShp(zipPath);
  const src = await shapefile.openDbf(dbf, { encoding: 'utf-8' });
  const rows = [];
  for (let r = await src.read(); !r.done; r = await src.read()) rows.push(r.value);
  return rows;
}
