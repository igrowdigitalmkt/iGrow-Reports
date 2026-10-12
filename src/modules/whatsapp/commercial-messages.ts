export type CommercialButton = { label: string; href?: string };
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" ? value as Record<string, unknown> : {};
const label = (value: unknown) => typeof value === "string" && value.trim() ? value.trim().slice(0, 120) : null;
export function safeCommercialUrl(value: unknown) {
  if (typeof value !== "string" || value.length > 2000) return undefined;
  try { const url = new URL(value); return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : undefined; }
  catch { return undefined; }
}
export function commercialButtons(message: unknown): CommercialButton[] {
  const root = record(message), template = record(root.templateMessage);
  const hydrated = record(template.hydratedTemplate ?? template.hydratedFourRowTemplate);
  if (hydrated.maskLinkedDevices === true) return [];
  if (!Array.isArray(hydrated.hydratedButtons)) return [];
  return hydrated.hydratedButtons.slice(0, 8).flatMap(value => {
    const button = record(value), content = record(button.urlButton ?? button.quickReplyButton ?? button.callButton);
    const name = label(content.displayText);
    if (!name) return [];
    const href = safeCommercialUrl(content.url);
    return [{ label: name, ...(href ? { href } : {}) }];
  });
}
export function commercialButtonsFromRef(value: unknown): CommercialButton[] {
  const ref = record(value), data = record(ref.data);
  if (ref.type !== "templateMessage" || !Array.isArray(data.buttons)) return [];
  return data.buttons.slice(0, 8).flatMap(value => {
    const button = record(value), name = label(button.label), href = safeCommercialUrl(button.href);
    return name ? [{ label: name, ...(href ? { href } : {}) }] : [];
  });
}
