import type { Metadata } from "next";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui";
import { RequestDetail } from "./view";

export const metadata: Metadata = { title: "Request" };

export default function RequestPage() {
  return (
    <Suspense fallback={<Skeleton className="h-72" />}>
      <RequestDetail />
    </Suspense>
  );
}
