import { NextResponse } from 'next/server';
import { WebPDFLoader } from '@langchain/community/document_loaders/web/pdf';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { getVectorStore } from '@/lib/vectorstore';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const stream = new ReadableStream({
      async start(controller) {
        const send = (progress: number, message: string, extra?: Record<string, unknown>) => {
          const payload = JSON.stringify({ progress, message, ...extra }) + '\n';
          controller.enqueue(new TextEncoder().encode(payload));
        };

        try {
          // Step 1 – Ingestion
          send(10, 'Extracting text from PDF...');
          const loader = new WebPDFLoader(file);
          const docs = await loader.load();
          send(25, `Extracted ${docs.length} page(s). Now chunking...`);

          // Step 2 – Chunking
          const splitter = new RecursiveCharacterTextSplitter({
            chunkSize: 1000,
            chunkOverlap: 200,
          });
          const chunks = await splitter.splitDocuments(docs);
          send(40, `Created ${chunks.length} chunks. Embedding now...`);

          // Step 3 – Embed & Index (batched for progress reporting)
          const vectorStore = getVectorStore();
          vectorStore.memoryVectors = []; // clear old document

          const total = chunks.length;
          const batchSize = Math.max(5, Math.ceil(total / 10));

          for (let i = 0; i < total; i += batchSize) {
            const batch = chunks.slice(i, Math.min(i + batchSize, total));
            await vectorStore.addDocuments(batch);
            const pct = 40 + Math.round(((i + batch.length) / total) * 58);
            send(Math.min(pct, 98), `Embedded ${Math.min(i + batch.length, total)} / ${total} chunks...`);
          }

          send(100, 'Document ready!', { success: true, chunks: total });
          controller.close();
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : 'Unknown error during processing';
          send(0, 'Error', { error: msg });
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'application/x-ndjson',
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'An error occurred';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
