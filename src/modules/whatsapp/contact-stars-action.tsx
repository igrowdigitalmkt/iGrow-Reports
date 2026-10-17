"use client";
import {useEffect,useState} from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {Star} from "lucide-react";
import {WhatsAppEmojiText} from "./whatsapp-emoji";
import {kindLabel,listTime} from "./inbox-format";
type Favorite={id:string;body:string|null;kind:string;sentAt:string};
export function ContactStarsAction({conversationId,demo,onPick}:{conversationId:string;demo:boolean;onPick:(id:string)=>void}) {
  const [open,setOpen]=useState(false);const [items,setItems]=useState<Favorite[]|null>(null);const [error,setError]=useState("");
  useEffect(()=>{
    if(!open || demo)return;
    const controller=new AbortController();
    fetch(`/api/whatsapp/inbox/starred?conversationId=${encodeURIComponent(conversationId)}`,{cache:"no-store",signal:controller.signal}).then(async response=>{
      const body=await response.json() as {items?:Favorite[];error?:string};
      if(!response.ok || !Array.isArray(body.items))throw Error(body.error || "Favoritos indisponíveis.");
      if(!controller.signal.aborted)setItems(body.items);
    }).catch(failure=>{if(!controller.signal.aborted)setError(failure instanceof Error?failure.message:"Favoritos indisponíveis.");});
    return()=>controller.abort();
  },[open,demo,conversationId]);
  return <Dialog.Root open={open} onOpenChange={value=>{setOpen(value);if(value){setItems(null);setError("");}}}><Dialog.Trigger asChild><button type="button"><Star size={26}/><span>Mensagens favoritas</span></button></Dialog.Trigger><Dialog.Portal><Dialog.Overlay className="wai-extra-overlay"/><Dialog.Content className="wai-extra-dialog">
    <Dialog.Title>Mensagens favoritas</Dialog.Title><Dialog.Description>Favoritos privados do Groow Ads nesta conversa. Até 200 itens disponíveis.</Dialog.Description>
    {error?<p role="alert">{error}</p>:!items && !demo?<p role="status">Carregando…</p>:!(items?.length)?<p>Nenhuma mensagem favorita.</p>:<div className="wai-contact-favorites">{items.map(item=><button type="button" key={item.id} onClick={()=>{setOpen(false);onPick(item.id);}}><WhatsAppEmojiText text={item.body || kindLabel(item.kind)}/><small>{listTime(item.sentAt)}</small></button>)}</div>}
    <footer><Dialog.Close asChild><button type="button">Fechar</button></Dialog.Close></footer>
  </Dialog.Content></Dialog.Portal></Dialog.Root>;
}
