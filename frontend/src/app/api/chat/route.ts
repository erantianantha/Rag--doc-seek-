import { NextResponse } from 'next/server';
import { getVectorStore } from '@/lib/vectorstore';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const { query } = await req.json();
    if (!query?.trim()) {
      return NextResponse.json({ error: 'No query provided' }, { status: 400 });
    }

    const vectorStore = getVectorStore();

    if (!vectorStore.memoryVectors || vectorStore.memoryVectors.length === 0) {
      return NextResponse.json(
        { error: 'No document indexed yet. Please upload a PDF first.' },
        { status: 400 }
      );
    }

    // Retrieve 4 most relevant chunks via Gemini embeddings
    const retriever = vectorStore.asRetriever({ k: 4 });
    const relevantChunks = await retriever.invoke(query);

    const contextText = relevantChunks
      .map(
        (chunk, i) =>
          `[Source ${i + 1} | Page: ${chunk.metadata?.loc?.pageNumber ?? 'N/A'}]\n${chunk.pageContent}`
      )
      .join('\n\n---\n\n');

    const systemPrompt = `You are a smart document assistant (like Google NotebookLM).
Answer the user's question using ONLY the provided context below.

RULES:
1. Base your answer STRICTLY on the provided context.
2. If the answer is not in the context, say: "I cannot answer this based on the provided document."
3. Cite the source numbers or page numbers when possible.
4. Do NOT use external knowledge or hallucinate.

DOCUMENT CONTEXT:
${contextText}`;

    // Direct fetch to OpenRouter — no SDK, no OPENAI_API_KEY needed
    const openRouterKey = process.env.OPENROUTER_API_KEY;
    if (!openRouterKey) {
      return NextResponse.json({ error: 'OPENROUTER_API_KEY is not set in .env' }, { status: 500 });
    }

    const orRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openRouterKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'http://localhost:3000',
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

    const orData = await orRes.json();
    const answerText: string = orData.choices?.[0]?.message?.content ?? 'No response received.';

    return NextResponse.json({
      answer: answerText,
      sources: relevantChunks.map(chunk => ({
        content: chunk.pageContent.substring(0, 150) + '...',
        pageNumber: chunk.metadata?.loc?.pageNumber ?? 'N/A',
      })),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'An error occurred';
    console.error('Chat Error:', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
