/** Shared WhatsApp voice playback speed.
 * One preference across every audio/conversation in this browser, surviving
 * page reloads and synchronized across tabs. This does not store message data. */
export type VoicePlaybackSpeed = 1 | 1.5 | 2;

const STORAGE_KEY = "igrow.whatsapp.voice-speed.v1";
const CHANNEL_NAME = "igrow-whatsapp-voice-speed";
type Listener = () => void;

const listeners = new Set<Listener>();
let speed: VoicePlaybackSpeed = 1;
let loaded = false;
let listeningForStorage = false;
let channel: BroadcastChannel | null = null;

function normalizeSpeed(value: unknown): VoicePlaybackSpeed | null {
  const numeric = typeof value === "number" || typeof value === "string"
    ? Number(value)
    : NaN;
  return numeric === 1 || numeric === 1.5 || numeric === 2 ? numeric : null;
}

function loadStoredSpeed(): void {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    speed = normalizeSpeed(window.localStorage.getItem(STORAGE_KEY)) ?? 1;
  } catch {
    // Browsers that block localStorage can still use this preference per tab.
  }
}

function acceptSpeed(value: unknown): void {
  const next = normalizeSpeed(value);
  if (next === null || speed === next) return;
  speed = next;
  for (const listener of listeners) listener();
}

function listenForChanges(): void {
  if (typeof window === "undefined") return;
  if (!listeningForStorage) {
    listeningForStorage = true;
    window.addEventListener("storage", event => {
      if (event.key === STORAGE_KEY || event.key === null) {
        acceptSpeed(event.newValue === null ? 1 : event.newValue);
      }
    });
  }
  if (channel === null && typeof BroadcastChannel !== "undefined") {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = event => {
      if (event.data?.type === "speed") acceptSpeed(event.data?.value);
    };
  }
}

export function subscribeVoicePlaybackSpeed(listener: Listener): () => void {
  loadStoredSpeed();
  listenForChanges();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getVoicePlaybackSpeed(): VoicePlaybackSpeed {
  loadStoredSpeed();
  return speed;
}

/** Stable server snapshot avoids hydration mismatches with localStorage. */
export function getServerVoicePlaybackSpeed(): VoicePlaybackSpeed {
  return 1;
}

export function setVoicePlaybackSpeed(next: VoicePlaybackSpeed): void {
  loadStoredSpeed();
  if (normalizeSpeed(next) === null || speed === next) return;
  acceptSpeed(next);
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(STORAGE_KEY, String(next)); } catch { /* optional persistence */ }
  listenForChanges();
  channel?.postMessage({ type: "speed", value: next });
}
