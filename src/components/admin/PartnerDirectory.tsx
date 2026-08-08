import type { ChangeEvent } from "react";
import { useAuth } from "../../lib/authStore";
import { useStore } from "../../lib/store";
import { PartnerMark } from "../partners/PartnerMark";
import { Button, Card, Tag } from "../Ui";

export function PartnerDirectory() {
  const { channelRules, partnerActive, partnerLogos, setPartnerActive, setPartnerLogo, approvePartnerLogo, logAudit } = useStore();
  const myName = useAuth((s) => s.profile?.display_name ?? "Admin");
  const channels = Object.keys(channelRules).sort();

  function onUpload(channel: string, e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      // Stored as a data URL — locally, in this browser. Never fetched from
      // or written to any remote host, and never shown as the partner's
      // logo until a separate Approve action confirms it.
      setPartnerLogo(channel, String(reader.result));
      logAudit(myName, `Uploaded a logo for ${channel} (pending approval)`);
    };
    reader.readAsDataURL(file);
  }

  function toggleActive(channel: string) {
    const next = !(partnerActive[channel] ?? true);
    setPartnerActive(channel, next);
    logAudit(myName, `${next ? "Activated" : "Deactivated"} ${channel}`);
  }

  function approve(channel: string) {
    approvePartnerLogo(channel, true);
    logAudit(myName, `Approved the logo for ${channel}`);
  }

  return (
    <Card title="Partner directory">
      <p className="mb-2 text-[11px] text-slate-500 dark:text-slate-400">
        Logos are stored locally in this browser and never shown until explicitly approved — uploading one never
        implies a formal partnership on its own.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {channels.map((c) => {
          const active = partnerActive[c] ?? true;
          const logo = partnerLogos[c];
          return (
            <div key={c} className="rounded-lg border border-slate-200 p-2.5 dark:border-slate-700">
              <div className="flex items-center justify-between gap-2">
                <PartnerMark name={c} logoPath={logo?.dataUrl ?? null} logoApproved={logo?.approved ?? false} />
                <Tag tone={active ? "ok" : "muted"}>{active ? "Active" : "Inactive"}</Tag>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <Button variant="sm" onClick={() => toggleActive(c)}>
                  {active ? "Deactivate" : "Activate"}
                </Button>
                <label className="cursor-pointer rounded-lg border border-slate-300 px-2 py-1 text-[11px] dark:border-slate-600">
                  Upload logo
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/svg+xml"
                    className="hidden"
                    onChange={(e) => onUpload(c, e)}
                  />
                </label>
                {logo && !logo.approved && (
                  <>
                    <Tag tone="warn">Pending approval</Tag>
                    <Button variant="sm" onClick={() => approve(c)}>
                      Approve
                    </Button>
                  </>
                )}
                {logo?.approved && <Tag tone="ok">Logo approved</Tag>}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
