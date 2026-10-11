"use client";
import { useEffect,useRef,useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { EmojiInput } from "./emoji-input";
import { extendedSendSchema } from "./extended-send";
import { normalizePairingPhone } from "@/modules/whatsapp-qr/format";
export function ExtraSendDialog({type,conversationId,demo,onClose,onSent}:{type:"contact"|"poll"|"sticker";conversationId:string;demo:boolean;onClose:()=>void;onSent:()=>void}) {
  const [name,setName]=useState("");const [phone,setPhone]=useState("");const [options,setOptions]=useState(["",""]);const [multiple,setMultiple]=useState(false);
  const [busy,setBusy]=useState(false);const [uncertain,setUncertain]=useState(false);const [error,setError]=useState("");const latch=useRef(false);
  const [image,setImage]=useState<{base64:string;mime:string}|null>(null);const generation=useRef(0);
  useEffect(()=>()=>{generation.current++;},[]);
  async function readImage(file:File|undefined) {
    const current=++generation.current;setImage(null);setError("");
    if(!file)return;
    if(!["image/png","image/jpeg","image/webp"].includes(file.type) || file.size>400000 || file.size===0){setError("Escolha uma imagem PNG, JPEG ou WebP de até 400 KB.");return;}
    const reader=new FileReader();reader.onload=()=>{if(generation.current===current)setImage({mime:file.type,base64:String(reader.result).split(",")[1]});};reader.onerror=()=>{if(generation.current===current)setError("Não foi possível abrir a imagem.");};reader.readAsDataURL(file);
  }
  async function send() {
    if(latch.current || uncertain)return;
    const payload=extendedSendSchema.safeParse(type==="sticker"?{type,base64:image?.base64 ?? ""}:type==="poll"?{type,name,options,multiple}:{type,name,phone:normalizePairingPhone(phone) ?? ""});
    if(!payload.success){setError(type==="sticker"?"Escolha uma imagem para criar a figurinha.":type==="poll"?"Informe a pergunta e entre 2 e 12 opções diferentes.":"Informe o nome e um telefone válido com código do país.");return;}
    if(demo){setError("Na demonstração nenhuma mensagem é enviada.");return;}
    latch.current=true;setBusy(true);setError("");
    try {
      const response=await fetch(`/api/whatsapp/inbox/${conversationId}/send-extra`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload.data)});
      const result=await response.json().catch(()=>({})) as {error?:string};
      if(!response.ok){if(response.status>=500)setUncertain(true);setError(result.error ?? "Não foi possível confirmar o envio.");return;}
      onSent();onClose();
    }catch{setUncertain(true);setError("Sem confirmação do envio. Confira a conversa antes de tentar novamente.");}
    finally{latch.current=false;setBusy(false);}
  }
  return <Dialog.Root open onOpenChange={open=>{if(!open && !latch.current)onClose();}}><Dialog.Portal><Dialog.Overlay className="wai-extra-overlay"/><Dialog.Content className="wai-extra-dialog" onEscapeKeyDown={event=>{if(busy)event.preventDefault();}} onPointerDownOutside={event=>{if(busy)event.preventDefault();}}>
    <Dialog.Title>{type==="sticker"?"Nova figurinha":type==="poll"?"Criar enquete":"Enviar contato"}</Dialog.Title>
    <Dialog.Description>{type==="sticker"?"Escolha uma imagem para criar e enviar uma figurinha.":type==="poll"?"A enquete será enviada no WhatsApp desta conversa.":"O cartão compartilha este nome e telefone no WhatsApp. Não altera a agenda."}</Dialog.Description>
    <form onSubmit={event=>{event.preventDefault();void send();}}>
      {type!=="sticker" && <label>{type==="poll"?"Pergunta":"Nome"}<EmojiInput value={name} onChange={setName} label={type==="poll"?"Pergunta":"Nome do contato"} multiline={false} disabled={busy} maxLength={200}/></label>}
      {type==="sticker" ? <><label>Imagem<input type="file" accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={event=>void readImage(event.target.files?.[0])}/></label>{image && <div className="wai-sticker-preview">
        {/* eslint-disable-next-line @next/next/no-img-element -- local file preview, never fetched remotely */}
        <img src={`data:${image.mime};base64,${image.base64}`} alt="Prévia da figurinha"/>
      </div>}</> : type==="contact" ? <label>Telefone<input value={phone} onChange={event=>setPhone(event.target.value)} type="tel" placeholder="+55…" disabled={busy} maxLength={25}/></label> : <>
        {options.map((option,index)=><label key={index}>Opção {index+1}<EmojiInput value={option} onChange={value=>setOptions(previous=>previous.map((item,i)=>i===index?value:item))} label={`Opção ${index+1}`} multiline={false} disabled={busy} maxLength={200}/></label>)}
        <div className="wai-extra-option-controls"><button type="button" disabled={busy || options.length>=12} onClick={()=>setOptions(previous=>[...previous,""])}>Adicionar opção</button><button type="button" disabled={busy || options.length<=2} onClick={()=>setOptions(previous=>previous.slice(0,-1))}>Remover última opção</button></div>
        <label className="wai-extra-check"><input type="checkbox" checked={multiple} onChange={event=>setMultiple(event.target.checked)} disabled={busy}/>Permitir várias respostas</label>
      </>}
      {error && <p role="alert">{error}</p>}
      <footer><button type="button" disabled={busy} onClick={onClose}>Cancelar</button><button type="submit" disabled={busy || uncertain} aria-busy={busy}>{busy?"Enviando…":"Enviar"}</button></footer>
    </form>
  </Dialog.Content></Dialog.Portal></Dialog.Root>;
}
