'use client';

import { useState, useRef, useEffect } from 'react';
import { UploadCloud, FileText, Send, BookOpen, Bot, User } from 'lucide-react';

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<{ type: 'success' | 'error' | 'info', message: string } | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isIndexed, setIsIndexed] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  
  const [messages, setMessages] = useState<Array<{ role: 'user' | 'ai', content: string, sources?: any[] }>>([]);
  const [input, setInput] = useState('');
  const [chatting, setChatting] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileChange(e.dataTransfer.files[0]);
    }
  };

  const [uploadMode, setUploadMode] = useState<'file' | 'text'>('file');
  const [plainText, setPlainText] = useState('');

  const handleFileChange = (selectedFile: File) => {
    if (selectedFile.type === 'application/pdf' || selectedFile.type === 'text/plain' || selectedFile.name.endsWith('.txt')) {
      setFile(selectedFile);
      setUploadStatus(null);
    } else {
      setUploadStatus({ type: 'error', message: 'Please upload a valid PDF or TXT document.' });
    }
  };

  const handleUpload = async () => {
    if (uploadMode === 'file' && !file) return;
    if (uploadMode === 'text' && !plainText.trim()) return;
    
    setUploading(true);
    setUploadStatus(null);
    setUploadProgress(0);
    
    const formData = new FormData();
    if (uploadMode === 'file' && file) {
      formData.append('file', file);
    } else if (uploadMode === 'text') {
      formData.append('text', plainText);
    }

    try {
      const baseUrl = process.env.NEXT_PUBLIC_BACKEND_URL || '';
      const res = await fetch(`${baseUrl}/api/upload`, {
        method: 'POST',
        body: uploadMode === 'file' ? formData : JSON.stringify({ text: plainText }),
        headers: uploadMode === 'text' ? { 'Content-Type': 'application/json' } : {},
      });
      
      if (!res.body) throw new Error("No response body");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let done = false;

      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        if (value) {
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n').filter(Boolean);
          for (const line of lines) {
            try {
              const data = JSON.parse(line);
              if (data.error) {
                setUploadStatus({ type: 'error', message: data.error });
                setUploading(false);
                return;
              }
              if (data.progress !== undefined) {
                setUploadProgress(data.progress);
                setUploadStatus({ type: 'info', message: data.message });
              }
              if (data.success) {
                setUploadStatus({ type: 'success', message: data.message });
                setIsIndexed(true);
                setMessages([{ role: 'ai', content: "I've successfully read and indexed the document! What would you like to know about it?" }]);
              }
            } catch (e) {
              console.error("Error parsing stream line", e);
            }
          }
        }
      }
    } catch (err: any) {
      setUploadStatus({ type: 'error', message: 'Failed to process document.' });
    } finally {
      setUploading(false);
    }
  };

  const handleSendMessage = async () => {
    if (!input.trim() || chatting) return;

    const userMessage = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
    setChatting(true);

    try {
      const baseUrl = process.env.NEXT_PUBLIC_BACKEND_URL || '';
      const res = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: userMessage })
      });
      const data = await res.json();
      
      if (res.ok) {
        setMessages(prev => [...prev, { role: 'ai', content: data.answer, sources: data.sources }]);
      } else {
        setMessages(prev => [...prev, { role: 'ai', content: `Error: ${data.error}` }]);
      }
    } catch (err) {
      setMessages(prev => [...prev, { role: 'ai', content: 'Sorry, I encountered an error while processing your request.' }]);
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
          
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
            <button 
              className={`btn ${uploadMode === 'file' ? 'active' : ''}`} 
              style={{ flex: 1, padding: '0.5rem', background: uploadMode === 'file' ? 'var(--accent-color)' : 'transparent', color: uploadMode === 'file' ? '#000' : 'var(--text-secondary)', border: '1px solid var(--border-color)' }}
              onClick={() => setUploadMode('file')}
            >File</button>
            <button 
              className={`btn ${uploadMode === 'text' ? 'active' : ''}`} 
              style={{ flex: 1, padding: '0.5rem', background: uploadMode === 'text' ? 'var(--accent-color)' : 'transparent', color: uploadMode === 'text' ? '#000' : 'var(--text-secondary)', border: '1px solid var(--border-color)' }}
              onClick={() => setUploadMode('text')}
            >Text</button>
          </div>

          {uploadMode === 'file' ? (
            <>
              <input 
                type="file" 
                accept=".pdf,.txt" 
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
                    <span className="upload-text">Click or drag PDF/TXT to upload</span>
                  </>
                )}
              </div>
            </>
          ) : (
            <textarea
              className="chat-input"
              style={{ width: '100%', minHeight: '150px', padding: '1rem', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', borderRadius: '12px', resize: 'vertical' }}
              placeholder="Paste your plain text here..."
              value={plainText}
              onChange={(e) => setPlainText(e.target.value)}
            />
          )}
        </div>

        {((uploadMode === 'file' && file) || (uploadMode === 'text' && plainText.trim())) && !isIndexed && (
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
          <div className={`status-message ${uploadStatus.type}`}>
            {uploadStatus.message}
          </div>
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
                Upload a PDF/TXT document or paste plain text in the sidebar to create a specialized AI assistant that can answer questions based purely on the content provided.
              </p>
            </div>
          ) : (
            <>
              {messages.map((msg, idx) => (
                <div key={idx} className={`message ${msg.role}`}>
                  <div className="avatar">
                    {msg.role === 'ai' ? <Bot size={20} /> : <User size={20} />}
                  </div>
                  <div className="message-content">
                    <div style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</div>
                    
                    {msg.sources && msg.sources.length > 0 && (
                      <div className="sources-container">
                        <div className="sources-title">Sources used:</div>
                        {msg.sources.map((src, i) => (
                          <div key={i} className="source-item">
                            <span style={{color: 'var(--accent-color)', fontWeight: 'bold'}}>Page {src.pageNumber}:</span> "{src.content}"
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
                  <div className="message-content">
                    <div className="loader"></div>
                  </div>
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
              placeholder={isIndexed ? "Ask a question about the document..." : "Please upload a document first..."}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage();
                }
              }}
              disabled={!isIndexed || chatting}
              rows={1}
            />
            <button 
              className="send-btn" 
              onClick={handleSendMessage}
              disabled={!isIndexed || chatting || !input.trim()}
            >
              <Send size={18} />
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
