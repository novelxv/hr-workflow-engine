import type { Metadata } from "next";
import { Suspense } from "react";

import { RequestsView } from "./view";

export const metadata: Metadata = { title: "Requests" };

export default function RequestsPage() {
  return (
    <Suspense>
      <RequestsView />
    </Suspense>
  );
}
