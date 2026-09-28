import type { WidgetCatalogEntry, WidgetInstance } from "./types";

/** One mounted card per background instance, including hidden cards on other desks. */
export function withBackgroundWidgets(
  active: WidgetInstance[],
  catalog: WidgetCatalogEntry[],
  keepAlive: (typeId: string) => boolean,
  inlineInstanceId: string | null,
): WidgetInstance[] {
  const byId = new Map(active.map((instance) => [instance.instanceId, instance]));
  for (const entry of catalog) {
    if (!keepAlive(entry.typeId)) continue;
    if (entry.instanceId === inlineInstanceId) {
      byId.delete(entry.instanceId);
    } else if (!byId.has(entry.instanceId)) {
      byId.set(entry.instanceId, { ...entry, offset: { x: 0, y: 0 }, hidden: true });
    }
  }
  return [...byId.values()];
}
