# NotebookLM Clone — RAG Document Chat App

A full-stack RAG (Retrieval-Augmented Generation) application inspired by Google NotebookLM.  
Upload any PDF and have a grounded AI conversation with its content.

## 📁 Project Structure

```
├── backend/     → Express.js RAG API server  (deploy on Render)
└── frontend/    → Next.js UI                 (deploy on Vercel)
```

## 🧠 RAG Pipeline

**Ingestion → Chunking → Embedding → Storage → Retrieval → Generation**

| Step | Technology |
|------|-----------|
| PDF Parsing | `pdf-parse` |
| Chunking | `RecursiveCharacterTextSplitter` (1000 chars, 200 overlap) |
| Embeddings | Google Gemini `gemini-embedding-001` (direct REST) |
| Vector Store | In-memory `MemoryVectorStore` |
| LLM | OpenRouter → `openai/gpt-oss-20b:free` |

## ⚙️ Local Development

### Backend (port 3001)
```bash
cd backend
npm install
# create .env from .env.example and fill in your keys
npm run dev
```

### Frontend (port 3000)
```bash
cd frontend
npm install
# .env.local is already set to http://localhost:3001
npm run dev
```

## 🚀 Deployment

- **Backend** → [Render](https://render.com) (free Web Service)
- **Frontend** → [Vercel](https://vercel.com) (free Hobby plan)

### Required Environment Variables

**Render (backend):**
| Key | Description |
|-----|-------------|
| `GOOGLE_API_KEY` | Google Gemini API key (for embeddings) |
| `OPENROUTER_API_KEY` | OpenRouter API key (for LLM chat) |
| `FRONTEND_URL` | Your Vercel app URL |

**Vercel (frontend):**
| Key | Description |
|-----|-------------|
| `NEXT_PUBLIC_BACKEND_URL` | Your Render backend URL |

## 🛠️ Tech Stack

- **Frontend**: Next.js 14, React, Vanilla CSS (Glassmorphism)
- **Backend**: Express.js, TypeScript, Node.js
- **AI**: LangChain.js, Google Gemini, OpenRouter
