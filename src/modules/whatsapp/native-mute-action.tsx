"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import * as Dialog from "@radix-ui/react-dialog";
import {Bell} from "lucide-react";
export function NativeMuteAction({conversationId,enabled,demo,menu=false}:{conversationId:string;enabled:boolean;demo:boolean;menu?:boolean}) {
  const [state,setState]=useState<{muted:boolean;until:number|null}|null>(null);const [error,setError]=useState("");
  const [open,setOpen]=useState(false);const [choice,setChoice]=useState<"8h"|"7d"|"always"|"off">("8h");const [busy,setBusy]=useState(false);const latch=useRef(false);
  const load=useCallback(async(signal?:AbortSignal)=>{
    try {const response=await fetch(`/api/whatsapp/inbox/${conversationId}/mute`,{cache:"no-store",signal});const body=await response.json();
      if(!response.ok || typeof body.muted!=="boolean" || !(body.until===null || Number.isSafeInteger(body.until)))throw Error("Estado indisponível.");
      if(!signal?.aborted){setState(body);setError("");}
    }catch{if(!signal?.aborted){setState(null);setError("Não foi possível consultar o silenciamento.");}}
  },[conversationId]);
  useEffect(()=>{if(demo)return;const controller=new AbortController();void Promise.resolve().then(()=>{if(!controller.signal.aborted)return load(controller.signal);});return()=>controller.abort();},[load,demo]);
  async function save() {
    if(!state || latch.current)return;latch.current=true;setBusy(true);setError("");
    try {const response=await fetch(`/api/whatsapp/inbox/${conversationId}/mute`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({duration:choice,expectedMuted:state.muted,expectedUntil:state.until})});
      const body=await response.json();if(!response.ok || typeof body.muted!=="boolean")throw Error(body.error || "Sem confirmação.");
      setState(body);setOpen(false);
    }catch(failure){setError(failure instanceof Error?failure.message:"Sem confirmação.");setState(null);}
    finally{latch.current=false;setBusy(false);}
  }
  return <Dialog.Root open={open} onOpenChange={value=>{if(!latch.current){setOpen(value);if(value)setChoice(state?.muted?"off":"8h");}}}><Dialog.Trigger asChild><button type="button" role={menu?"menuitem":undefined} disabled={demo || !enabled || !state}><Bell size={menu?18:26}/><span>{menu && state?.muted?"Reativar notificações":"Silenciar notificações"}</span>{!menu && <span className={`wai-mute-switch${state?.muted?" is-on":""}`} role="img" aria-label={state ? state.muted?"Ativado":"Desativado":"Indisponível"}/>}</button></Dialog.Trigger>
    {error && !open && <p className="wai-block-status" role="alert">{error} <button type="button" onClick={()=>void load()}>Atualizar</button></p>}
    <Dialog.Portal><Dialog.Overlay className="wai-extra-overlay"/><Dialog.Content className="wai-extra-dialog" onEscapeKeyDown={event=>{if(busy)event.preventDefault();}} onPointerDownOutside={event=>{if(busy)event.preventDefault();}}>
      <Dialog.Title>Silenciar notificações</Dialog.Title><Dialog.Description>A configuração será atualizada no WhatsApp conectado.</Dialog.Description>
      <fieldset disabled={busy || !state}><legend>Duração</legend>{([["8h","8 horas"],["7d","1 semana"],["always","Sempre"],["off","Desativar"]] as const).map(([value,label])=><label key={value} className="wai-extra-check"><input type="radio" name="mute-duration" checked={choice===value} onChange={()=>setChoice(value)}/>{label}</label>)}</fieldset>
      {error && <p role="alert">{error}</p>}<footer><Dialog.Close asChild><button type="button" disabled={busy}>Cancelar</button></Dialog.Close><button type="button" disabled={busy || !state} aria-busy={busy} onClick={()=>void save()}>Salvar</button></footer>
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root>;
}
