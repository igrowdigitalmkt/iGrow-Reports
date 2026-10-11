import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
const client=vi.fn();
vi.mock("@/lib/supabase/service",()=>({createSupabaseServiceClient:client}));
import { GET } from "@/app/api/cron/whatsapp-retention/route";
afterEach(()=>{vi.unstubAllEnvs();vi.clearAllMocks();});
it("preserves all history even when an old deployment enables retention",async()=>{
  const secret="a".repeat(40);
  vi.stubEnv("CRON_SECRET",secret);vi.stubEnv("WHATSAPP_RETENTION_ENABLED","true");
  const response=await GET(new Request("https://example.test/api/cron/whatsapp-retention",{headers:{authorization:`Bearer ${secret}`}}));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({enabled:false,removed:0,reason:"history_preservation"});
  expect(client).not.toHaveBeenCalled();
});
it("still rejects unauthorized maintenance calls",async()=>{
  vi.stubEnv("CRON_SECRET","a".repeat(40));
  expect((await GET(new Request("https://example.test/api/cron/whatsapp-retention"))).status).toBe(401);
  expect(client).not.toHaveBeenCalled();
});
