import { z } from "zod";

const publicSupabaseSchema = z.object({
  url: z.url().refine((value) => {
    try { return ["https:", "http:"].includes(new URL(value).protocol); }
    catch { return false; }
  }),
  publishableKey: z.string().min(1).refine((value) => {
    if (value.startsWith("sb_publishable_")) return true;
    // Legacy anon keys remain supported; privileged JWTs must never reach a browser.
    try {
      const payload = JSON.parse(atob(value.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      return payload.role === "anon";
    } catch {
      return false;
    }
  }),
});

export function getSupabaseConfig() {
  const result = publicSupabaseSchema.safeParse({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
  return result.success ? result.data : null;
}

export function isDemoEnabled() {
  if (process.env.ENABLE_DEMO !== undefined) return process.env.ENABLE_DEMO === "true";
  return process.env.NODE_ENV !== "production";
}


const privilegedSchema = z.object({
  url: z.url(),
  serviceRoleKey: z.string().min(20),
});

const metaConfigSchema = z.object({
  apiVersion: z.string().regex(/^v\d+\.\d+$/),
});

function decodeEncryptionKey(value: string): Buffer | null {
  try {
    const raw = /^[0-9a-fA-F]{64}$/.test(value)
      ? Buffer.from(value, "hex")
      : Buffer.from(value, "base64");
    return raw.length === 32 ? raw : null;
  } catch {
    return null;
  }
}

export function getPrivilegedSupabaseConfig() {
  const result = privilegedSchema.safeParse({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  });
  return result.success ? result.data : null;
}

export function getEncryptionConfig() {
  const keyId = process.env.ENCRYPTION_KEY_ID?.trim();
  const encodedKey = process.env.ENCRYPTION_KEY?.trim();
  if (!keyId || !encodedKey) return null;
  const key = decodeEncryptionKey(encodedKey);
  return key ? { key, keyId } : null;
}

export function getMetaApiConfig() {
  const result = metaConfigSchema.safeParse({
    apiVersion: process.env.META_GRAPH_API_VERSION,
  });
  return result.success ? result.data : null;
}
