import { type AreaRegistryEntry } from "./areaRegistry.js";
import { type FloorRegistryEntry } from "./floorRegistry.js";

export type AreasFloorHierarchy = {
  readonly floors: ReadonlyArray<{
    readonly id: string;
    readonly areas: ReadonlyArray<string>;
  }>;
  readonly areas: ReadonlyArray<string>;
};

/** Group areas by floor registry order, then unassigned area ids. */
export function getAreasFloorHierarchy(
  floors: ReadonlyArray<FloorRegistryEntry>,
  areas: ReadonlyArray<AreaRegistryEntry>,
): AreasFloorHierarchy {
  const floorAreas = new Map<string, Array<string>>();
  const unassignedAreas: Array<string> = [];

  for (const area of areas) {
    if (area.floor_id) {
      const list = floorAreas.get(area.floor_id);
      if (list) {
        list.push(area.area_id);
      } else {
        floorAreas.set(area.floor_id, [area.area_id]);
      }
    } else {
      unassignedAreas.push(area.area_id);
    }
  }

  return {
    floors: floors.map((floor) => ({
      id: floor.floor_id,
      areas: floorAreas.get(floor.floor_id) ?? [],
    })),
    areas: unassignedAreas,
  };
}
