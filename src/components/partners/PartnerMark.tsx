import { useState } from "react";
import { getPartnerMark, type PartnerLogoState } from "../../lib/partners";

// Deterministic color per partner name so the initials chip stays readable
// and distinct without needing per-partner design work.
function colorFor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  return `hsl(${hue}, 45%, 34%)`;
}

export function PartnerMark({
  name,
  logoPath = null,
  logoApproved = false,
  compact = false,
}: Partial<PartnerLogoState> & { name: string; compact?: boolean }) {
  const mark = getPartnerMark({ name, logoPath, logoApproved });
  const [broken, setBroken] = useState(false);

  return (
    <span className="inline-flex items-center gap-1.5 align-middle" aria-label={compact ? name : undefined}>
      {mark.logoUrl && !broken ? (
        <img
          src={mark.logoUrl}
          alt={name}
          className={compact ? "h-5 w-5 rounded object-contain" : "h-6 w-6 rounded object-contain"}
          onError={() => setBroken(true)}
        />
      ) : (
        <span
          aria-hidden={!compact}
          style={{ background: colorFor(name) }}
          className={`flex items-center justify-center rounded text-[9px] font-extrabold tracking-wide text-white ${
            compact ? "h-5 w-5" : "h-6 w-6"
          }`}
        >
          {mark.fallback}
        </span>
      )}
      {!compact && <b className="text-xs font-semibold">{mark.name}</b>}
    </span>
  );
}
