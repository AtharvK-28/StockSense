export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public issues?: { path: string; message: string }[],
  ) {
    super(message);
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
}

export async function api<T>(path: string, { method = "GET", body, signal }: RequestOptions = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      signal,
      credentials: "include",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new ApiError("Can't reach the StockSense server. Is it running?", 0);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith("/auth/")) window.dispatchEvent(new Event("stocksense:unauthorized"));
    throw new ApiError(data?.error ?? `Request failed (${res.status})`, res.status, data?.issues);
  }
  return data as T;
}

/** Builds a query string, skipping empty values. */
export function qs(params: Record<string, string | number | boolean | null | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "" && value !== false) search.set(key, String(value));
  }
  const s = search.toString();
  return s ? `?${s}` : "";
}

export function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : "Something went wrong";
}
