import type { MessageTemplateSegment } from "@/types/database";
import type { TemplateChannel } from "@/modules/automations/message";

export type SavedTemplate = { id: string; name: string; segment: MessageTemplateSegment; channel: TemplateChannel; subject: string | null; body: string; updatedAt: string };
export type TemplatesSnapshot = { ready: boolean; channelsReady: boolean; items: SavedTemplate[] };
