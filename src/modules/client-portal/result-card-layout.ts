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

function compactToTwoLines(words: string[], limit: number) {
  if (!words.length) return [];
  const full = words.join(" ");
  if (Array.from(full).length <= limit) return [full];
  if (words.length === 1) {
    const letters = Array.from(words[0]);
    if (letters.length <= limit) return [words[0]];
    return [`${letters.slice(0, limit - 1).join("")}-`, letters.slice(limit - 1).join("")];
  }

  let best: string[] | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let index = 1; index < words.length; index++) {
    const first = words.slice(0, index).join(" ");
    const second = words.slice(index).join(" ");
    const firstLength = Array.from(first).length;
    const secondLength = Array.from(second).length;
    const overflow = Math.max(0, firstLength - limit) + Math.max(0, secondLength - limit);
    const balance = Math.abs(firstLength - secondLength);
    const score = overflow * 100 + balance;
    if (score < bestScore) {
      best = [first, second];
      bestScore = score;
    }
  }

  if (!best) return [];
  return best.map((line) => {
    const letters = Array.from(line);
    return letters.length > limit ? `${letters.slice(0, limit - 1).join("")}-` : line;
  });
}

/** Wrap at word boundaries, balancing real labels into at most two readable lines. */
export function wrapResultLabel(text: string, limit = 18, maxLines = 2): string[] {
  const width = Math.max(2, Math.floor(limit));
  const lineLimit = Math.max(1, Math.floor(maxLines));
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  if (lineLimit === 2) return compactToTwoLines(words, width);

  const lines: string[] = [];
  let current = "";

  for (const word of words) {
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
