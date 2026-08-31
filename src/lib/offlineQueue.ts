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

// Same pattern, separate key, for a gate pass number that couldn't reach
// Supabase — see setFacilityGatePass in store.ts. Kept as its own queue
// rather than folded into QueuedPick above so neither shape has to change
// (anything already sitting in someone's browser from before this existed
// keeps working untouched).
const GP_KEY = "fefo-gatepass-offline-queue-v1";

export interface QueuedGatePass {
  id: string;
  taskNo: string;
  facilityNo: string;
  gatePassNo: string;
  queuedAt: string;
}

export function loadGatePassQueue(): QueuedGatePass[] {
  try {
    const raw = localStorage.getItem(GP_KEY);
    return raw ? (JSON.parse(raw) as QueuedGatePass[]) : [];
  } catch {
    return [];
  }
}

function saveGatePassQueue(queue: QueuedGatePass[]): void {
  localStorage.setItem(GP_KEY, JSON.stringify(queue));
}

export function enqueueGatePass(item: { taskNo: string; facilityNo: string; gatePassNo: string }): QueuedGatePass {
  const queued: QueuedGatePass = { ...item, id: `${item.facilityNo}-${Date.now()}`, queuedAt: new Date().toISOString() };
  saveGatePassQueue([...loadGatePassQueue(), queued]);
  return queued;
}

export function dequeueGatePass(id: string): void {
  saveGatePassQueue(loadGatePassQueue().filter((q) => q.id !== id));
}
