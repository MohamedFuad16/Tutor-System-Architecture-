export type WebSearchMode = "search" | "news";

export type NormalizedWebSource = {
  id: string;
  type: WebSearchMode;
  sourceType?: "web" | "image";
  title: string;
  url: string;
  domain: string;
  faviconUrl: string;
  snippet: string;
  date?: string;
  position: number;
  imageUrl?: string;
  thumbnailUrl?: string;
  imageWidth?: number;
  imageHeight?: number;
  imageSource?: string;
};

type SearchOptions = {
  query: string;
  mode?: WebSearchMode;
  maxResults?: number;
  signal?: AbortSignal;
  apiKey?: string;
};

const SERPER_ENDPOINTS: Record<WebSearchMode, string> = {
  search: "https://google.serper.dev/search",
  news: "https://google.serper.dev/news",
};

const CACHE_TTL_MS = 10 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 8000;
const MAX_ATTEMPTS = 2;
// Cap the number of cached queries so a long-lived host doesn't grow this Map
// once per unique (mode, key, query, maxResults) combination forever.
const MAX_CACHE_ENTRIES = 500;
const cache = new Map<
  string,
  { expiresAt: number; results: NormalizedWebSource[] }
>();

// Drop expired entries, then enforce the size cap by evicting oldest-first
// (Map preserves insertion order). Called on every write.
const pruneCache = () => {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
};

const abortError = () =>
  new DOMException("The operation was aborted.", "AbortError");

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const stableId = (value: string) => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(i)) | 0;
  }
  return `src_${Math.abs(hash).toString(36)}`;
};

const canonicalUrl = (url: string) => {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.searchParams.delete("utm_source");
    parsed.searchParams.delete("utm_medium");
    parsed.searchParams.delete("utm_campaign");
    parsed.searchParams.delete("utm_term");
    parsed.searchParams.delete("utm_content");
    return parsed.toString();
  } catch {
    return url;
  }
};

const domainFromUrl = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "source";
  }
};

const faviconForDomain = (domain: string) =>
  `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;

const optionalString = (...values: unknown[]) => {
  for (const value of values) {
    const text = String(value || "").trim();
    if (text) return text;
  }
  return undefined;
};

const normalizeRows = (
  payload: any,
  mode: WebSearchMode,
  maxResults: number,
) => {
  const rows = [
    ...(Array.isArray(payload?.organic) ? payload.organic : []),
    ...(Array.isArray(payload?.news) ? payload.news : []),
    ...(Array.isArray(payload?.topStories) ? payload.topStories : []),
  ];
  const seen = new Set<string>();
  const results: NormalizedWebSource[] = [];

  rows.forEach((row: any, index: number) => {
    const rawUrl = row.link || row.url || row.sourceUrl;
    const title = String(row.title || "").trim();
    if (!rawUrl || !title) return;

    const url = canonicalUrl(String(rawUrl));
    if (seen.has(url)) return;
    seen.add(url);

    const domain = domainFromUrl(url);
    const imageUrl = optionalString(row.imageUrl, row.image, row.thumbnailUrl);
    const thumbnailUrl = optionalString(row.thumbnailUrl, row.thumbnail);
    results.push({
      id: stableId(`${mode}:${url}`),
      type: mode,
      sourceType: "web",
      title,
      url,
      domain,
      faviconUrl: faviconForDomain(domain),
      snippet: String(
        row.snippet || row.summary || row.description || "",
      ).trim(),
      date: row.date || row.publishedAt || undefined,
      position: Number(row.position || index + 1),
      ...(imageUrl ? { imageUrl } : {}),
      ...(thumbnailUrl ? { thumbnailUrl } : {}),
    });
  });

  const imageRows = Array.isArray(payload?.images) ? payload.images : [];
  imageRows.forEach((row: any, index: number) => {
    const imageUrl = optionalString(row.imageUrl, row.image, row.thumbnailUrl);
    const rawUrl = optionalString(row.link, row.url, row.sourceUrl, imageUrl);
    const title = optionalString(row.title, row.source, "Image result");
    if (!rawUrl || !imageUrl || !title) return;

    const url = canonicalUrl(String(rawUrl));
    if (seen.has(url)) return;
    seen.add(url);

    const domain = domainFromUrl(url);
    results.push({
      id: stableId(`${mode}:image:${url}:${imageUrl}`),
      type: mode,
      sourceType: "image",
      title,
      url,
      domain,
      faviconUrl: faviconForDomain(domain),
      snippet: String(
        row.snippet ||
          row.summary ||
          row.description ||
          row.source ||
          "Image result from web search.",
      ).trim(),
      date: row.date || row.publishedAt || undefined,
      position: Number(row.position || results.length + index + 1),
      imageUrl,
      thumbnailUrl: optionalString(row.thumbnailUrl, row.thumbnail) || imageUrl,
      imageWidth: Number(row.imageWidth || row.width || 0) || undefined,
      imageHeight: Number(row.imageHeight || row.height || 0) || undefined,
      imageSource: optionalString(row.source, row.domain),
    });
  });

  const imageResults = results.filter(
    (source) => source.sourceType === "image",
  );
  if (imageResults.length > 0 && maxResults > 1) {
    const imageBudget = Math.min(2, imageResults.length, maxResults);
    const webBudget = Math.max(0, maxResults - imageBudget);
    const webResults = results
      .filter((source) => source.sourceType !== "image")
      .slice(0, webBudget);
    return [...webResults, ...imageResults.slice(0, imageBudget)];
  }

  return results.slice(0, maxResults);
};

export function detectFreshnessSearch(
  text: string,
): { query: string; mode: WebSearchMode } | null {
  const value = text.toLowerCase();
  const sourceMaterialRequest =
    /\b(current|this|the)\s+(page|screen|document|pdf|chapter|section|slide|image|diagram|chart|figure)\b/.test(
      value,
    ) ||
    /\b(what'?s|what is|explain|summari[sz]e|describe)\s+(this|the)\b/.test(
      value,
    ) ||
    /\b(on the screen|visible|shown|source material|uploaded document|reading)\b/.test(
      value,
    );
  const explicitExternal =
    /\b(search|browse|google|look up)\s+(the\s+)?(web|internet|online)\b/.test(
      value,
    ) ||
    /\b(web search|internet search|search online|from the web|on the web)\b/.test(
      value,
    );
  if (sourceMaterialRequest && !explicitExternal) return null;

  const explicit =
    explicitExternal || /\b(search the web|browse the web)\b/.test(value);
  const fresh =
    /\b(latest|recent|today|yesterday|this week|this month|right now|breaking|news|trend|trending|pricing|price|release|released|ranking|rankings|best .*20\d{2}|who won|score|game|election|weather)\b/.test(
      value,
    ) ||
    /\bcurrent\s+(price|pricing|version|release|model|news|weather|score|ranking|rankings|ceo|president|law|rule|schedule)\b/.test(
      value,
    );
  if (!explicit && !fresh) return null;
  const mode: WebSearchMode =
    /\b(news|today|headline|headlines|happened)\b/.test(value)
      ? "news"
      : "search";
  return { query: text.trim().slice(0, 240), mode };
}

export async function searchSerper(
  options: SearchOptions,
): Promise<NormalizedWebSource[]> {
  const query = options.query.trim();
  const mode = options.mode || "search";
  const maxResults = Math.min(Math.max(options.maxResults || 6, 1), 10);
  const key = options.apiKey || process.env.SERPER_API_KEY;
  if (!key) throw new Error("SERPER_API_KEY is not configured.");
  if (!query) return [];

  const apiKeyFingerprint = stableId(key);
  const cacheKey = `${mode}:${apiKeyFingerprint}:${query.toLowerCase()}:${maxResults}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.results;
  if (cached) cache.delete(cacheKey);

  if (options.signal?.aborted) throw abortError();

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const abortListener = () => controller.abort();
    options.signal?.addEventListener("abort", abortListener, { once: true });

    try {
      const response = await fetch(SERPER_ENDPOINTS[mode], {
        method: "POST",
        headers: {
          "X-API-KEY": key,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ q: query, num: maxResults }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`SERPER ${mode} failed with ${response.status}`);
      }

      const payload = await response.json();
      const results = normalizeRows(payload, mode, maxResults);
      cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, results });
      pruneCache();
      return results;
    } catch (error) {
      if (options.signal?.aborted) throw error;
      lastError = error;
      if (attempt < MAX_ATTEMPTS) await wait(250 * attempt);
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abortListener);
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("SERPER search failed.");
}

export function formatSourcesForPrompt(sources: NormalizedWebSource[]) {
  if (sources.length === 0) return "No web sources were returned.";
  return sources
    .map((source, index) => {
      const date = source.date ? ` | ${source.date}` : "";
      const kind = source.sourceType === "image" ? "image" : "web";
      const image = source.imageUrl ? ` | image: ${source.imageUrl}` : "";
      return `[${index + 1}] ${source.title} | ${source.domain} | ${kind}${date} | ${source.snippet} | ${source.url}${image}`;
    })
    .join("\n");
}
