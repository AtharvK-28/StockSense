import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useToast } from "../components/toast";
import { api, errorMessage, qs } from "./api";
import type { Category, LocationOption, ProductRow, Warehouse } from "./types";

export function useLocations() {
  return useQuery({
    queryKey: ["locations"],
    queryFn: () => api<{ items: LocationOption[] }>("/locations").then((r) => r.items),
    staleTime: 60_000,
  });
}

export function useWarehouses() {
  return useQuery({
    queryKey: ["warehouses"],
    queryFn: () => api<{ items: Warehouse[] }>("/warehouses").then((r) => r.items),
    staleTime: 60_000,
  });
}

export function useCategories() {
  return useQuery({
    queryKey: ["categories"],
    queryFn: () => api<{ items: Category[] }>("/categories").then((r) => r.items),
    staleTime: 60_000,
  });
}

export function useProducts(params: Record<string, string | undefined> = {}) {
  return useQuery({
    queryKey: ["products", params],
    queryFn: () => api<{ items: ProductRow[] }>(`/products${qs(params)}`).then((r) => r.items),
    placeholderData: (prev) => prev,
  });
}

/** A mutation that refreshes every query on success and toasts errors. */
export function useAction<TVars, TResult>(fn: (vars: TVars) => Promise<TResult>, opts: { success?: string } = {}) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "me" });
      if (opts.success) toast({ title: opts.success });
    },
    onError: (err) => toast({ title: errorMessage(err), tone: "error" }),
  });
}

export function useDebounced<T>(value: T, delay = 250) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}
