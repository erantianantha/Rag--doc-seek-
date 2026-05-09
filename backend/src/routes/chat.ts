import { Router, Request, Response } from 'express';
import { getVectorStore } from '../lib/vectorstore';

const router = Router();

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

    // Retrieve 4 most relevant chunks via Gemini embeddings
    const retriever = vectorStore.asRetriever({ k: 4 });
    const relevantChunks = await retriever.invoke(query);

    const contextText = relevantChunks
      .map((chunk, i) => `[Source ${i + 1}]\n${chunk.pageContent}`)
      .join('\n\n---\n\n');

    const systemPrompt = `You are a smart document assistant (like Google NotebookLM).
Answer the user's question using ONLY the provided context below.

RULES:
1. Base your answer STRICTLY on the provided context.
2. If the answer is not in the context, say: "I cannot answer this based on the provided document."
3. Cite the source numbers when possible.
4. Do NOT use external knowledge or hallucinate.

DOCUMENT CONTEXT:
${contextText}`;

    // Direct fetch to OpenRouter — no SDK, no OPENAI_API_KEY needed
    const openRouterKey = process.env.OPENROUTER_API_KEY;
    if (!openRouterKey) {
      res.status(500).json({ error: 'OPENROUTER_API_KEY is not set on the server.' });
      return;
    }

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
      sources: relevantChunks.map((chunk) => ({
        content: chunk.pageContent.substring(0, 150) + '...',
        pageNumber: chunk.metadata?.totalPages ?? 'N/A',
      })),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'An error occurred';
    console.error('Chat Error:', msg);
    res.status(500).json({ error: msg });
  }
});

export default router;
