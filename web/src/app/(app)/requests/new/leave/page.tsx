import type { Metadata } from "next";
import { Suspense } from "react";

import { LeaveForm } from "./view";

export const metadata: Metadata = { title: "Request leave" };

export default function LeavePage() {
  return (
    <Suspense>
      <LeaveForm />
    </Suspense>
  );
}
