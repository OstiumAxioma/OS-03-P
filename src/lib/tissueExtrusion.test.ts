import { describe, expect, it } from "vitest";

import { createTissueExtrusionCells, createTissueExtrusionSurface } from "./tissueExtrusion";

describe("createTissueExtrusionCells", () => {
  it("turns opaque tissue pixels into drawable extrusion cells with depth and color", () => {
    const diffuse = new Uint8Array(4 * 4 * 4);
    const thickness = new Uint8Array(4 * 4);
    const roughness = new Uint8Array(4 * 4).fill(180);
    const tissueIndex = 1 * 4 + 2;

    diffuse[tissueIndex * 4] = 200;
    diffuse[tissueIndex * 4 + 1] = 80;
    diffuse[tissueIndex * 4 + 2] = 60;
    diffuse[tissueIndex * 4 + 3] = 240;
    thickness[tissueIndex] = 192;

    const cells = createTissueExtrusionCells({
      width: 4,
      height: 4,
      diffuse,
      roughness,
      thickness,
      maxCellsPerAxis: 4
    });

    expect(cells).toHaveLength(1);
    expect(cells[0].depth).toBeGreaterThan(0.65);
    expect(cells[0].color).toEqual([200, 80, 60]);
    expect(cells[0].width).toBeCloseTo(0.25);
    expect(cells[0].height).toBeCloseTo(0.25);
  });

  it("downsamples large slices into bounded extrusion blocks", () => {
    const diffuse = new Uint8Array(8 * 8 * 4);
    const thickness = new Uint8Array(8 * 8).fill(255);
    const roughness = new Uint8Array(8 * 8).fill(160);

    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 4; x += 1) {
        const index = y * 8 + x;
        diffuse[index * 4] = 180;
        diffuse[index * 4 + 1] = 80;
        diffuse[index * 4 + 2] = 70;
        diffuse[index * 4 + 3] = 220;
      }
    }

    const cells = createTissueExtrusionCells({
      width: 8,
      height: 8,
      diffuse,
      roughness,
      thickness,
      maxCellsPerAxis: 4
    });

    expect(cells.length).toBeGreaterThan(0);
    expect(cells.length).toBeLessThanOrEqual(16);
    expect(cells.every((cell) => cell.depth > 0)).toBe(true);
  });
});

describe("createTissueExtrusionSurface", () => {
  it("uses the source texture resolution by default for the extrusion outline", () => {
    const diffuse = new Uint8Array(256 * 64 * 4);
    const thickness = new Uint8Array(256 * 64).fill(220);
    const roughness = new Uint8Array(256 * 64).fill(180);
    const tissueIndex = 12 * 256 + 200;

    diffuse[tissueIndex * 4] = 200;
    diffuse[tissueIndex * 4 + 1] = 80;
    diffuse[tissueIndex * 4 + 2] = 60;
    diffuse[tissueIndex * 4 + 3] = 240;

    const surface = createTissueExtrusionSurface({
      width: 256,
      height: 64,
      diffuse,
      roughness,
      thickness
    });

    expect(surface.gridWidth).toBe(256);
    expect(surface.gridHeight).toBe(64);
    expect(surface.cellCount).toBe(1);
    expect(surface.boundaryEdgeCount).toBe(4);
  });

  it("aligns a tissue pixel extrusion to the same pixel edges as the diffuse plane", () => {
    const diffuse = new Uint8Array(4 * 4 * 4);
    const thickness = new Uint8Array(4 * 4).fill(220);
    const roughness = new Uint8Array(4 * 4).fill(180);
    const tissueIndex = 1 * 4 + 2;

    diffuse[tissueIndex * 4] = 200;
    diffuse[tissueIndex * 4 + 1] = 80;
    diffuse[tissueIndex * 4 + 2] = 60;
    diffuse[tissueIndex * 4 + 3] = 240;

    const surface = createTissueExtrusionSurface({
      width: 4,
      height: 4,
      diffuse,
      roughness,
      thickness
    });
    const points = Array.from({ length: surface.positions.length / 3 }, (_, index) => {
      const offset = index * 3;

      return [
        surface.positions[offset].toFixed(4),
        surface.positions[offset + 1].toFixed(4),
        surface.positions[offset + 2].toFixed(4)
      ].join(",");
    });

    expect(points).toContain("0.0000,-0.2500,-0.5000");
    expect(points).toContain("0.2500,-0.2500,-0.5000");
    expect(points).toContain("0.2500,0.0000,-0.5000");
    expect(points).toContain("0.0000,0.0000,-0.5000");
  });

  it("assigns texture uvs from the same grid coordinates as the extrusion vertices", () => {
    const diffuse = new Uint8Array(4 * 4 * 4);
    const thickness = new Uint8Array(4 * 4).fill(220);
    const roughness = new Uint8Array(4 * 4).fill(180);
    const tissueIndex = 1 * 4 + 2;

    diffuse[tissueIndex * 4] = 200;
    diffuse[tissueIndex * 4 + 1] = 80;
    diffuse[tissueIndex * 4 + 2] = 60;
    diffuse[tissueIndex * 4 + 3] = 240;

    const surface = createTissueExtrusionSurface({
      width: 4,
      height: 4,
      diffuse,
      roughness,
      thickness
    });
    const vertexCount = surface.positions.length / 3;
    const uvs = Array.from({ length: vertexCount }, (_, index) => {
      const offset = index * 2;

      return [
        surface.uvs[offset].toFixed(4),
        surface.uvs[offset + 1].toFixed(4)
      ].join(",");
    });

    expect(surface.uvs.length).toBe(vertexCount * 2);
    expect(uvs).toContain("0.5000,0.2500");
    expect(uvs).toContain("0.7500,0.2500");
    expect(uvs).toContain("0.7500,0.5000");
    expect(uvs).toContain("0.5000,0.5000");
  });

  it("creates a continuous surface without per-cell internal box walls", () => {
    const diffuse = new Uint8Array(4 * 4 * 4);
    const thickness = new Uint8Array(4 * 4).fill(220);
    const roughness = new Uint8Array(4 * 4).fill(180);

    for (let y = 1; y <= 2; y += 1) {
      for (let x = 1; x <= 2; x += 1) {
        const index = y * 4 + x;
        diffuse[index * 4] = 200;
        diffuse[index * 4 + 1] = 80;
        diffuse[index * 4 + 2] = 60;
        diffuse[index * 4 + 3] = 240;
      }
    }

    const surface = createTissueExtrusionSurface({
      width: 4,
      height: 4,
      diffuse,
      roughness,
      thickness,
      maxCellsPerAxis: 4
    });

    expect(surface.cellCount).toBe(4);
    expect(surface.boundaryEdgeCount).toBe(8);
    expect(surface.positions.length).toBeGreaterThan(0);
    expect(surface.indices.length).toBeGreaterThan(0);
  });

  it("extrudes straight backward to a flat back plane instead of forming a height field", () => {
    const diffuse = new Uint8Array(3 * 3 * 4);
    const thickness = new Uint8Array(3 * 3);
    const roughness = new Uint8Array(3 * 3).fill(180);

    for (let index = 0; index < 9; index += 1) {
      diffuse[index * 4] = 200;
      diffuse[index * 4 + 1] = 80;
      diffuse[index * 4 + 2] = 60;
      diffuse[index * 4 + 3] = 240;
      thickness[index] = index % 2 === 0 ? 255 : 80;
    }

    const surface = createTissueExtrusionSurface({
      width: 3,
      height: 3,
      diffuse,
      roughness,
      thickness,
      maxCellsPerAxis: 3
    });
    const zValues = Array.from(surface.positions)
      .filter((_, index) => index % 3 === 2)
      .filter((z) => z < 0.5);
    const uniqueBackZ = new Set(zValues.map((z) => z.toFixed(4)));

    expect(uniqueBackZ).toEqual(new Set(["-0.5000"]));
  });
});
