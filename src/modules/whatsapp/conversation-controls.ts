export type NativeConversationState = {
  pinned: boolean; archived: boolean; markedUnread: boolean; favorite: boolean; favoritesSupported: boolean;
  favoritesReadable?: boolean;
};
export type NativeConversationChange = { action: "pin" | "archive" | "unread" | "favorite"; value: boolean; expected: boolean };
export function validNativeConversationState(value: unknown): value is NativeConversationState {
  if (!value || typeof value !== "object") return false;
  const state = value as Record<string, unknown>;
  if(state.favoritesReadable !== undefined && typeof state.favoritesReadable !== "boolean") return false;
  return ["pinned", "archived", "markedUnread", "favorite", "favoritesSupported"].every(key => typeof state[key] === "boolean");
}
