import { readFileSync } from "node:fs";
const content=readFileSync(".env.production.local","utf8");
for(const line of content.split(/\r?\n/)){
 const match=/^([A-Za-z_][\w]*)=(.*)$/.exec(line);
 if(match) process.env[match[1]]=match[2].replace(/^["']|["']$/g,"");
}
const base=process.env.NEXT_PUBLIC_SUPABASE_URL;
const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!base||!key){console.log("SUPABASE_ENV_MISSING");process.exit(1);}
const signal=AbortSignal.timeout(12000);
const started=Date.now();
try{
 const res=await fetch(base+"/rest/v1/whatsapp_conversations?select=id&limit=1",{
  headers:{"apikey":key,"Authorization":"Bearer "+key},signal
 });
 console.log("REST",res.status,"MS",Date.now()-started,"BODY",(await res.text()).slice(0,100));
}catch(error){console.log("REST_ERROR",error.message,"MS",Date.now()-started);}
