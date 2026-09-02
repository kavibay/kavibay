/** Select the next focus target: a widget id, or `null` for the search palette. */
export function nextWidgetFocusId(
  openInstanceIds: readonly string[],
  currentInstanceId: string | null,
  previous = false,
): string | null {
  if (openInstanceIds.length === 0 || currentInstanceId == null) {
    return previous ? (openInstanceIds[openInstanceIds.length - 1] ?? null) : (openInstanceIds[0] ?? null);
  }

  const currentIndex = openInstanceIds.indexOf(currentInstanceId);
  if (currentIndex < 0) {
    return previous ? openInstanceIds[openInstanceIds.length - 1]! : openInstanceIds[0]!;
  }

  if (previous && currentIndex === 0) return null;
  if (!previous && currentIndex === openInstanceIds.length - 1) return null;
  return openInstanceIds[currentIndex + (previous ? -1 : 1)]!;
}
