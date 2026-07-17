"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Refreshes the server component every 3 s while a job status is `*ING`. */
export function RefreshPoller() {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(t);
  }, [router]);
  return null;
}
