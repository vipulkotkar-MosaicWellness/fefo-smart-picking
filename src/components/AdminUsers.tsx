import { useEffect, useState } from "react";
import { useAuth } from "../lib/authStore";
import { useStore } from "../lib/store";
import { supabase } from "../lib/supabaseClient";
import type { Profile } from "../lib/authStore";
import { Button, Card, Tag } from "./Ui";

interface Invite {
  email: string;
  display_name: string;
  created_at: string;
}

const ADMIN_ROLE_OPTIONS = ["pending", "planner", "picker"] as const;
const SUPER_ADMIN_ROLE_OPTIONS = ["pending", "super_admin", "admin", "planner", "picker"] as const;

const ROLE_LABELS: Record<string, string> = {
  planner: "Planner / Supervisor",
};

export function AdminUsers() {
  const myRole = useAuth((s) => s.profile?.role);
  const myName = useAuth((s) => s.profile?.display_name ?? "Admin");
  const logAudit = useStore((s) => s.logAudit);
  const isSuperAdmin = myRole === "super_admin";
  const [users, setUsers] = useState<Profile[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);

  async function load() {
    if (!supabase) return;
    setLoading(true);
    const { data } = await supabase.from("profiles").select("id,email,display_name,role").order("email");
    setUsers((data as Profile[]) ?? []);
    if (isSuperAdmin) {
      const { data: inv } = await supabase.from("admin_invites").select("email,display_name,created_at").order("created_at");
      setInvites((inv as Invite[]) ?? []);
    }
    setLoading(false);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function setRole(id: string, role: string) {
    if (!supabase) return;
    const target = users.find((u) => u.id === id);
    setUsers((u) => u.map((x) => (x.id === id ? { ...x, role: role as Profile["role"] } : x)));
    const { error } = await supabase.from("profiles").update({ role }).eq("id", id);
    if (error) {
      alert("Could not update role: " + error.message);
      void load();
    } else if (target) {
      logAudit(myName, `Set ${target.display_name}'s role to ${role.replace("_", " ")}`);
    }
  }

  async function nominateAdmin() {
    if (!supabase || !inviteEmail.trim() || !inviteName.trim()) return;
    setInviteBusy(true);
    const { error } = await supabase.from("admin_invites").insert({
      email: inviteEmail.trim().toLowerCase(),
      display_name: inviteName.trim(),
    });
    setInviteBusy(false);
    if (error) return alert("Could not nominate: " + error.message);
    setInviteName("");
    setInviteEmail("");
    void load();
  }

  async function cancelInvite(email: string) {
    if (!supabase) return;
    await supabase.from("admin_invites").delete().eq("email", email);
    void load();
  }

  const pendingCount = users.filter((u) => u.role === "pending").length;
  const roleOptions = isSuperAdmin ? SUPER_ADMIN_ROLE_OPTIONS : ADMIN_ROLE_OPTIONS;

  return (
    <Card title="Manage users">
      {isSuperAdmin && (
        <div className="mb-4 rounded-lg border border-teal-200 bg-teal-50 p-3 dark:border-teal-800 dark:bg-teal-950/30">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-teal-800 dark:text-teal-300">
            Nominate an Admin
          </p>
          <p className="mb-2 text-[11px] text-slate-500 dark:text-slate-400">
            Enter their name and email now — the moment they sign up with that email, they become an Admin
            automatically. Only you (Super Admin) can do this.
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              value={inviteName}
              onChange={(e) => setInviteName(e.target.value)}
              placeholder="Name"
              className="min-w-32 flex-1 rounded-lg border border-slate-300 p-1.5 text-xs dark:border-slate-600 dark:bg-slate-900"
            />
            <input
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="Email"
              type="email"
              className="min-w-48 flex-1 rounded-lg border border-slate-300 p-1.5 text-xs dark:border-slate-600 dark:bg-slate-900"
            />
            <Button variant="sm" onClick={() => void nominateAdmin()}>
              {inviteBusy ? "Nominating…" : "Nominate"}
            </Button>
          </div>
          {invites.length > 0 && (
            <div className="mt-2 space-y-1">
              {invites.map((inv) => (
                <div key={inv.email} className="flex items-center justify-between rounded-md bg-white px-2 py-1 text-[11px] dark:bg-slate-900">
                  <span><b>{inv.display_name}</b> · {inv.email} <Tag tone="info">awaiting sign-up</Tag></span>
                  <Button variant="sm" onClick={() => void cancelInvite(inv.email)}>Cancel</Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="mb-2 flex items-center justify-between">
        <p className="text-[11px] text-slate-500 dark:text-slate-400">
          {isSuperAdmin
            ? "Assign a role to every signed-up account. New sign-ups start as pending unless pre-nominated above."
            : "You can assign Supervisor or Picker to pending sign-ups. Admin roles are managed by the Super Admin."}
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
            {users.map((u) => {
              const isAdminRow = u.role === "admin" || u.role === "super_admin";
              const editable = isSuperAdmin || !isAdminRow;
              return (
                <tr key={u.id} className="text-slate-700 dark:text-slate-200">
                  <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">{u.display_name}</td>
                  <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">{u.email}</td>
                  <td className="border-b border-slate-100 p-1.5 dark:border-slate-700/60">
                    {editable ? (
                      <select
                        value={u.role}
                        onChange={(e) => void setRole(u.id, e.target.value)}
                        className="rounded border border-slate-300 p-1 text-xs dark:border-slate-600 dark:bg-slate-900"
                      >
                        {roleOptions.map((r) => (
                          <option key={r} value={r}>{ROLE_LABELS[r] ?? r.replace("_", " ")}</option>
                        ))}
                      </select>
                    ) : (
                      <Tag tone="info">{ROLE_LABELS[u.role] ?? u.role.replace("_", " ")}</Tag>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Card>
  );
}
