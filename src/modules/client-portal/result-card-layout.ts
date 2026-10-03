export type ResultCardLayout = {
  wide: boolean;
  columns: 1 | 2;
  rows: number;
  valueSize: number;
  labelSize: number;
  rowGap: number;
};

const BASE_VALUE_SIZE = 23;
const BASE_LABEL_SIZE = 11;
const BASE_ROW_GAP = 7;
const BASE_VISIBLE_ROWS = 3;
const LINE_HEIGHT = 1.05;
const BASE_LIST_HEIGHT = BASE_VISIBLE_ROWS * BASE_VALUE_SIZE * LINE_HEIGHT
  + (BASE_VISIBLE_ROWS - 1) * BASE_ROW_GAP;

export function resultCardLayout(resultCount: number): ResultCardLayout {
  const count = Math.max(0, Math.floor(resultCount));
  const wide = count > 3;
  const columns: 1 | 2 = wide ? 2 : 1;
  const rows = Math.max(1, Math.ceil(count / columns));

  if (rows <= BASE_VISIBLE_ROWS) {
    return {
      wide,
      columns,
      rows,
      valueSize: BASE_VALUE_SIZE,
      labelSize: BASE_LABEL_SIZE,
      rowGap: BASE_ROW_GAP,
    };
  }

  const rowGap = Math.max(2, BASE_ROW_GAP - (rows - BASE_VISIBLE_ROWS) * 2);
  const valueSize = Math.max(
    12,
    Math.min(
      BASE_VALUE_SIZE,
      (BASE_LIST_HEIGHT - (rows - 1) * rowGap) / (rows * LINE_HEIGHT),
    ),
  );
  const labelSize = Math.max(8.5, BASE_LABEL_SIZE - (rows - BASE_VISIBLE_ROWS) * 0.75);

  return {
    wide,
    columns,
    rows,
    valueSize: Math.round(valueSize * 10) / 10,
    labelSize: Math.round(labelSize * 10) / 10,
    rowGap,
  };
}
