import { CHANNEL_BUCKETS } from "./channels";
import { supabase } from "./supabaseClient";
import type { PickingTask } from "./types";

interface TaskRow {
  no: string;
  channel: string;
  bucket: string;
  created_at: string;
  data: PickingTask;
}

/**
 * Every task. Paged past PostgREST's silent 1000-row default the same way
 * fetchStock() in supabaseStock.ts is — without this, once the tasks table
 * passes 1000 rows the rows quietly dropped are the NEWEST ones (this orders
 * created_at ascending), so today's picklists vanish from every screen at
 * once with no error anywhere.
 */
export async function fetchAllTasks(): Promise<PickingTask[]> {
  if (!supabase) return [];
  const page = 1000;
  const all: TaskRow[] = [];
  for (let from = 0; ; from += page) {
    const { data, error } = await supabase
      .from("tasks")
      .select("data,created_at")
      .order("created_at", { ascending: true })
      .range(from, from + page - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    all.push(...(data as unknown as TaskRow[]));
    if (data.length < page) break;
  }
  return all.map((r) => r.data);
}

/**
 * One task, straight from Supabase — used right before a write to get a
 * current copy to patch, instead of trusting whatever's been sitting in
 * this browser's memory since its last full load. See
 * mergeOwnChangesOntoFreshTask in store.ts for why.
 */
export async function fetchTaskByNo(no: string): Promise<PickingTask | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from("tasks").select("data").eq("no", no).maybeSingle();
  if (error) throw error;
  return data ? (data as unknown as TaskRow).data : null;
}

/** First-ever save of a new task — sets created_by, never touched again. */
export async function insertTask(task: PickingTask, createdBy: string | null): Promise<void> {
  if (!supabase) return;
  const bucket = CHANNEL_BUCKETS[task.channel] ?? "Replenishment";
  const { error } = await supabase.from("tasks").insert({ no: task.no, channel: task.channel, bucket, created_by: createdBy, data: task });
  if (error) throw error;
}

/** Any later change (assignment, picks, round-2) — only the data blob moves. */
export async function updateTaskData(task: PickingTask): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.from("tasks").update({ data: task }).eq("no", task.no);
  if (error) throw error;
}

/** How many tasks already exist with this Bucket-Channel-Date prefix, for numbering. */
export async function nextSequence(prefix: string): Promise<number> {
  if (!supabase) return 1;
  const { count, error } = await supabase
    .from("tasks")
    .select("no", { count: "exact", head: true })
    .like("no", `${prefix}%`);
  if (error) throw error;
  return (count ?? 0) + 1;
}

/** Live updates: fires with the fresh task whenever ANY user inserts/updates one. */
export function subscribeTasks(onChange: (task: PickingTask) => void): () => void {
  if (!supabase) return () => {};
  const client = supabase;
  const channel = client
    .channel("tasks-realtime")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "tasks" },
      (payload) => {
        const row = (payload.new ?? payload.old) as { data?: PickingTask } | null;
        if (row?.data) onChange(row.data);
      },
    )
    .subscribe();
  return () => {
    void client.removeChannel(channel);
  };
}
