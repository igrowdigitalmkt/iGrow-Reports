"use client";
import {useEffect,useRef,useState} from "react";
import * as Dialog from "@radix-ui/react-dialog";
export function CameraDialog({onClose,onCapture}:{onClose:()=>void;onCapture:(file:File)=>void}) {
  const activeCapture=useRef(true);
  const video=useRef<HTMLVideoElement>(null);const stream=useRef<MediaStream|null>(null);const [ready,setReady]=useState(false);const [error,setError]=useState("");
  useEffect(()=>{
    let active=true;activeCapture.current=true;
    if(!navigator.mediaDevices?.getUserMedia)return;
    navigator.mediaDevices.getUserMedia({video:{facingMode:"environment",width:{ideal:1280},height:{ideal:720}},audio:false}).then(media=>{
      if(!active){media.getTracks().forEach(track=>track.stop());return;}
      stream.current=media;if(video.current)video.current.srcObject=media;
    }).catch(()=>{if(active)setError("Não foi possível acessar a câmera. Verifique a permissão do navegador.");});
    return()=>{active=false;activeCapture.current=false;stream.current?.getTracks().forEach(track=>track.stop());stream.current=null;};
  },[]);
  function capture() {
    const source=video.current;if(!ready || !source?.videoWidth)return;
    const canvas=document.createElement("canvas");canvas.width=source.videoWidth;canvas.height=source.videoHeight;
    const context=canvas.getContext("2d");if(!context)return;context.drawImage(source,0,0);
    canvas.toBlob(blob=>{if(!activeCapture.current)return;if(!blob){setError("Não foi possível capturar a foto.");return;}onCapture(new File([blob],"Foto.jpg",{type:"image/jpeg"}));onClose();},"image/jpeg",.85);
  }
  return <Dialog.Root open onOpenChange={open=>{if(!open)onClose();}}><Dialog.Portal><Dialog.Overlay className="wai-extra-overlay"/><Dialog.Content className="wai-extra-dialog">
    <Dialog.Title>Câmera</Dialog.Title><Dialog.Description>Capture uma foto e confira antes de enviar.</Dialog.Description>
    <video ref={video} autoPlay playsInline muted onLoadedData={()=>setReady(true)} aria-label="Prévia da câmera"/>
    {(error || (typeof navigator==="undefined" || !navigator.mediaDevices?.getUserMedia)) && <p role="alert">{error || "A câmera não está disponível neste navegador."}</p>}<footer><button type="button" onClick={onClose}>Cancelar</button><button type="button" disabled={!ready} onClick={capture}>Capturar foto</button></footer>
  </Dialog.Content></Dialog.Portal></Dialog.Root>;
}
