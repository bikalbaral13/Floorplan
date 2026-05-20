/**
 * MapTileLayer — renders OSM tiles inside the Konva world viewport.
 *
 * Coordinate model:
 * - The user picks a geographic anchor (lat/lon) that pins to canvas world
 *   coord (0, 0) and an integer OSM zoom level.
 * - From those two values, every visible OSM tile (z/x/y) has a fully-known
 *   rectangle in world coords: tile (X, Y) sits at world-pixel position
 *   (X - anchorTileX) * TILE_SIZE, (Y - anchorTileY) * TILE_SIZE.
 * - We compute the visible viewport in world coords, derive the tile range,
 *   fetch each tile, and draw it via KonvaImage.
 *
 * Performance: tiles are cached in `osmMap.loadTileImage`. We re-evaluate the
 * tile range whenever pan/zoom changes; the cache means re-fetches are free.
 */

import { useEffect, useState } from "react";
import { Image as KonvaImage } from "react-konva";
import {
  TILE_SIZE,
  latLonToTile,
  loadTileImage,
  osmTileUrl,
} from "../osmMap";

interface MapTileLayerProps {
  /** Geographic anchor — this lat/lon pins to canvas world (0, 0). */
  anchorLat: number;
  anchorLon: number;
  /** Integer OSM tile zoom level (typically 0–19; 17–19 is "site scale"). */
  zoom: number;
  /** World-coord viewport min/max — derived in the parent from stage size + pan + scale. */
  worldMinX: number;
  worldMaxX: number;
  worldMinY: number;
  worldMaxY: number;
  /** Layer opacity (0–1). Lets the user see traced geometry on top of the map. */
  opacity?: number;
}

interface RenderableTile {
  z: number;
  x: number;
  y: number;
  url: string;
  worldX: number;
  worldY: number;
  image: HTMLImageElement;
}

export const MapTileLayer = ({
  anchorLat,
  anchorLon,
  zoom,
  worldMinX,
  worldMaxX,
  worldMinY,
  worldMaxY,
  opacity = 1,
}: MapTileLayerProps) => {
  const [tiles, setTiles] = useState<RenderableTile[]>([]);

  useEffect(() => {
    const z = Math.max(0, Math.min(19, Math.round(zoom)));
    // Anchor's fractional tile position at this zoom — defines world origin (0,0).
    const anchorTile = latLonToTile(anchorLat, anchorLon, z);
    // World-pixel offset of tile (0, 0) at this zoom relative to canvas origin.
    const worldOffsetX = -anchorTile.x * TILE_SIZE;
    const worldOffsetY = -anchorTile.y * TILE_SIZE;

    // Visible tile range = intersection of viewport with the slippy-map grid.
    const tileMinX = Math.floor((worldMinX - worldOffsetX) / TILE_SIZE);
    const tileMaxX = Math.ceil((worldMaxX - worldOffsetX) / TILE_SIZE);
    const tileMinY = Math.floor((worldMinY - worldOffsetY) / TILE_SIZE);
    const tileMaxY = Math.ceil((worldMaxY - worldOffsetY) / TILE_SIZE);

    const wantedTiles: { z: number; x: number; y: number; url: string; worldX: number; worldY: number }[] = [];
    const tileGridSize = 2 ** z;
    for (let tx = tileMinX; tx < tileMaxX; tx++) {
      for (let ty = tileMinY; ty < tileMaxY; ty++) {
        // Clamp tiles outside the world grid (above/below the poles, beyond wrap).
        if (ty < 0 || ty >= tileGridSize) continue;
        const wrappedX = ((tx % tileGridSize) + tileGridSize) % tileGridSize;
        wantedTiles.push({
          z,
          x: wrappedX,
          y: ty,
          url: osmTileUrl(z, wrappedX, ty),
          worldX: worldOffsetX + tx * TILE_SIZE,
          worldY: worldOffsetY + ty * TILE_SIZE,
        });
      }
    }

    // Fetch in parallel; ignore failed ones. A stale-closure flag prevents
    // an out-of-date fetch result from overwriting fresher state if pan/zoom
    // changed mid-fetch (effect cleanup sets it false).
    let alive = true;
    Promise.all(
      wantedTiles.map(async (t) => {
        const img = await loadTileImage(t.url);
        return img ? { ...t, image: img } : null;
      }),
    ).then((results) => {
      if (!alive) return;
      setTiles(results.filter((t): t is RenderableTile => t !== null));
    });
    return () => {
      alive = false;
    };
  }, [anchorLat, anchorLon, zoom, worldMinX, worldMaxX, worldMinY, worldMaxY]);

  return (
    <>
      {tiles.map((t) => (
        <KonvaImage
          key={`${t.z}/${t.x}/${t.y}`}
          image={t.image}
          x={t.worldX}
          y={t.worldY}
          width={TILE_SIZE}
          height={TILE_SIZE}
          opacity={opacity}
          listening={false}
        />
      ))}
    </>
  );
};
