import {expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {EvolutionClient} from "@/modules/whatsapp-qr/evolution";
it("uses installed native contact, poll and sticker contracts and verifies their message id",async()=>{
  const fetcher=vi.fn(async()=>new Response(JSON.stringify({key:{id:"native"}}),{status:201}));const client=new EvolutionClient({url:"https://evo.test",key:"secret"},fetcher);
  expect(await client.sendExtended("agency","5586999999999",{type:"contact",name:"Contato",phone:"5586888888888"})).toBe("native");
  await client.sendExtended("agency","1@g.us",{type:"poll",name:"Pergunta",options:["Um","Dois"],multiple:true});
  await client.sendExtended("agency","1@lid",{type:"sticker",base64:"YWJj"});
  const bodies=fetcher.mock.calls.map(call=>JSON.parse(String((call as unknown as [string,RequestInit])[1].body)));
  expect(bodies[0]).toEqual({number:"5586999999999",contact:[{fullName:"Contato",wuid:"5586888888888",phoneNumber:"+5586888888888"}]});expect(bodies[1]).toEqual({number:"1@g.us",name:"Pergunta",values:["Um","Dois"],selectableCount:2});expect(bodies[2]).toEqual({number:"1@lid",sticker:"YWJj",notConvertSticker:true});
  fetcher.mockImplementation(async()=>new Response("{}"));await expect(client.sendExtended("agency","5586999999999",{type:"contact",name:"Contato",phone:"5586888888888"})).rejects.toThrow("não confirmou");
});
