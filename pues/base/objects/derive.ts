import type { Row } from "./useResource";

export function deriveResourceRow(
  row: Row,
  deriveRow?: (row: Row) => Row,
): Row {
  return deriveRow ? deriveRow(row) : row;
}

export function deriveResourceRows(
  rows: Row[],
  deriveRow?: (row: Row) => Row,
): Row[] {
  return rows.map((row) => deriveResourceRow(row, deriveRow));
}
