export type NativeConversationState = {
  pinned: boolean; archived: boolean; markedUnread: boolean;
};
export type NativeConversationChange = { action: "pin" | "archive" | "unread"; value: boolean; expected: boolean };
export function validNativeConversationState(value: unknown): value is NativeConversationState {
  if (!value || typeof value !== "object") return false;
  const state = value as Record<string, unknown>;
  return ["pinned", "archived", "markedUnread"].every(key => typeof state[key] === "boolean");
}
