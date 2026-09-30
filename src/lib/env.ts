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

