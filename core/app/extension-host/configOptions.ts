/**
 * Options for a provider-backed `select` config field.
 *
 * One implementation, three callers: the gate's first-run form, the gear panel
 * of a running widget, and Settings → Extensions when it offers one widget per
 * option. They had drifted into three copies of the same six lines, and the
 * `id`/`name` mapping below is the kind of detail that is only obviously shared
 * once it is written down — a provider that starts labelling rows differently
 * has to be answered in one place, not found in three.
 *
 * The host is a parameter rather than the cockpit singleton. The dev board
 * mounts the same gate against a host of its own, and a helper that reached for
 * the app's would quietly answer from the wrong registry there.
 */
import type { ConfigField, ConfigOption } from "@sdk/contract/sdk";
import type { Host } from "./runtime";

/** The shape every provider query behind a `select` is expected to return. */
interface OptionRow {
  id: string | number;
  name?: string;
}

/**
 * `allowed = null` marks this a runtime-initiated read: the form is drawn by
 * the host, not requested by the widget, so the widget's own permission list
 * must not gate it.
 */
export async function loadConfigOptions(
  host: Host,
  field: ConfigField,
): Promise<ConfigOption[]> {
  if (!field.source) return [];
  const rows = await host.query<OptionRow[]>(field.source.provider, field.source.query, {}, null);
  return rows.map((row) => ({ value: row.id, label: row.name ?? String(row.id) }));
}
