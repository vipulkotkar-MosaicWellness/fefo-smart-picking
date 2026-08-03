// Local, per-device queue for pick confirmations that couldn't reach
// Supabase (offline, or a transient network failure). Flushed automatically
// once the browser comes back online — see startOfflineFlush() in App.tsx.

const KEY = "fefo-pick-offline-queue-v1";

export interface QueuedPick {
  id: string;
  facilityNo: string;
  results: Record<number, number>;
  queuedAt: string;
}

export function loadQueue(): QueuedPick[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as QueuedPick[]) : [];
  } catch {
    return [];
  }
}

function save(queue: QueuedPick[]): void {
  localStorage.setItem(KEY, JSON.stringify(queue));
}

export function enqueue(item: { facilityNo: string; results: Record<number, number> }): QueuedPick {
  const queued: QueuedPick = { ...item, id: `${item.facilityNo}-${Date.now()}`, queuedAt: new Date().toISOString() };
  save([...loadQueue(), queued]);
  return queued;
}

export function dequeue(id: string): void {
  save(loadQueue().filter((q) => q.id !== id));
}
