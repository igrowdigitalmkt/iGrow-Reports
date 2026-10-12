export type MembershipChange = { id: string; conversationId: string; member: boolean };

/** Serialize native writes while keeping every pending choice visible immediately. */
export class ListMembershipQueue {
  private changes: MembershipChange[] = [];
  private running = false;
  constructor(private callbacks: {
    send: (change: MembershipChange) => Promise<void>;
    pending: (changes: MembershipChange[]) => void;
    confirmed: (change: MembershipChange) => void;
    failed: (message: string) => void;
    idle: (failed: boolean) => void;
  }) {}
  get size() { return this.changes.length; }
  enqueue(change: MembershipChange) {
    this.changes.push(change);
    this.callbacks.pending([...this.changes]);
    void this.drain();
  }
  private async drain() {
    if (this.running) return;
    this.running = true;
    let failed = false;
    while (this.changes.length) {
      const change = this.changes[0];
      try {
        await this.callbacks.send(change);
        this.callbacks.confirmed(change);
      } catch (error) {
        failed = true;
        this.callbacks.failed(error instanceof Error ? error.message : "Não foi possível salvar a seleção.");
      }
      this.changes.shift();
      this.callbacks.pending([...this.changes]);
    }
    this.running = false;
    this.callbacks.idle(failed);
  }
}

export function applyMembershipChanges<T extends { id: string; conversationIds: string[] }>(lists: T[], changes: MembershipChange[]): T[] {
  return lists.map(list => {
    const own = changes.filter(change => change.id === list.id);
    if (!own.length) return list;
    const members = new Set(list.conversationIds);
    for (const change of own) {
      if (change.member) members.add(change.conversationId);
      else members.delete(change.conversationId);
    }
    return { ...list, conversationIds: [...members] };
  });
}
