"use client";

import { useRouter } from "next/navigation";
import { useRef } from "react";
import { DEFAULT_BRAND_NAME } from "@/lib/brand";

/**
 * The C5 easter egg trigger: 5 clicks on the sidebar brand glyph within 3s
 * opens /bureau. Wraps children without changing their look — the button reads
 * as the plain brand mark (default cursor, no focus ring theatrics).
 */
export function BrandEgg({
  children,
  label = DEFAULT_BRAND_NAME,
}: {
  children: React.ReactNode;
  /** Accessible name of the brand button — the tenant's product name. */
  label?: string;
}) {
  const router = useRouter();
  const clicksRef = useRef<number[]>([]);

  const onClick = () => {
    const now = Date.now();
    const recent = clicksRef.current.filter((t) => now - t < 3000);
    recent.push(now);
    if (recent.length >= 5) {
      clicksRef.current = [];
      router.push("/bureau");
      return;
    }
    clicksRef.current = recent;
  };

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="block cursor-default select-none text-left"
    >
      {children}
    </button>
  );
}
