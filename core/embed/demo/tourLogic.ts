/**
 * Whether this Wizard mount has actually produced the finished package.
 *
 * The files on their own are not enough: Replay used to leave the last run's
 * draft in memory, so the tour saw the finished marker immediately and skipped
 * the conversation. The answers have to belong to this mount too.
 */
export function finishedDraftFromThisRun(
  assistantTurns: number,
  expectedTurns: number,
  files: { contents: string }[],
  marker: string,
): boolean {
  return (
    assistantTurns >= expectedTurns && files.some((file) => file.contents.includes(marker))
  );
}
