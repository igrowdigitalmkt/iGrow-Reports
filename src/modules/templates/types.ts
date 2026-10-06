import type { MessageTemplateSegment } from "@/types/database";

export type SavedTemplate = { id: string; name: string; segment: MessageTemplateSegment; body: string; updatedAt: string };
export type TemplatesSnapshot = { ready: boolean; items: SavedTemplate[] };
