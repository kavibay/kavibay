/** Include section headings and variable row heights in the seven-result limit. */
export function sevenResultRowsHeight(
  rows: readonly { offsetTop: number; offsetHeight: number }[],
  bottomPadding: number,
): number {
  const seventh = rows[6];
  return seventh
    ? seventh.offsetTop + seventh.offsetHeight + (rows.length === 7 ? bottomPadding : 0)
    : Infinity;
}
