import type { Metadata } from "next";
import { Suspense } from "react";

import { ResignationForm } from "./view";

export const metadata: Metadata = { title: "Resign" };

export default function ResignationPage() {
  return (
    <Suspense>
      <ResignationForm />
    </Suspense>
  );
}
