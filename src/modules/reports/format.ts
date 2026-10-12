// Formatação pt-BR compartilhada pelo PDF e pelos fatos da IA.
export const int = (value: number) => Math.round(value).toLocaleString("pt-BR");
export const dec = (value: number, digits = 2) => value.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
export const money = (value: number, currency: string | null) => `${currency && currency !== "BRL" ? `${currency} ` : "R$ "}${dec(value)}`;
export const pct = (value: number | null) => value == null ? null : `${value > 0 ? "+" : ""}${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
export const share = (value: number | null) => value == null ? null : `${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
export const brDate = (value: string) => value.split("-").reverse().join("/");
export const shortDate = (value: string) => value.split("-").reverse().slice(0, 2).join("/");
