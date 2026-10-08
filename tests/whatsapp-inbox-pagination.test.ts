import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

vi.mock("server-only", () => ({}));

import { loadInbox } from "@/modules/whatsapp/inbox-read";

function fakeInbox(rows: number, archivedIndices: number[]) {
  const archived = new Set(archivedIndices);
  const dataset = Array.from({ length: rows }, (_, i) => ({
    id: `conversation-${i}`,
    agency_id: "agency-1",
    channel_key: "qr",
    remote_id: `group-${i}@g.us`,
    is_group: true,
    title: `Grupo ${i}`,
    client_id: null,
    favorite: false,
    archived: archived.has(i),
    unread_count: 0,
    last_message_at: null,
    last_message_preview: null,
    last_message_direction: null,
    last_message_kind: null,
    last_message_status: null,
    last_inbound_at: null,
  }));

  const queriedRanges: Array<[number, number]> = [];
  const chain = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    range: async (from: number, to: number) => {
      queriedRanges.push([from, to]);
      return { data: dataset.slice(from, to + 1), error: null };
    },
  };
  const service = { from: () => chain } as unknown as SupabaseClient<Database>;
  return { service, queriedRanges };
}

describe("WhatsApp inbox after full QR history sync", () => {
  it("includes the last archived group after 499 synced conversations", async () => {
    const { service, queriedRanges } = fakeInbox(499, [480, 498]);
    const result = await loadInbox(service, "agency-1");
    expect(result.ready).toBe(true);
    expect(result.conversations).toHaveLength(499);
    expect(result.conversations.filter(row => row.archived)).toHaveLength(2);
    expect(result.conversations.at(-1)?.archived).toBe(true);
    expect(queriedRanges).toEqual([[0, 999]]);
  });

  it("paginates past PostgREST's 1000-row cap without losing archived chats", async () => {
    const { service, queriedRanges } = fakeInbox(1_250, [1_249]);
    const result = await loadInbox(service, "agency-1");
    expect(result.ready).toBe(true);
    expect(result.conversations).toHaveLength(1_250);
    expect(result.conversations.at(-1)?.archived).toBe(true);
    expect(queriedRanges).toEqual([[0, 999], [1000, 1999]]);
  });
});
