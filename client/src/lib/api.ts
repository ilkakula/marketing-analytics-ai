const TOKEN_KEY = "spendlens_token";
export const tokenStore = {
  get: () => localStorage.getItem(TOKEN_KEY),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: any) {
    super(message);
  }
}

type Query = Record<string, string | number | undefined | null>;

export async function api<T>(
  path: string,
  opts: { method?: string; json?: unknown; form?: FormData; query?: Query } = {},
): Promise<T> {
  const url = new URL(path, window.location.origin);
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }
  const headers: Record<string, string> = {};
  const token = tokenStore.get();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.json !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(url, {
    method: opts.method ?? (opts.json || opts.form ? "POST" : "GET"),
    headers,
    body: opts.form ?? (opts.json !== undefined ? JSON.stringify(opts.json) : undefined),
  });
  const body = await res.json().catch(() => null);

  if (!res.ok) {
    // Expired/invalid token on a protected route: tell the app to log the user out.
    if (res.status === 401 && token) window.dispatchEvent(new Event("spendlens:unauthorized"));
    const e = body?.error;
    // An import where every row is invalid returns 422, but with the full report in the body.
    if (res.status === 422 && body?.status === "failed") return body as T;
    throw new ApiError(res.status, e?.code ?? "ERROR", e?.message ?? "Something went wrong", e?.details);
  }
  return body as T;
}

/** Downloads a file with the Authorization header (a plain <a href> cannot send the token). */
export async function download(path: string, query: Query): Promise<void> {
  const url = new URL(path, window.location.origin);
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  const res = await fetch(url, { headers: { Authorization: `Bearer ${tokenStore.get()}` } });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(res.status, body?.error?.code ?? "ERROR", body?.error?.message ?? "Export failed");
  }
  const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "spendlens.csv";
  const link = document.createElement("a");
  link.href = URL.createObjectURL(await res.blob());
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
}
