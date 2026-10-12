type Reference = {external_id:string;direction:"in"|"out";sent_at:string;participant_jid?:string|null};
/** Include outgoing messages through the last received message, newest first. */
export function conversationMessageRange(rows: Reference[], group: boolean) {
  const received=rows.findIndex(row=>row.direction==="in");
  if(received<0)return null;
  const range=rows.slice(0,received+1);
  if(range.some(row=>!row.external_id||!Number.isFinite(Date.parse(row.sent_at))||(group&&row.direction==="in"&&!row.participant_jid)))return null;
  return range.map(row=>({key:{id:row.external_id,fromMe:row.direction==="out",...(row.participant_jid?{participant:row.participant_jid}:{})},messageTimestamp:Math.floor(Date.parse(row.sent_at)/1000)}));
}
