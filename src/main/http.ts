export const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";
const API_UA = "Nukun/1.0 (application de lecture personnelle)";

interface GetOpts {
  timeoutMs?: number;
  browser?: boolean;
  headers?: Record<string, string>;
  retries?: number;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    public url: string,
  ) {
    super(`HTTP ${status} pour ${url}`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function get(url: string, opts: GetOpts = {}): Promise<Response> {
  const retries = opts.retries ?? 2;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 30000);
    try {
      const res = await fetch(url, {
        redirect: "follow",
        signal: ctrl.signal,
        headers: { "User-Agent": opts.browser ? BROWSER_UA : API_UA, ...opts.headers },
      });
      if (res.ok) return res;
      lastErr = new HttpError(res.status, url);
      // Only retry on rate limits and server errors.
      if (res.status !== 429 && res.status < 500) throw lastErr;
      const retryAfter = Number(res.headers.get("retry-after"));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 20) * 1000 : 1500 * (attempt + 1));
    } catch (e) {
      if (e instanceof HttpError && e.status !== 429 && e.status < 500) throw e;
      lastErr = e;
      await sleep(1000 * (attempt + 1));
    } finally {
      clearTimeout(t);
    }
  }
  throw lastErr;
}

export async function getText(url: string, opts?: GetOpts) {
  return (await get(url, opts)).text();
}

export async function getJson<T = any>(url: string, opts?: GetOpts): Promise<T> {
  return (await get(url, { ...opts, headers: { Accept: "application/json", ...opts?.headers } })).json() as Promise<T>;
}

/** Message shown when a site answers with an anti-robot page instead of the document. */
export const BLOCKED_MESSAGE =
  "Le site de l'article bloque les téléchargements automatiques (protection anti-robot). Ouvre-le sur le site d'origine.";

/**
 * Does this address give a real PDF? Some archives put an anti-robot page in front
 * of their files: the app does not get around it, it only avoids offering what it
 * cannot open. One answer per site and per refresh is enough.
 */
const pdfSiteOk = new Map<string, { ok: boolean; at: number }>();
export async function pdfReachable(url: string): Promise<boolean> {
  const host = new URL(url).host;
  const known = pdfSiteOk.get(host);
  if (known && Date.now() - known.at < 30 * 60000) return known.ok;
  let ok = false;
  try {
    const res = await get(url, { browser: true, retries: 0, timeoutMs: 20000 });
    ok = !/text\/html/i.test(res.headers.get("content-type") ?? "");
    await res.body?.cancel();
  } catch {
    ok = false;
  }
  pdfSiteOk.set(host, { ok, at: Date.now() });
  return ok;
}

export async function getBuffer(url: string, opts?: GetOpts) {
  return new Uint8Array(await (await get(url, opts)).arrayBuffer());
}

export function isoDaysAgo(days: number) {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
}

export function stripTags(html: string) {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#8217;|&rsquo;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/\s+/g, " ")
    .trim();
}
