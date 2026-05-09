import { MemoryVectorStore } from 'langchain/vectorstores/memory';
import { Embeddings } from '@langchain/core/embeddings';

// ---------------------------------------------------------------------------
// Custom Gemini embeddings using raw fetch to v1beta REST API.
// Bypasses all LangChain/SDK wrappers to avoid v1 vs v1beta routing bugs.
// Model: gemini-embedding-001 (verified working with free API keys).
// ---------------------------------------------------------------------------
class GeminiDirectEmbeddings extends Embeddings {
  private readonly apiKey: string;
  private readonly endpoint: string;

  constructor(apiKey: string) {
    super({});
    this.apiKey = apiKey;
    this.endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${apiKey}`;
  }

  private async embedOne(text: string): Promise<number[]> {
    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: { parts: [{ text }] } }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Gemini embed error (${res.status}): ${err}`);
    }

    const data = (await res.json()) as { embedding: { values: number[] } };
    return data.embedding.values;
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    const results: number[][] = [];
    // Batch 5 at a time to respect rate limits
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
// Singleton in-memory vector store — persists across requests for the
// lifetime of the Render process.
// ---------------------------------------------------------------------------
let _vectorStore: MemoryVectorStore | null = null;

export function getVectorStore(): MemoryVectorStore {
  if (_vectorStore) return _vectorStore;

  const apiKey = process.env.GOOGLE_API_KEY ?? '';
  _vectorStore = new MemoryVectorStore(new GeminiDirectEmbeddings(apiKey));
  return _vectorStore;
}
