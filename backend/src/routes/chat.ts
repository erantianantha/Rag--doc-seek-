import { Router, Request, Response } from 'express';
import { getVectorStore } from '../lib/vectorstore';
import { webSearch } from '../lib/search';

const router = Router();

/**
 * Grade a retrieved document chunk for relevance to the query.
 * Uses Gemini API directly for fast, reliable evaluation.
 */
async function gradeChunk(query: string, documentContent: string, apiKey: string): Promise<boolean> {
  const prompt = `You are a grader evaluating the relevance of a retrieved document chunk to a user query.

Query Type Rule:
If the user query is asking for a general summary, overview, explanation, or "what this is about" for the entire document, then any informative chunk of the document is considered relevant. In this case, you MUST respond with "yes".

Otherwise, evaluate if the chunk contains specific information relevant to answering the query.

Document Chunk:
"""
${documentContent}
"""

User Query:
"""
${query}
"""

Respond with exactly one word: "yes" if the chunk is relevant, or "no" if it is not. Do not include any other text, punctuation, or explanation.`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: 5 }
        }),
      }
    );

    if (!res.ok) {
      const err = await res.text();
      console.error(`Gemini grader error (${res.status}): ${err}`);
      return true; // Fallback to relevant
    }

    const data = await res.json() as any;
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim()?.toLowerCase() ?? 'yes';
    return text.includes('yes') || text.includes('true') || text.includes('relevant') || text === 'y';
  } catch (err) {
    console.error('Failed to grade chunk:', err);
    return true; // Fallback to relevant
  }
}

/**
 * Reformulate the user query into a concise search engine query.
 */
async function rewriteQuery(query: string, apiKey: string): Promise<string> {
  const prompt = `You are a search query optimizer. Given a user query, formulate a concise, effective search query for a web search engine (like Google) to find information relevant to answering the query.
Do NOT include any introduction, explanations, quotes, or markdown. Output ONLY the optimized search query string.

User Query:
"""
${query}
"""`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 30 }
        }),
      }
    );

    if (!res.ok) {
      const err = await res.text();
      console.error(`Gemini rewriter error (${res.status}): ${err}`);
      return query;
    }

    const data = await res.json() as any;
    const rewritten = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? query;
    // Strip quotes if LLM added them
    return rewritten.replace(/^["']|["']$/g, '');
  } catch (err) {
    console.error('Failed to rewrite query:', err);
    return query;
  }
}

router.post('/', async (req: Request, res: Response) => {
  try {
    const { query } = req.body as { query?: string };

    if (!query?.trim()) {
      res.status(400).json({ error: 'No query provided' });
      return;
    }

    const vectorStore = getVectorStore();

    if (!vectorStore.memoryVectors || vectorStore.memoryVectors.length === 0) {
      res.status(400).json({ error: 'No document indexed yet. Please upload a PDF first.' });
      return;
    }

    const googleApiKey = process.env.GOOGLE_API_KEY;
    if (!googleApiKey) {
      res.status(500).json({ error: 'GOOGLE_API_KEY is not set on the server.' });
      return;
    }

    const openRouterKey = process.env.OPENROUTER_API_KEY;
    if (!openRouterKey) {
      res.status(500).json({ error: 'OPENROUTER_API_KEY is not set on the server.' });
      return;
    }

    // 1. Retrieve 4 most relevant chunks
    const retriever = vectorStore.asRetriever({ k: 4 });
    const retrievedChunks = await retriever.invoke(query);

    // 2. Grade each chunk
    const gradedChunks = [];
    console.log(`\n--- [CRAG GRADER] Grading retrieved chunks for query: "${query}" ---`);
    for (const chunk of retrievedChunks) {
      const isRelevant = await gradeChunk(query, chunk.pageContent, googleApiKey);
      console.log(`- Chunk: "${chunk.pageContent.substring(0, 80).replace(/\n/g, ' ')}..."`);
      console.log(`  Grade: ${isRelevant ? '🟢 RELEVANT' : '🔴 IRRELEVANT'}`);
      gradedChunks.push({
        content: chunk.pageContent,
        pageNumber: chunk.metadata?.totalPages ?? 'N/A',
        sourceName: chunk.metadata?.source ?? 'Document',
        metadata: chunk.metadata,
        relevant: isRelevant,
      });
    }

    const relevantDocs = gradedChunks.filter((c) => c.relevant);
    const runWebSearch = relevantDocs.length < gradedChunks.length; // Trigger if any chunk is irrelevant/insufficient

    let contextText = '';
    let systemPrompt = '';
    let webSearchData: any = null;

    // 3. Action Decision & External Search Fallback
    if (runWebSearch) {
      console.log(`🔍 [CRAG] Irrelevant chunks detected (${gradedChunks.length - relevantDocs.length}/${gradedChunks.length}). Triggering web search...`);
      const optimizedQuery = await rewriteQuery(query, googleApiKey);
      console.log(`📝 [CRAG] Rewrote search query: "${optimizedQuery}"`);

      const { searchResults, engine } = await webSearch(optimizedQuery);
      console.log(`🌐 [CRAG] Web search complete (${engine}). Found ${searchResults.length} results.`);

      webSearchData = {
        query: optimizedQuery,
        engine,
        results: searchResults,
      };

      const docContext = relevantDocs.length > 0
        ? relevantDocs.map((chunk, i) => `[Document Source ${i + 1}]\n${chunk.content}`).join('\n\n---\n\n')
        : 'No relevant information found in the uploaded document.';

      const webContext = searchResults.length > 0
        ? searchResults.map((res, i) => `[Web Source ${i + 1}] (${res.title} - ${res.url})\n${res.content}`).join('\n\n---\n\n')
        : 'No web search results found.';

      contextText = `--- UPLOADED DOCUMENT CONTEXT ---\n${docContext}\n\n--- WEB SEARCH RESULTS ---\n${webContext}`;

      systemPrompt = `You are a smart document assistant (like Google NotebookLM) augmented with web search capabilities.
Answer the user's question using the provided context from the uploaded document and/or web search results.

RULES:
1. Base your answer STRICTLY on the provided context (Document Sources and/or Web Sources).
2. If the answer is not in the context, say: "I cannot answer this based on the provided document or web search."
3. Cite the source names or source numbers (e.g. "[Document Source 1]" or "[Web Source 2]") when possible.
4. Do NOT use general external knowledge outside of the provided context.

CONTEXT:
${contextText}`;
    } else {
      console.log('✅ [CRAG] All chunks relevant. Direct generation.');
      const docContext = relevantDocs.map((chunk, i) => `[Document Source ${i + 1}]\n${chunk.content}`).join('\n\n---\n\n');
      contextText = docContext;

      systemPrompt = `You are a smart document assistant (like Google NotebookLM).
Answer the user's question using ONLY the provided context below.

RULES:
1. Base your answer STRICTLY on the provided context.
2. If the answer is not in the context, say: "I cannot answer this based on the provided document."
3. Cite the source numbers (e.g. "[Document Source 1]") when possible.
4. Do NOT use external knowledge or hallucinate.

DOCUMENT CONTEXT:
${contextText}`;
    }

    // 4. Generate Final Response
    const orRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openRouterKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.FRONTEND_URL ?? 'http://localhost:3000',
        'X-Title': 'NotebookLM Clone',
      },
      body: JSON.stringify({
        model: 'openai/gpt-oss-20b:free',
        temperature: 0.2,
        max_tokens: 1024,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: query },
        ],
      }),
    });

    if (!orRes.ok) {
      const errText = await orRes.text();
      throw new Error(`OpenRouter error (${orRes.status}): ${errText}`);
    }

    const orData = (await orRes.json()) as {
      choices: { message: { content: string } }[];
    };
    const answerText = orData.choices?.[0]?.message?.content ?? 'No response received.';

    res.json({
      answer: answerText,
      sources: gradedChunks.map((chunk) => ({
        content: chunk.content.substring(0, 150) + '...',
        pageNumber: chunk.pageNumber,
        sourceName: chunk.sourceName,
        relevant: chunk.relevant,
      })),
      webSearch: webSearchData,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'An error occurred';
    console.error('Chat Error:', msg);
    res.status(500).json({ error: msg });
  }
});

export default router;
