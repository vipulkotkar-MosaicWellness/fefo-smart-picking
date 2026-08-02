import logoUrl from "../../assets/brand/mosaic-wellness.png";

export function MosaicLogo({ compact = false }: { compact?: boolean }) {
  return (
    <img
      src={logoUrl}
      alt="Mosaic Wellness"
      className={compact ? "h-6 w-auto" : "h-8 w-auto"}
    />
  );
}
