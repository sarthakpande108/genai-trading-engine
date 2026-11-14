const DEFAULT_ENDPOINT = "https://newsapi.org/v2/everything";

export function normalizeNewsArticles(articles, { maxArticles = 12 } = {}) {
  if (!Array.isArray(articles)) throw new TypeError("articles must be an array");
  return articles.slice(0, maxArticles).map((article, index) => {
    if (!article || typeof article !== "object") throw new TypeError("Invalid news article at index " + index);
    const publishedAt = article.publishedAt;
    if (!publishedAt || !Number.isFinite(Date.parse(publishedAt))) return null;
    return {
      source: String(article.source?.name || article.source || "Unknown source").slice(0, 120),
      title: String(article.title || "").slice(0, 400),
      description: String(article.description || "").slice(0, 1200),
      url: typeof article.url === "string" && /^https:\/\//i.test(article.url) ? article.url : null,
      publishedAt: new Date(publishedAt).toISOString(),
    };
  }).filter((item) => item && item.title);
}

/** Fetch recent company/stock news. API key is sent in a header, not the URL. */
export async function fetchStockNews({
  query, apiKey = process.env.NEWSAPI_KEY, fetchImpl = globalThis.fetch,
  pageSize = 12, from, language = "en", timeoutMs = 12_000,
} = {}) {
  if (typeof query !== "string" || !query.trim()) throw new TypeError("news query is required");
  if (!apiKey) return { status: "unavailable", provider: "NewsAPI", articles: [], warning: "Set NEWSAPI_KEY to enable news context." };
  if (typeof fetchImpl !== "function") throw new TypeError("fetch is not available");
  const params = new URLSearchParams({
    q: query.trim().slice(0, 500), sortBy: "publishedAt",
    pageSize: String(Math.max(1, Math.min(30, Math.floor(pageSize)))),
    language,
  });
  if (from) params.set("from", from);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(DEFAULT_ENDPOINT + "?" + params.toString(), {
      headers: { "X-Api-Key": apiKey, Accept: "application/json" },
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.status !== "ok") {
      throw new Error(body.message || "NewsAPI request failed with HTTP " + response.status);
    }
    return {
      status: "ok", provider: "NewsAPI", fetchedAt: new Date().toISOString(),
      totalResults: Number(body.totalResults || 0),
      articles: normalizeNewsArticles(body.articles || [], { maxArticles: pageSize }),
    };
  } finally {
    clearTimeout(timeout);
  }
}
