// WhatsApp's 20 label colors, in protocol order. Native label IDs never use local list UUIDs.
export const WHATSAPP_LABEL_COLORS = ["#ff9485", "#64c4ff", "#ffd429", "#dfaef0", "#99b6c1", "#55ccb3", "#ff9dff", "#d3a91d", "#6d7cce", "#d7e752", "#00d0e2", "#ffc5c7", "#93ceac", "#f74848", "#00a0f2", "#83e422", "#ffaf04", "#b5ebff", "#9ba6ff", "#9368cf"];
export const nativeLabelId = (id: string) => /^wa:[0-9]{1,9}$/.test(id) ? id.slice(3) : null;
export function labelColorIndex(color: string) {
  return WHATSAPP_LABEL_COLORS.findIndex(item => item === color.toLowerCase());
}
export function labelChatKey(jid: string) {
  return jid.endsWith("@s.whatsapp.net") ? jid.slice(0, -15) : jid;
}
