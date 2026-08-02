/** Initials fallback for a partner with no approved logo, e.g. "Blinkit" -> "BL", "TATA 1MG" -> "T1". */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return (words[0] ?? "").slice(0, 2).toUpperCase();
}

export interface PartnerLogoState {
  name: string;
  /** Path to a locally stored asset only — never a remote/hotlinked URL. */
  logoPath: string | null;
  logoApproved: boolean;
}

export interface PartnerMark {
  name: string;
  fallback: string;
  /** Only set when a locally stored logo has been explicitly approved. */
  logoUrl: string | null;
}

/**
 * Never renders a logo that hasn't been approved (requirement: no implied
 * partnership from an unreviewed asset), and never exposes `logoPath` as a
 * URL directly — approval is the only gate between the two.
 */
export function getPartnerMark(partner: PartnerLogoState): PartnerMark {
  return {
    name: partner.name,
    fallback: initials(partner.name),
    logoUrl: partner.logoApproved && partner.logoPath ? partner.logoPath : null,
  };
}
