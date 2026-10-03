export type ResultCardLayout = {
  cardSpan: 2 | 4 | 5;
  columns: 1 | 2;
  rows: number;
  valueSize: number;
  labelSize: number;
};

const BASE_VALUE_SIZE = 23;
const COMPACT_LABEL_SIZE = 9;
const WIDE_LABEL_SIZE = 9;

export function resultCardLayout(resultCount: number): ResultCardLayout {
  const count = Math.max(0, Math.floor(resultCount));

  if (count <= 3) {
    return {
      cardSpan: 2,
      columns: 1,
      rows: Math.max(1, count),
      valueSize: BASE_VALUE_SIZE,
      labelSize: COMPACT_LABEL_SIZE,
    };
  }

  const rows = Math.ceil(count / 2);
  const cardSpan: 4 | 5 = count <= 6 ? 4 : 5;
  const valueSize = rows <= 3
    ? BASE_VALUE_SIZE
    : Math.max(13, BASE_VALUE_SIZE - (rows - 3) * 3);

  return {
    cardSpan,
    columns: 2,
    rows,
    valueSize,
    labelSize: WIDE_LABEL_SIZE,
  };
}
