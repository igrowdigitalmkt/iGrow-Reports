import palette from "./label-colors.json";
// Current WhatsApp Web pill palette, in native protocol order (including reserved indices).
export const WHATSAPP_LABEL_COLORS = palette.map(item => item.dot.toLowerCase());
export const CUSTOM_LABEL_COLORS = WHATSAPP_LABEL_COLORS.filter((_, index) => index !== 0 && index !== 10);
export function labelPillStyle(color: string) {
  const item = palette[labelColorIndex(color)];
  return item ? { "--wai-chip-color": color, "--wai-chip-bg": item.pillBgDark, "--wai-chip-text": item.pillTextDark } : { "--wai-chip-color": color };
}
export const nativeLabelId = (id: string) => /^wa:[0-9]{1,9}$/.test(id) ? id.slice(3) : null;
export function labelColorIndex(color: string) {
  return WHATSAPP_LABEL_COLORS.findIndex(item => item === color.toLowerCase());
}
export function labelChatKey(jid: string) {
  return jid.endsWith("@s.whatsapp.net") ? jid.slice(0, -15) : jid;
}
