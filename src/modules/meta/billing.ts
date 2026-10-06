// "Saldo disponível (R$1.234,56 BRL)" or "Available balance (R$1,234.56 BRL)" → 1234.56
export function parseFundingAmount(text: string | null | undefined): number | null {
  const match = text?.match(/(\d[\d.,\s]*)\s*[A-Z]{3}\)?\s*$/);
  if (!match) return null;
  const raw = match[1].replace(/\s/g, "");
  const last = Math.max(raw.lastIndexOf(","), raw.lastIndexOf("."));
  const decimals = last >= 0 && raw.length - last - 1 === 2;
  const integer = (decimals ? raw.slice(0, last) : raw).replace(/[.,]/g, "");
  const value = Number(decimals ? `${integer}.${raw.slice(last + 1)}` : integer);
  return Number.isFinite(value) ? value : null;
}
