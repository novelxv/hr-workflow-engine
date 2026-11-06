import type { Metadata } from "next";
import { Suspense } from "react";

import { AnalyticsView } from "./view";

export const metadata: Metadata = { title: "Process analytics" };

export default function AnalyticsPage() {
  return (
    <Suspense>
      <AnalyticsView />
    </Suspense>
  );
}
