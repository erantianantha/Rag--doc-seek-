export interface SearchResult {
  title: string;
  url: string;
  content: string;
}

/**
 * Scrapes DuckDuckGo HTML interface to retrieve top 4 search results.
 * This is used as a free fallback when no Tavily API Key is provided.
 */
export async function scrapeDuckDuckGo(query: string): Promise<SearchResult[]> {
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });

    if (!res.ok) {
      throw new Error(`DuckDuckGo request failed: ${res.status} ${res.statusText}`);
    }

    const html = await res.text();
    const results: SearchResult[] = [];

    // Split page by result classes
    const blocks = html.split('<div class="result results_links');
    
    // Index 0 is before the first search result, skip it
    for (let i = 1; i < blocks.length; i++) {
      const block = blocks[i];

      // Extract Title and URL
      // Pattern: <a class="result__a" href="URL">TITLE</a>
      const aMatch = block.match(/<a class="result__a" href="([^"]+)">([\s\S]*?)<\/a>/);
      if (!aMatch) continue;

      let resUrl = aMatch[1];
      // Handle redirects e.g. //duckduckgo.com/l/?kh=-1&uddg=REAL_URL
      if (resUrl.startsWith('//')) {
        resUrl = 'https:' + resUrl;
      }
      if (resUrl.includes('uddg=')) {
        const parts = resUrl.split('uddg=');
        if (parts[1]) {
          resUrl = decodeURIComponent(parts[1].split('&')[0]);
        }
      }

      const title = aMatch[2].replace(/<[^>]*>/g, '').trim();

      // Extract Snippet
      // Pattern: <a class="result__snippet" ...>SNIPPET</a>
      const snippetMatch = block.match(/<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
      const snippet = snippetMatch ? snippetMatch[1].replace(/<[^>]*>/g, '').trim() : '';

      results.push({
        title: title || 'Web Search Result',
        url: resUrl,
        content: snippet || 'No description available.',
      });

      // Keep only top 4 results
      if (results.length >= 4) break;
    }

    return results;
  } catch (error) {
    console.error('DuckDuckGo scraping error:', error);
    return [];
  }
}

/**
 * Searches using Tavily Search API.
 */
export async function searchTavily(query: string, apiKey: string): Promise<SearchResult[]> {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: 4,
    }),
  });

  if (!res.ok) {
    throw new Error(`Tavily search failed: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as {
    results: { title: string; url: string; content: string }[];
  };

  return data.results.map((r) => ({
    title: r.title,
    url: r.url,
    content: r.content,
  }));
}

/**
 * Orchestrator web search function.
 * Tries Tavily first if key is present, otherwise falls back to DuckDuckGo scraping.
 */
export async function webSearch(query: string): Promise<{ searchResults: SearchResult[]; engine: string }> {
  const tavilyKey = process.env.TAVILY_API_KEY;
  if (tavilyKey && tavilyKey.trim()) {
    try {
      const results = await searchTavily(query, tavilyKey);
      if (results && results.length > 0) {
        return { searchResults: results, engine: 'Tavily' };
      }
    } catch (e) {
      console.warn('Tavily search failed, falling back to DuckDuckGo...', e);
    }
  }

  const results = await scrapeDuckDuckGo(query);
  return { searchResults: results, engine: 'DuckDuckGo' };
}
