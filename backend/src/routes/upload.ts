import { Router, Request, Response } from 'express';
import multer from 'multer';
import pdfParse from 'pdf-parse';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { Document } from '@langchain/core/documents';
import { getVectorStore } from '../lib/vectorstore';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

router.post('/', upload.single('file'), async (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: 'No file provided' });
    return;
  }

  // Set up NDJSON streaming
  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('X-Accel-Buffering', 'no');

  const send = (progress: number, message: string, extra?: Record<string, unknown>) => {
    res.write(JSON.stringify({ progress, message, ...extra }) + '\n');
  };

  try {
    // Step 1 — Ingestion via pdf-parse (works natively in Node.js, no worker issues)
    send(10, 'Extracting text from PDF...');
    const pdfData = await pdfParse(req.file.buffer);
    const fullText = pdfData.text;
    const numPages = pdfData.numpages;
    send(25, `Extracted ${numPages} page(s). Now chunking...`);

    // Step 2 — Chunking with RecursiveCharacterTextSplitter
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200,
    });
    const rawDoc = new Document({
      pageContent: fullText,
      metadata: { source: req.file.originalname, totalPages: numPages },
    });
    const chunks = await splitter.splitDocuments([rawDoc]);
    send(40, `Created ${chunks.length} chunks. Embedding now...`);

    // Step 3 — Embed & index into in-memory vector store
    const vectorStore = getVectorStore();
    vectorStore.memoryVectors = []; // Clear old document

    const total = chunks.length;
    const batchSize = Math.max(5, Math.ceil(total / 10));

    for (let i = 0; i < total; i += batchSize) {
      const batch = chunks.slice(i, Math.min(i + batchSize, total));
      await vectorStore.addDocuments(batch);
      const pct = 40 + Math.round(((i + batch.length) / total) * 58);
      send(Math.min(pct, 98), `Embedded ${Math.min(i + batch.length, total)} / ${total} chunks...`);
    }

    send(100, 'Document ready!', { success: true, chunks: total });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error during processing';
    send(0, 'Error', { error: msg });
  } finally {
    res.end();
  }
});

export default router;
