import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

/**
 * Subscribes to the server's change stream (Server-Sent Events). Any stock or document change —
 * from this tab, another tab, or a colleague — refreshes the data on screen.
 */
export function useLiveUpdates() {
  const qc = useQueryClient();
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const source = new EventSource("/api/events", { withCredentials: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.addEventListener("change", () => {
      clearTimeout(timer);
      timer = setTimeout(() => qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "me" }), 120);
    });
    return () => {
      clearTimeout(timer);
      source.close();
    };
  }, [qc]);

  return connected;
}
