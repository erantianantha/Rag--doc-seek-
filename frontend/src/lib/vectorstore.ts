import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { Embeddings } from "@langchain/core/embeddings";

// ---------------------------------------------------------------------------
// Custom embeddings that call the Gemini REST API directly via raw fetch.
// We use v1beta (where embedContent is supported) with the model
// "gemini-embedding-001" — verified live against this API key.
// ---------------------------------------------------------------------------
class GeminiDirectEmbeddings extends Embeddings {
  private apiKey: string;
  private model: string;
  private baseUrl: string;

  constructor(apiKey: string, model = "gemini-embedding-001") {
    super({});
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent?key=${apiKey}`;
  }

  private async embedOne(text: string): Promise<number[]> {
    const res = await fetch(this.baseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: { parts: [{ text }] },
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Gemini embed error (${res.status}): ${err}`);
    }

    const data = await res.json();
    return data.embedding.values as number[];
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    // Process in batches of 5 to avoid rate limits
    for (let i = 0; i < texts.length; i += 5) {
      const batch = texts.slice(i, i + 5);
      const batchResults = await Promise.all(batch.map((t) => this.embedOne(t)));
      results.push(...batchResults);
    }
    return results;
  }

  async embedQuery(text: string): Promise<number[]> {
    return this.embedOne(text);
  }
}

// ---------------------------------------------------------------------------
// Global singleton — survives Next.js hot-module-reloads in development
// ---------------------------------------------------------------------------
const g = global as unknown as { _vectorStore?: MemoryVectorStore };

export const getVectorStore = (): MemoryVectorStore => {
  if (g._vectorStore) return g._vectorStore;

  const apiKey = process.env.GOOGLE_API_KEY ?? "";
  const store = new MemoryVectorStore(new GeminiDirectEmbeddings(apiKey));

  if (process.env.NODE_ENV !== "production") {
    g._vectorStore = store;
  }

  return store;
};
