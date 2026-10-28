import { BOARD_BREAKPOINTS } from "./board-schema.js";
import { DIAGNOSTIC_CODES } from "./diagnostics.js";
import {
  checkUnknownKeys,
  isRecord,
  nonEmptyString,
  own,
  type AddDiagnostic,
  type ScannedEntry,
} from "./board-validation-shared.js";

const LAYOUT_KEYS = new Set(["desktop", "tablet", "narrow"]);
const BREAKPOINT_KEYS = new Set(["columns", "rowHeight", "placements"]);
const PLACEMENT_KEYS = new Set(["blockId", "x", "y", "width", "height", "minWidth", "minHeight"]);

export function validateLayout(
  root: Record<string, unknown>,
  blocks: ReadonlyMap<string, ScannedEntry>,
  add: AddDiagnostic,
): void {
  const layout = own(root, "layout");
  if (layout === undefined) {
    add(DIAGNOSTIC_CODES.MISSING_REQUIRED_PROPERTY, "/layout");
    return;
  }
  if (!isRecord(layout)) {
    add(DIAGNOSTIC_CODES.LAYOUT_INVALID, "/layout");
    return;
  }
  checkUnknownKeys(layout, LAYOUT_KEYS, "/layout", add);

  const placementsByBreakpoint = new Map<string, Map<string, Record<string, unknown>>>();
  for (const breakpoint of BOARD_BREAKPOINTS) {
    const breakpointPath = `/layout/${breakpoint}`;
    const breakpointValue = own(layout, breakpoint);
    if (breakpointValue === undefined) {
      if (breakpoint === "desktop") {
        add(DIAGNOSTIC_CODES.LAYOUT_INVALID, breakpointPath, "Desktop layout is required.");
      }
      continue;
    }
    if (!isRecord(breakpointValue)) {
      add(DIAGNOSTIC_CODES.LAYOUT_INVALID, breakpointPath);
      continue;
    }
    checkUnknownKeys(breakpointValue, BREAKPOINT_KEYS, breakpointPath, add);
    const columns = own(breakpointValue, "columns");
    if (
      typeof columns !== "number" ||
      !Number.isInteger(columns) ||
      columns <= 0 ||
      columns > 256
    ) {
      add(DIAGNOSTIC_CODES.LAYOUT_INVALID, `${breakpointPath}/columns`);
    }
    const rowHeight = own(breakpointValue, "rowHeight");
    if (
      rowHeight !== undefined &&
      (typeof rowHeight !== "number" || !Number.isFinite(rowHeight) || rowHeight <= 0)
    ) {
      add(DIAGNOSTIC_CODES.LAYOUT_INVALID, `${breakpointPath}/rowHeight`);
    }
    const placements = own(breakpointValue, "placements");
    if (!Array.isArray(placements)) {
      add(DIAGNOSTIC_CODES.LAYOUT_INVALID, `${breakpointPath}/placements`);
      continue;
    }
    const byBlock = new Map<string, Record<string, unknown>>();
    const geometries: Array<{
      readonly blockId: string;
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
      readonly path: string;
    }> = [];
    placements.forEach((placement, index) => {
      const placementPath = `${breakpointPath}/placements/${index}`;
      if (!isRecord(placement)) {
        add(DIAGNOSTIC_CODES.LAYOUT_INVALID, placementPath);
        return;
      }
      checkUnknownKeys(placement, PLACEMENT_KEYS, placementPath, add);
      const blockId = own(placement, "blockId");
      if (!nonEmptyString(blockId)) {
        add(DIAGNOSTIC_CODES.MISSING_ID, `${placementPath}/blockId`);
        return;
      }
      if (!blocks.has(blockId)) {
        add(DIAGNOSTIC_CODES.INVALID_REFERENCE, `${placementPath}/blockId`, undefined, {
          relatedIds: [blockId],
        });
      }
      if (byBlock.has(blockId)) {
        add(DIAGNOSTIC_CODES.LAYOUT_INVALID, `${placementPath}/blockId`, undefined, {
          relatedIds: [blockId],
        });
        return;
      }
      byBlock.set(blockId, placement);
      const geometry: Record<string, number> = {};
      let geometryValid = true;
      for (const key of ["x", "y", "width", "height"] as const) {
        const entry = own(placement, key);
        if (typeof entry !== "number" || !Number.isInteger(entry)) {
          add(DIAGNOSTIC_CODES.LAYOUT_INVALID, `${placementPath}/${key}`);
          geometryValid = false;
        } else {
          geometry[key] = entry;
        }
      }
      for (const key of ["minWidth", "minHeight"] as const) {
        const entry = own(placement, key);
        if (
          entry !== undefined &&
          (typeof entry !== "number" || !Number.isInteger(entry) || entry <= 0)
        ) {
          add(DIAGNOSTIC_CODES.LAYOUT_INVALID, `${placementPath}/${key}`);
          geometryValid = false;
        }
      }
      if (!geometryValid) {
        return;
      }
      const x = geometry.x as number;
      const y = geometry.y as number;
      const width = geometry.width as number;
      const height = geometry.height as number;
      if (x < 0 || y < 0 || width <= 0 || height <= 0) {
        add(DIAGNOSTIC_CODES.LAYOUT_INVALID, placementPath);
        return;
      }
      if (typeof columns === "number" && x + width > columns) {
        add(
          DIAGNOSTIC_CODES.LAYOUT_INVALID,
          placementPath,
          "The placement exceeds the breakpoint column count.",
        );
      }
      const minWidth = own(placement, "minWidth");
      const minHeight = own(placement, "minHeight");
      if (typeof minWidth === "number" && minWidth > width) {
        add(DIAGNOSTIC_CODES.LAYOUT_INVALID, `${placementPath}/minWidth`);
      }
      if (typeof minHeight === "number" && minHeight > height) {
        add(DIAGNOSTIC_CODES.LAYOUT_INVALID, `${placementPath}/minHeight`);
      }
      geometries.push({ blockId, x, y, width, height, path: placementPath });
    });

    for (let leftIndex = 0; leftIndex < geometries.length; leftIndex += 1) {
      const left = geometries[leftIndex];
      if (!left) {
        continue;
      }
      for (let rightIndex = leftIndex + 1; rightIndex < geometries.length; rightIndex += 1) {
        const right = geometries[rightIndex];
        if (!right) {
          continue;
        }
        if (
          left.x < right.x + right.width &&
          right.x < left.x + left.width &&
          left.y < right.y + right.height &&
          right.y < left.y + left.height
        ) {
          add(DIAGNOSTIC_CODES.LAYOUT_OVERLAP, right.path, undefined, {
            relatedIds: [left.blockId, right.blockId],
          });
        }
      }
    }
    placementsByBreakpoint.set(breakpoint, byBlock);
  }

  const desktopPlacements = placementsByBreakpoint.get("desktop");
  const tabletPlacements = placementsByBreakpoint.get("tablet");
  for (const blockId of blocks.keys()) {
    if (!desktopPlacements?.has(blockId)) {
      add(DIAGNOSTIC_CODES.LAYOUT_INVALID, "/layout/desktop/placements", undefined, {
        relatedIds: [blockId],
      });
    }
    if (!tabletPlacements?.has(blockId)) {
      add(DIAGNOSTIC_CODES.LAYOUT_FALLBACK, "/layout/tablet", undefined, {
        severity: "warning",
        relatedIds: [blockId],
      });
    }
    if (!placementsByBreakpoint.get("narrow")?.has(blockId)) {
      add(DIAGNOSTIC_CODES.LAYOUT_FALLBACK, "/layout/narrow", undefined, {
        severity: "warning",
        relatedIds: [blockId],
      });
    }
  }
}
