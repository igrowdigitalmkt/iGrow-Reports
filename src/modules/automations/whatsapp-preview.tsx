import { Fragment, type ReactNode } from "react";
import { CheckCheck } from "lucide-react";

// WhatsApp formatting: *bold*, _italic_, ~strike~ within a line.
function formatLine(line: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const pattern = /(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~)/g;
  let last = 0;
  for (const match of line.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > last) parts.push(line.slice(last, index));
    const inner = match[0].slice(1, -1);
    const key = `${index}-${match[0]}`;
    parts.push(match[0][0] === "*" ? <strong key={key}>{inner}</strong> : match[0][0] === "_" ? <em key={key}>{inner}</em> : <s key={key}>{inner}</s>);
    last = index + match[0].length;
  }
  if (last < line.length) parts.push(line.slice(last));
  return parts;
}

export function WhatsAppPreview({ text, contact, time, loading }: { text: string; contact: string; time: string; loading?: boolean }) {
  const lines = text.split("\n");
  return <div className="wa-phone" aria-label="Pré-visualização da mensagem no WhatsApp">
    <div className="wa-top"><span className="wa-avatar" aria-hidden="true">{contact.slice(0, 1).toUpperCase()}</span><span><strong>{contact}</strong><small>online</small></span></div>
    <div className="wa-chat">
      <div className={`wa-bubble${loading ? " is-loading" : ""}`}>
        <p>{lines.map((line, index) => <Fragment key={index}>{formatLine(line)}{index < lines.length - 1 && <br />}</Fragment>)}</p>
        <span className="wa-meta">{time}<CheckCheck size={14} /></span>
      </div>
    </div>
  </div>;
}
