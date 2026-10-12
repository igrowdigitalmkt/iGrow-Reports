export type NativeConversationState = {
  pinned: boolean; pinnedAt?: number | null; archived: boolean; markedUnread: boolean;
};
export type NativeConversationChange = { action: "pin" | "archive" | "unread"; value: boolean; expected: boolean };
export function validNativeConversationState(value: unknown): value is NativeConversationState {
  if (!value || typeof value !== "object") return false;
  const state = value as Record<string, unknown>;
  if(state.pinnedAt !== undefined && state.pinnedAt !== null && (!Number.isSafeInteger(state.pinnedAt) || Number(state.pinnedAt)<0)) return false;
  return ["pinned", "archived", "markedUnread"].every(key => typeof state[key] === "boolean");
}
