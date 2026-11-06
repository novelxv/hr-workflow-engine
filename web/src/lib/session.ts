"use client";

import useSWR from "swr";

import { fetcher } from "./api";
import type { Me } from "./types";

export function useMe() {
  const { data, error, isLoading } = useSWR<Me>("/auth/me", fetcher, { revalidateOnFocus: false });
  return { me: data, error, isLoading };
}

export const isHr = (me?: Me) => !!me && (me.roles.includes("HR_OPS") || me.roles.includes("ADMIN"));
export const isAdmin = (me?: Me) => !!me && me.roles.includes("ADMIN");
