// Small monoline icons, no external dependency — mirrors the header icon language from the UI/UX reference mockups.
import type { SVGProps } from "react";

export function BellIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M6 8a6 6 0 0 1 12 0c0 4.5 1.5 6 2 6.5H4c.5-.5 2-2 2-6.5Z" />
      <path d="M9.5 17a2.5 2.5 0 0 0 5 0" />
    </svg>
  );
}

export function GearIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 13a7.5 7.5 0 0 0 0-2l1.9-1.5-2-3.4-2.3.6a7.6 7.6 0 0 0-1.7-1L14.9 3h-3.8l-.4 2.7a7.6 7.6 0 0 0-1.7 1l-2.3-.6-2 3.4L6.6 11a7.5 7.5 0 0 0 0 2l-1.9 1.5 2 3.4 2.3-.6c.5.4 1.1.8 1.7 1l.4 2.7h3.8l.4-2.7c.6-.2 1.2-.6 1.7-1l2.3.6 2-3.4-1.9-1.5Z" />
    </svg>
  );
}

export function SearchIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}
