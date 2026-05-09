'use client';

import { useState, useRef, useEffect } from 'react';
import { UploadCloud, FileText, Send, BookOpen, Bot, User } from 'lucide-react';

// All API calls go to the Render backend — set NEXT_PUBLIC_BACKEND_URL in Vercel env vars
const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3001';

interface Message {
  role: 'user' | 'ai';
  content: string;
  sources?: { content: string; pageNumber: string | number }[];
}

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStatus, setUploadStatus] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const [isIndexed, setIsIndexed] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [chatting, setChatting] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(e.type === 'dragenter' || e.type === 'dragover');
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files?.[0]) handleFileChange(e.dataTransfer.files[0]);
  };

  const handleFileChange = (selectedFile: File) => {
    if (selectedFile.type === 'application/pdf') {
      setFile(selectedFile);
      setIsIndexed(false);
      setMessages([]);
      setUploadStatus(null);
      setUploadProgress(0);
    } else {
      setUploadStatus({ type: 'error', message: 'Please upload a valid PDF document.' });
    }
  };

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setUploadStatus(null);
    setUploadProgress(0);

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch(`${BACKEND_URL}/api/upload`, { method: 'POST', body: formData });
      if (!res.body) throw new Error('No response body');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let done = false;

      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        if (!value) continue;

        const lines = decoder.decode(value, { stream: true }).split('\n').filter(Boolean);
        for (const line of lines) {
          try {
            const data = JSON.parse(line);
            if (data.error) {
              setUploadStatus({ type: 'error', message: data.error });
              return;
            }
            if (data.progress !== undefined) {
              setUploadProgress(data.progress);
              setUploadStatus({ type: 'info', message: data.message });
            }
            if (data.success) {
              setUploadStatus({ type: 'success', message: `✅ ${data.message} (${data.chunks} chunks indexed)` });
              setIsIndexed(true);
              setMessages([{ role: 'ai', content: "I've read and indexed the document! What would you like to know?" }]);
            }
          } catch {
            /* skip malformed lines */
          }
        }
      }
    } catch (err) {
      setUploadStatus({ type: 'error', message: err instanceof Error ? err.message : 'Upload failed.' });
    } finally {
      setUploading(false);
    }
  };

  const handleSendMessage = async () => {
    if (!input.trim() || chatting) return;
    const userMessage = input.trim();
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: userMessage }]);
    setChatting(true);

    try {
      const res = await fetch(`${BACKEND_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: userMessage }),
      });
      const data = await res.json();
      if (res.ok) {
        setMessages((prev) => [...prev, { role: 'ai', content: data.answer, sources: data.sources }]);
      } else {
        setMessages((prev) => [...prev, { role: 'ai', content: `Error: ${data.error}` }]);
      }
    } catch {
      setMessages((prev) => [...prev, { role: 'ai', content: 'Sorry, I could not reach the server.' }]);
    } finally {
      setChatting(false);
    }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, chatting]);

  return (
    <div className="app-container">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="brand">
          <BookOpen className="brand-icon" size={28} />
          <span>NotebookLM</span>
        </div>

        <div>
          <h3 style={{ marginBottom: '1rem', fontSize: '1.1rem' }}>Data Source</h3>
          <input
            type="file"
            accept=".pdf"
            ref={fileInputRef}
            onChange={(e) => e.target.files && handleFileChange(e.target.files[0])}
            style={{ display: 'none' }}
          />
          <div
            className={`upload-zone ${dragActive ? 'drag-active' : ''}`}
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            {file ? (
              <>
                <FileText className="upload-icon" size={40} style={{ color: 'var(--accent-color)' }} />
                <span className="upload-text" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{file.name}</span>
                <span className="upload-text">{(file.size / 1024 / 1024).toFixed(2)} MB</span>
              </>
            ) : (
              <>
                <UploadCloud className="upload-icon" size={40} />
                <span className="upload-text">Click or drag PDF to upload</span>
              </>
            )}
          </div>
        </div>

        {file && !isIndexed && (
          <button className="btn" onClick={handleUpload} disabled={uploading}>
            {uploading ? <div className="loader"></div> : 'Process Document'}
          </button>
        )}

        {uploading && (
          <div className="progress-bar-container">
            <div className="progress-bar-fill" style={{ width: `${uploadProgress}%` }}></div>
          </div>
        )}

        {uploadStatus && (
          <div className={`status-message ${uploadStatus.type}`}>{uploadStatus.message}</div>
        )}
      </aside>

      {/* Main Chat Area */}
      <main className="chat-panel">
        <header className="chat-header">
          <h2>Document Chat</h2>
          <p>{isIndexed ? 'Ask questions about your uploaded document' : 'Upload a document to start chatting'}</p>
        </header>

        <div className="chat-messages">
          {!isIndexed ? (
            <div className="empty-state">
              <Bot className="empty-icon" />
              <h3>NotebookLM Assistant</h3>
              <p style={{ maxWidth: '400px' }}>
                Upload a PDF document in the sidebar to create a specialized AI assistant that answers
                questions grounded purely in the document&apos;s content.
              </p>
            </div>
          ) : (
            <>
              {messages.map((msg, idx) => (
                <div key={idx} className={`message ${msg.role}`}>
                  <div className="avatar">{msg.role === 'ai' ? <Bot size={20} /> : <User size={20} />}</div>
                  <div className="message-content">
                    <div style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</div>
                    {msg.sources && msg.sources.length > 0 && (
                      <div className="sources-container">
                        <div className="sources-title">Sources used:</div>
                        {msg.sources.map((src, i) => (
                          <div key={i} className="source-item">
                            <span style={{ color: 'var(--accent-color)', fontWeight: 'bold' }}>
                              Source {i + 1}:
                            </span>{' '}
                            &ldquo;{src.content}&rdquo;
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {chatting && (
                <div className="message ai">
                  <div className="avatar"><Bot size={20} /></div>
                  <div className="message-content"><div className="loader"></div></div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </>
          )}
        </div>

        <div className="chat-input-container">
          <div className="chat-input-wrapper">
            <textarea
              className="chat-input"
              placeholder={isIndexed ? 'Ask a question about the document...' : 'Please upload a document first...'}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(); } }}
              disabled={!isIndexed || chatting}
              rows={1}
            />
            <button className="send-btn" onClick={handleSendMessage} disabled={!isIndexed || chatting || !input.trim()}>
              <Send size={18} />
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
