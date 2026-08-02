import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import type { Profile } from "../lib/authStore";
import { Card, Tag } from "./Ui";

const ROLE_OPTIONS = ["pending", "admin", "planner", "supervisor", "picker"] as const;

export function AdminUsers() {
  const [users, setUsers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    if (!supabase) return;
    setLoading(true);
    const { data } = await supabase.from("profiles").select("id,email,display_name,role").order("email");
    setUsers((data as Profile[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  async function setRole(id: string, role: string) {
    if (!supabase) return;
    setUsers((u) => u.map((x) => (x.id === id ? { ...x, role: role as Profile["role"] } : x)));
    const { error } = await supabase.from("profiles").update({ role }).eq("id", id);
    if (error) alert("Could not update role: " + error.message);
  }

  const pendingCount = users.filter((u) => u.role === "pending").length;

  return (
    <Card title="Manage users">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          Assign a role to every signed-up account. New sign-ups start as <b>pending</b> until you set their role here.
        </p>
        {pendingCount > 0 && <Tag tone="warn">{pendingCount} pending</Tag>}
      </div>
      {loading ? (
        <p className="py-3 text-center text-xs text-slate-500 dark:text-slate-400">Loading…</p>
      ) : (
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wide text-teal-800 dark:text-teal-300">
              <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">Name</th>
              <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">Email</th>
              <th className="border-b border-slate-200 p-1.5 dark:border-slate-700">Role</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="text-slate-700 dark:text-slate-200">
                <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">{u.display_name}</td>
                <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">{u.email}</td>
                <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">
                  <select
                    value={u.role}
                    onChange={(e) => void setRole(u.id, e.target.value)}
                    className="rounded border border-slate-300 p-1 text-xs dark:border-slate-600 dark:bg-slate-900"
                  >
                    {ROLE_OPTIONS.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}
