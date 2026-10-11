"use client";

import {useRef, useState} from "react";
import {ArrowLeft, Contact, Delete} from "lucide-react";
import {formatWhatsAppPhone} from "./inbox-format";
import "./phone-panel.css";

const keys=[["1",""],["2","ABC"],["3","DEF"],["4","GHI"],["5","JKL"],["6","MNO"],["7","PQRS"],["8","TUV"],["9","WXYZ"],["+",""],["0",""],["delete",""]];

export function PhonePanel({onClose,onPick}:{onClose:()=>void;onPick:(contact:{phone:string;name:null;clientName:null})=>void}) {
 const [value,setValue]=useState("");
 const input=useRef<HTMLInputElement>(null);
 const digits=value.replace(/\D/g,"");
 const phone=value.startsWith("+") ? digits : digits.length===10 || digits.length===11 ? `55${digits}` : digits;
 const valid=/^[1-9]\d{9,14}$/.test(phone) && (value.startsWith("+") || digits.length>=10);
 function pressDigit(key:string){
  const field=input.current;if(!field)return;
  const start=field.selectionStart ?? value.length,end=field.selectionEnd ?? start;
  const from=key==="delete" && start===end ? Math.max(0,start-1) : start;
  const inserted=key==="delete" ? "" : key;
  const next=value.slice(0,from)+inserted+value.slice(end);
  if(!/^\+?\d{0,15}$/.test(next))return;
  setValue(next);field.focus();
  requestAnimationFrame(()=>field.setSelectionRange(from+inserted.length,from+inserted.length));
 }
 function open(){if(valid)onPick({phone,name:null,clientName:null});}
 return <section className="wai-new wai-phone-panel" aria-label="Telefone" onKeyDown={event=>{if(event.key==="Escape"){event.preventDefault();onClose();}}}>
  <header className="wai-phone-head"><button type="button" className="wai-icon-button" onClick={onClose} aria-label="Voltar para nova conversa"><ArrowLeft size={26}/></button><h2>Telefone</h2></header>
  <form onSubmit={event=>{event.preventDefault();open();}}>
   <input ref={input} autoFocus type="tel" inputMode="tel" autoComplete="off" aria-label="Telefone" placeholder="Telefone" value={value} maxLength={16} onChange={event=>{const clean=event.target.value.replace(/[\s().-]/g,"");if(/^\+?\d{0,15}$/.test(clean))setValue(clean);}}/>
   <p className="wai-phone-instruction">Insira um número de telefone para iniciar uma conversa</p>
   {valid && <button type="submit" className="wai-phone-result"><span className="wai-avatar is-icon"><Contact size={24}/></span><span>Conversar com {formatWhatsAppPhone(phone)}</span></button>}
  </form>
  <div className="wai-phone-keypad" role="group" aria-label="Teclado numérico">
   {keys.map(([key,letters])=><button key={key} type="button" aria-label={key==="delete"?"Apagar último dígito":key} onMouseDown={event=>event.preventDefault()} onClick={()=>pressDigit(key)}>{key==="delete"?<Delete size={25}/>:<><span>{key}</span>{letters && <small>{letters}</small>}</>}</button>)}
  </div>
 </section>;
}
