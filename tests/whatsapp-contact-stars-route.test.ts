import {expect,it,vi} from "vitest";
import {createClient} from "@supabase/supabase-js";
const context=vi.hoisted(()=>vi.fn());vi.mock("@/modules/agencies/context",()=>({requireAgencyContext:context}));
import {GET} from "@/app/api/whatsapp/inbox/starred/route";
it("filters the contact and revoked messages inside the starred query before limiting results",async()=>{
 const urls:URL[]=[];const methods:string[]=[];const client=createClient("https://db.test","key",{global:{fetch:async(request,init)=>{urls.push(new URL(String(request)));methods.push(init?.method ?? "GET");return Response.json([]);}}});
 context.mockResolvedValue({supabase:client,agency:{id:"agency"},user:{id:"user"}});
 const id="00000000-0000-4000-8000-000000000001";expect((await GET(new Request("https://app.test?conversationId="+id))).status).toBe(200);
 expect(urls[0].searchParams.get("select")).toContain("whatsapp_messages!inner");expect(urls[0].searchParams.get("whatsapp_messages.conversation_id")).toBe("eq."+id);expect(urls[0].searchParams.get("whatsapp_messages.revoked_at")).toBe("is.null");expect(urls[0].searchParams.get("agency_id")).toBe("eq.agency");expect(urls[0].searchParams.get("user_id")).toBe("eq.user");expect(methods).toEqual(["GET"]);
});
