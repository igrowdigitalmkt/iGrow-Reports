import { expect, it, vi } from "vitest";
import { ListMembershipQueue, applyMembershipChanges, type MembershipChange } from "@/modules/whatsapp/list-membership-queue";

it("accepts consecutive clicks immediately but sends only one native write at a time", async () => {
  const releases: Array<() => void> = [];
  const sent: MembershipChange[] = [];
  let pending: MembershipChange[] = [];
  let lists = [{ id: "a", conversationIds: [] as string[] }, { id: "b", conversationIds: [] as string[] }];
  const idle = vi.fn();
  const queue = new ListMembershipQueue({
    send: change => { sent.push(change); return new Promise<void>(resolve => releases.push(resolve)); },
    pending: changes => { pending = changes; },
    confirmed: change => { lists = applyMembershipChanges(lists, [change]); },
    failed: vi.fn(), idle,
  });
  queue.enqueue({ id: "a", conversationId: "chat", member: true });
  queue.enqueue({ id: "b", conversationId: "chat", member: true });
  queue.enqueue({ id: "a", conversationId: "chat", member: false });
  expect(sent).toHaveLength(1);
  expect(applyMembershipChanges(lists, pending).map(list => list.conversationIds)).toEqual([[], ["chat"]]);
  releases.shift()!(); await Promise.resolve();
  expect(sent).toHaveLength(2);
  // An earlier confirmation cannot overwrite a newer pending uncheck.
  expect(applyMembershipChanges(lists, pending)[0].conversationIds).toEqual([]);
  releases.shift()!(); await Promise.resolve();
  releases.shift()!(); await Promise.resolve();
  expect(lists.map(list => list.conversationIds)).toEqual([[], ["chat"]]);
  expect(queue.size).toBe(0);
  expect(idle).toHaveBeenCalledOnce();
});

it("rolls back a refused choice and continues saving the next choice", async () => {
  const failed = vi.fn();
  let pending: MembershipChange[] = [];
  let lists = [{ id: "a", conversationIds: [] as string[] }, { id: "b", conversationIds: [] as string[] }];
  const idle = vi.fn();
  const queue = new ListMembershipQueue({
    send: async change => { if (change.id === "a") throw Error("Recusado"); },
    pending: changes => { pending = changes; },
    confirmed: change => { lists = applyMembershipChanges(lists, [change]); }, failed, idle,
  });
  queue.enqueue({ id: "a", conversationId: "chat", member: true });
  queue.enqueue({ id: "b", conversationId: "chat", member: true });
  await Promise.resolve(); await Promise.resolve();
  expect(applyMembershipChanges(lists, pending).map(list => list.conversationIds)).toEqual([[], ["chat"]]);
  expect(failed).toHaveBeenCalledWith("Recusado");
  expect(idle).toHaveBeenCalledWith(true);
});
