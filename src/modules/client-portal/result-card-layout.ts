export type ResultCardLayout = {
  cardSpan: 2 | 4 | 5;
  columns: 1 | 2;
  rows: number;
  valueSize: number;
  labelSize: number;
};

const BASE_VALUE_SIZE = 23;
const COMPACT_LABEL_SIZE = 10.5;
const WIDE_LABEL_SIZE = 10.5;

/** Wrap at word boundaries, hyphenating only words longer than a line. */
export function wrapResultLabel(text: string, limit = 25): string[] {
  const width = Math.max(2, Math.floor(limit));
  const lines: string[] = [];
  let current = "";

  for (const word of text.trim().split(/\s+/).filter(Boolean)) {
    let remaining = Array.from(word);
    if (remaining.length > width) {
      if (current) lines.push(current);
      current = "";
      while (remaining.length > width) {
        lines.push(`${remaining.slice(0, width - 1).join("")}-`);
        remaining = remaining.slice(width - 1);
      }
    }
    const next = remaining.join("");
    const candidate = current ? `${current} ${next}` : next;
    if (Array.from(candidate).length <= width) {
      current = candidate;
    } else {
      lines.push(current);
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}

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
