import { useState, type FormEvent } from "react";
import { useAuth } from "../lib/authStore";
import { Button } from "./Ui";

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full items-center justify-center bg-slate-100 p-4 dark:bg-slate-900">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <h1 className="mb-1 text-lg font-bold text-teal-800 dark:text-teal-300">FEFO Smart Picking</h1>
        {children}
      </div>
    </div>
  );
}

function Field({ label, ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="mb-3 block text-xs font-semibold text-slate-500 dark:text-slate-400">
      {label}
      <input
        {...props}
        className="mt-1 w-full rounded-lg border border-slate-300 p-2 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
      />
    </label>
  );
}

export function AuthGate() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [signedUp, setSignedUp] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    const msg = mode === "signin" ? await signIn(email, password) : await signUp(email, password, name);
    setBusy(false);
    if (msg) setErr(msg);
    else if (mode === "signup") setSignedUp(true);
  }

  if (signedUp) {
    return (
      <Shell>
        <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
          Account created for <b>{email}</b>. You're signed in — an <b>Admin</b> needs to assign your role
          (Planner / Supervisor / Picker) before you can use the app.
        </p>
      </Shell>
    );
  }

  return (
    <Shell>
      <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">{mode === "signin" ? "Sign in to your account" : "Create your account"}</p>
      <form onSubmit={submit}>
        {mode === "signup" && (
          <Field label="Your name" value={name} onChange={(e) => setName(e.target.value)} required />
        )}
        <Field label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <Field label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
        {err && <p className="mb-3 text-xs font-semibold text-rose-600 dark:text-rose-400">{err}</p>}
        <Button>{busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}</Button>
      </form>
      <button
        onClick={() => { setMode(mode === "signin" ? "signup" : "signin"); setErr(""); }}
        className="mt-4 text-xs font-semibold text-teal-700 hover:underline dark:text-teal-300"
      >
        {mode === "signin" ? "New here? Create an account" : "Already have an account? Sign in"}
      </button>
    </Shell>
  );
}

export function PendingApproval({ email }: { email: string }) {
  const { signOut } = useAuth();
  return (
    <Shell>
      <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">
        Signed in as <b>{email}</b>. Your account is waiting for an <b>Admin</b> to assign your role
        (Planner / Supervisor / Picker) before you can use the app.
      </p>
      <div className="mt-4"><Button variant="sm" onClick={() => void signOut()}>Sign out</Button></div>
    </Shell>
  );
}
