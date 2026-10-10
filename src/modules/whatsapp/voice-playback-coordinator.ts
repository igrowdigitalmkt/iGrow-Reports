/**
 * Exactly one active voice note per browser tab, regardless of conversation.
 * The active note alone replaces its avatar with the playback-speed button.
 * A BroadcastChannel also stops playback in other tabs of the same origin.
 *
 * Deliberately tracks ephemeral playback ownership, not message history.
 * No message, contact or media identifiers are transmitted across tabs.
 */
type AudioOwner = { token: symbol; pause: () => void };
type Subscriber = () => void;

const subscribers = new Set<Subscriber>();
let active: AudioOwner | null = null;
let channel: BroadcastChannel | null = null;

function notify(): void {
  for (const subscriber of subscribers) subscriber();
}

function stopLocal(): void {
  const previous = active;
  active = null;
  previous?.pause();
  if (previous) notify();
}

function ensureChannel(): BroadcastChannel | null {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return null;
  if (!channel) {
    channel = new BroadcastChannel("igrow-whatsapp-voice-playback");
    channel.onmessage = event => {
      if (event.data?.type === "claim") stopLocal();
    };
  }
  return channel;
}

/** useSyncExternalStore-compatible. */
export function subscribeVoicePlayback(callback: Subscriber): () => void {
  subscribers.add(callback);
  ensureChannel();
  return () => subscribers.delete(callback);
}

export function getActiveVoiceToken(): symbol | null {
  return active?.token ?? null;
}

/** Take over playback, pausing any previous note in the same tab or other tabs. */
export function claimVoicePlayback(token: symbol, pause: () => void): void {
  if (active?.token === token) return;
  const previous = active;
  active = { token, pause };
  previous?.pause();
  notify();
  ensureChannel()?.postMessage({ type: "claim" });
}

/** Unmount / failed loading / expired media: return avatar for this note. */
export function releaseVoicePlayback(token: symbol): void {
  if (active?.token !== token) return;
  active = null;
  notify();
}

/** Stops all playback in the current browser tab (used on logout/navigation). */
export function stopVoicePlayback(): void {
  stopLocal();
}
