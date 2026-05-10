import { Router, Request, Response } from 'express';
import multer from 'multer';
import pdfParse from 'pdf-parse';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { Document } from '@langchain/core/documents';
import { getVectorStore } from '../lib/vectorstore';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

router.post('/', upload.single('file'), async (req: Request, res: Response) => {
  if (!req.file && !req.body.text) {
    res.status(400).json({ error: 'No file or text provided' });
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
    send(10, 'Extracting text...');
    
    let fullText = '';
    let metadata: any = {};

    if (req.file) {
      if (req.file.mimetype === 'application/pdf') {
        const pdfData = await pdfParse(req.file.buffer);
        fullText = pdfData.text;
        metadata = { source: req.file.originalname, totalPages: pdfData.numpages };
        send(25, `Extracted PDF (${pdfData.numpages} pages). Now chunking...`);
      } else if (req.file.mimetype === 'text/plain') {
        fullText = req.file.buffer.toString('utf-8');
        metadata = { source: req.file.originalname };
        send(25, `Extracted text file. Now chunking...`);
      } else {
        throw new Error('Unsupported file type. Please upload a PDF or TXT file.');
      }
    } else if (req.body.text) {
      fullText = req.body.text;
      metadata = { source: 'Pasted Text' };
      send(25, `Extracted pasted text. Now chunking...`);
    }

    // Step 2 — Chunking with RecursiveCharacterTextSplitter
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200,
    });
    const rawDoc = new Document({
      pageContent: fullText,
      metadata,
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
