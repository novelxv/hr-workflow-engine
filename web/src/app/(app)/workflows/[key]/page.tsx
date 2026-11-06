import type { Metadata } from "next";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui";
import { WorkflowDetail } from "./view";

export const metadata: Metadata = { title: "Workflow" };

export default function WorkflowPage() {
  return (
    <Suspense fallback={<Skeleton className="h-72" />}>
      <WorkflowDetail />
    </Suspense>
  );
}
