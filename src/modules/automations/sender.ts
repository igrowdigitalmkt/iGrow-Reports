export type MessageDestination = { kind: "phone"; phone: string; label: string } | { kind: "group"; groupId: string; label: string };
export type SendOutcome = { ok: true; messageId?: string | null } | { ok: false; error: string };

/** A channel able to send free text: the agency's own WhatsApp connected by QR Code. */
export interface MessageSender {
  sendText(destination: MessageDestination, text: string): Promise<SendOutcome>;
}

export type DeliveryDetail = { destination: MessageDestination; ok: boolean; messageId: string | null; error: string | null };
export type DeliveryReport = { sent: number; failed: number; errors: string[]; details: DeliveryDetail[] };

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Sends one message per destination, one at a time. The pause between messages keeps the
 * pace of a person typing, which lowers the risk of the number being flagged as automated.
 */
export async function deliverToDestinations(sender: MessageSender, destinations: MessageDestination[], text: string, pause: () => number = () => 4000 + Math.random() * 5000): Promise<DeliveryReport> {
  const report: DeliveryReport = { sent: 0, failed: 0, errors: [], details: [] };
  for (const [index, destination] of destinations.entries()) {
    if (index > 0) await wait(pause());
    try {
      const outcome = await sender.sendText(destination, text);
      if (outcome.ok) { report.sent += 1; report.details.push({ destination, ok: true, messageId: outcome.messageId ?? null, error: null }); }
      else { report.failed += 1; report.errors.push(`${destination.label}: ${outcome.error}`); report.details.push({ destination, ok: false, messageId: null, error: outcome.error }); }
    } catch {
      report.failed += 1;
      report.errors.push(`${destination.label}: falha de comunicação com o WhatsApp`);
      report.details.push({ destination, ok: false, messageId: null, error: "falha de comunicação com o WhatsApp" });
    }
  }
  return report;
}

export function runStatus(report: { sent: number; failed: number; errors?: string[] }) {
  if (!report.failed) return "sent" as const;
  return report.sent ? "partial" as const : "failed" as const;
}
