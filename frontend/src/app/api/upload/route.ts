import { NextResponse } from 'next/server';
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { getVectorStore } from '@/lib/vectorstore';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    let file: File | null = null;
    let plainText = '';

    const contentType = req.headers.get('content-type') || '';
    
    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      file = formData.get('file') as File;
    } else if (contentType.includes('application/json')) {
      const body = await req.json();
      plainText = body.text || '';
    }

    if (!file && !plainText) {
      return NextResponse.json({ error: 'No file or text provided' }, { status: 400 });
    }

    const stream = new ReadableStream({
      async start(controller) {
        const send = (progress: number, message: string, extra?: Record<string, unknown>) => {
          const payload = JSON.stringify({ progress, message, ...extra }) + '\n';
          controller.enqueue(new TextEncoder().encode(payload));
        };

        try {
          // Step 1 – Ingestion
          send(10, 'Extracting text...');
          
          let docs: any[] = [];
          if (file) {
            if (file.type === 'application/pdf') {
              const loader = new PDFLoader(file);
              docs = await loader.load();
              send(25, `Extracted PDF (${docs.length} pages). Now chunking...`);
            } else if (file.type === 'text/plain' || file.name.endsWith('.txt')) {
              const text = await file.text();
              docs = [{ pageContent: text, metadata: { source: file.name } }];
              send(25, `Extracted text file. Now chunking...`);
            } else {
              throw new Error('Unsupported file type');
            }
          } else if (plainText) {
            docs = [{ pageContent: plainText, metadata: { source: 'Pasted Text' } }];
            send(25, `Extracted pasted text. Now chunking...`);
          }

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
