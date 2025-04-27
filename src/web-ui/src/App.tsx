import React, { useState, useEffect, useRef, KeyboardEvent } from 'react';
import './App.css';
import { 
  FiSettings, FiRefreshCw, FiSend, 
  FiMenu, FiX, FiCpu, 
  FiMessageSquare, FiPlus, FiTrash2,
  FiSliders, FiSquare
} from 'react-icons/fi';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface Message {
  role: string;
  content: string;
}

interface LLMModel {
  name: string;
  model_provider: string;
  model: string;
  description?: string;
}

interface LLMConfig {
  defaultLlm: string;
  llms: {
    [key: string]: LLMModel;
  };
}

function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [llmConfig, setLlmConfig] = useState<LLMConfig | null>(null);
  const [selectedLlm, setSelectedLlm] = useState<string>('');
  const [activeSidebarTab, setActiveSidebarTab] = useState<'models' | 'sessions'>('models');
  const [sessionId, setSessionId] = useState<string>('default');
  const [sessions, setSessions] = useState<string[]>([]);
  const [newSessionName, setNewSessionName] = useState<string>('');
  const [showNewSessionInput, setShowNewSessionInput] = useState<boolean>(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [abortController, setAbortController] = useState<AbortController | null>(null);

  // チャット履歴の読み込み
  useEffect(() => {
    fetchSessions();
    fetchHistory(sessionId);
    fetchSystemStatus();
    fetchLlmConfig();
  }, [sessionId]);

  // 自動スクロール
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // セッション一覧の取得
  const fetchSessions = async () => {
    try {
      const response = await fetch('/api/sessions');
      const data = await response.json();
      setSessions(data.sessions || []);
    } catch (error) {
      console.error('Error fetching sessions:', error);
    }
  };

  // LLM設定の取得
  const fetchLlmConfig = async () => {
    try {
      const response = await fetch('/api/llms');
      const data = await response.json();
      setLlmConfig(data);
      setSelectedLlm(data.defaultLlm);
    } catch (error) {
      console.error('Error fetching LLM config:', error);
    }
  };

  // 履歴読み込み
  const fetchHistory = async (sid: string) => {
    try {
      const response = await fetch(`/api/history/${sid}`);
      const data = await response.json();
      setMessages(data.history || []);
    } catch (error) {
      console.error('Error fetching history:', error);
    }
  };
  
  // システムステータス取得
  const fetchSystemStatus = async () => {
    try {
      const response = await fetch('/api/status');
      const data = await response.json();
      console.log("System status response:", data);
      if (data.systemPrompt) {
        console.log("System prompt from API:", data.systemPrompt);
        // APIから取得したプロンプトをそのまま使用
        setSystemPrompt(data.systemPrompt);
      }
    } catch (error) {
      console.error('Error fetching system status:', error);
    }
  };

  // チャット送信
  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;

    setIsLoading(true);
    
    // Create new AbortController for this request
    const controller = new AbortController();
    setAbortController(controller);
    
    try {
      // ユーザーメッセージを追加
      const userMessage = { role: 'user', content: input };
      const currentInput = input;
      setMessages((prev) => [...prev, userMessage]);
      setInput('');

      // APIリクエスト
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          message: currentInput,
          llmKey: selectedLlm,
          sessionId
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(`サーバーエラー: ${response.status}`);
      }

      const data = await response.json();
      
      // 応答を更新（サーバーから最新の履歴を取得）
      if (data.history && Array.isArray(data.history)) {
        setMessages(data.history);
      } else if (data.response) {
        // 履歴が返されなかった場合は応答だけを追加
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: data.response },
        ]);
      }
    } catch (error) {
      console.error('Error sending message:', error);
      
      // Check if this was an abort error
      if (error instanceof DOMException && error.name === 'AbortError') {
        console.log('Request was aborted');
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: '応答が停止されました。' },
        ]);
      } else {
        // エラーメッセージを表示
        const errorMessage = error instanceof Error
          ? `エラーが発生しました: ${error.message}`
          : 'エラーが発生しました。もう一度お試しください。';
          
        setMessages((prev) => [
          ...prev,
          { role: 'assistant', content: errorMessage },
        ]);
      }
    } finally {
      setIsLoading(false);
      setAbortController(null);
    }
  };

  // 停止ボタン処理
  const stopGeneration = () => {
    if (abortController) {
      abortController.abort();
    }
  };

  // 履歴リセット
  const resetHistory = async () => {
    try {
      const response = await fetch(`/api/reset/${sessionId}`, {
        method: 'POST',
      });
      
      if (!response.ok) {
        throw new Error('Failed to reset history');
      }
      
      setMessages([]);
    } catch (error) {
      console.error('Error resetting history:', error);
    }
  };
  
  // システムプロンプト更新
  const updateSystemPrompt = async () => {
    try {
      const response = await fetch('/api/system-prompt', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          prompt: systemPrompt,
          sessionId
        }),
      });
      
      if (!response.ok) {
        throw new Error('Failed to update system prompt');
      }
      
      const data = await response.json();
      console.log('System prompt updated:', data);
      
      // 更新成功後、設定パネルを閉じる
      setShowSettings(false);
      // 履歴もリセット
      setMessages([]);
    } catch (error) {
      console.error('Error updating system prompt:', error);
      alert('システムプロンプトの更新に失敗しました');
    }
  };

  // LLMモデル変更
  const changeLlmModel = (llmKey: string) => {
    if (llmConfig?.llms[llmKey]) {
      setSelectedLlm(llmKey);
      // モバイル表示の場合はサイドバーを閉じる
      if (window.innerWidth < 768) {
        setShowSidebar(false);
      }
    }
  };
  
  // セッション変更
  const changeSession = (sid: string) => {
    setSessionId(sid);
    fetchHistory(sid);
    // モバイル表示の場合はサイドバーを閉じる
    if (window.innerWidth < 768) {
      setShowSidebar(false);
    }
  };
  
  // 新しいセッション作成
  const createNewSession = async () => {
    if (!newSessionName.trim()) return;
    
    const newSid = newSessionName.trim().replace(/\s+/g, '_');
    setSessionId(newSid);
    setShowNewSessionInput(false);
    setNewSessionName('');
    
    // 新しいセッションを一覧に追加
    setSessions(prev => [...prev, newSid]);
  };
  
  // セッション削除
  const deleteSession = async (sid: string) => {
    if (sid === 'default') {
      alert('デフォルトセッションは削除できません');
      return;
    }
    
    if (!confirm(`セッション「${sid}」を削除してもよろしいですか？`)) return;
    
    try {
      const response = await fetch(`/api/sessions/${sid}`, {
        method: 'DELETE',
      });
      
      if (!response.ok) {
        throw new Error('Failed to delete session');
      }
      
      // セッション一覧から削除
      setSessions(prev => prev.filter(s => s !== sid));
      
      // 現在のセッションが削除されたセッションだった場合はデフォルトに戻す
      if (sessionId === sid) {
        setSessionId('default');
      }
    } catch (error) {
      console.error('Error deleting session:', error);
      alert('セッションの削除に失敗しました');
    }
  };

  // 下部へスクロール
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // テキストエリアの高さを自動調整
  const handleTextareaResize = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const textarea = e.target;
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
    setInput(e.target.value);
  };

  // キーボードイベント処理
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Ctrl + Enter (macOSでは⌘ + Enter)で送信
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      sendMessage(e);
    }
  };

  // 新しいチャット作成
  const createNewChat = () => {
    fetch('/api/new-chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      }
    })
    .then(response => response.json())
    .then(data => {
      if (data.success) {
        // 新しいセッションIDを設定して履歴を更新
        setSessionId(data.sessionId);
        fetchSessions();
        setMessages([]);
      }
    })
    .catch(error => {
      console.error('新しいチャットの作成に失敗しました:', error);
    });
  };

  return (
    <div className="app-container">
      {/* サイドバートグルボタン（モバイル用） */}
      <button 
        className="sidebar-toggle"
        onClick={() => setShowSidebar(!showSidebar)}
      >
        {showSidebar ? <FiX /> : <FiMenu />}
      </button>

      {/* サイドバー */}
      <div className={`sidebar ${showSidebar ? 'sidebar-open' : ''}`}>
        <div className="sidebar-header">
          <div className="sidebar-tabs">
            <button 
              className={`sidebar-tab ${activeSidebarTab === 'models' ? 'active' : ''}`}
              onClick={() => setActiveSidebarTab('models')}
            >
              <FiCpu /> LLMモデル
            </button>
            <button 
              className={`sidebar-tab ${activeSidebarTab === 'sessions' ? 'active' : ''}`}
              onClick={() => setActiveSidebarTab('sessions')}
            >
              <FiMessageSquare /> セッション
            </button>
          </div>
        </div>
        
        <div className="sidebar-content">
          {activeSidebarTab === 'models' && llmConfig && (
            <div className="llm-list">
              {Object.entries(llmConfig.llms).map(([key, llm]) => (
                <div 
                  key={key}
                  className={`llm-item ${selectedLlm === key ? 'selected' : ''}`}
                  onClick={() => changeLlmModel(key)}
                >
                  <div className="llm-name">{llm.name}</div>
                  {llm.description && (
                    <div className="llm-description">{llm.description}</div>
                  )}
                  <div className="llm-provider">{llm.model_provider}</div>
                </div>
              ))}
            </div>
          )}
          
          {activeSidebarTab === 'sessions' && (
            <div className="sessions-list">
              <button
                className="new-session-button"
                onClick={createNewChat}
              >
                <FiPlus /> 新しいチャット
              </button>
              
              {showNewSessionInput ? (
                <div className="new-session-input">
                  <input
                    type="text"
                    value={newSessionName}
                    onChange={(e) => setNewSessionName(e.target.value)}
                    placeholder="セッション名"
                    autoFocus
                  />
                  <div className="new-session-actions">
                    <button 
                      onClick={createNewSession}
                      disabled={!newSessionName.trim()}
                    >
                      作成
                    </button>
                    <button onClick={() => setShowNewSessionInput(false)}>
                      キャンセル
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  className="custom-session-button"
                  onClick={() => setShowNewSessionInput(true)}
                >
                  <FiPlus /> カスタムセッション名で作成
                </button>
              )}
              
              {sessions.map((sid) => (
                <div
                  key={sid}
                  className={`session-item ${sessionId === sid ? 'selected' : ''}`}
                >
                  <div 
                    className="session-name"
                    onClick={() => changeSession(sid)}
                  >
                    {sid === 'default' ? 'デフォルト' : sid}
                  </div>
                  {sid !== 'default' && (
                    <button
                      className="delete-session-button"
                      onClick={() => deleteSession(sid)}
                      title="セッションを削除"
                    >
                      <FiTrash2 />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="chat-container">
        <div className="chat-header">
          <h1>MCP Chat</h1>
          <div className="session-info">
            <span className="current-session">
              {sessionId === 'default' ? 'デフォルト' : sessionId}
            </span>
            <span className="current-model">
              {llmConfig && selectedLlm && llmConfig.llms[selectedLlm] && (
                llmConfig.llms[selectedLlm].name
              )}
            </span>
          </div>
          <div className="header-buttons">
            <button onClick={() => setShowSettings(!showSettings)} className="settings-button" title="設定">
              <FiSliders />
            </button>
            <button onClick={resetHistory} className="reset-button" title="会話をリセット">
              <FiRefreshCw />
            </button>
          </div>
        </div>
        
        {showSettings && (
          <div className="settings-panel">
            <h2>システムプロンプト設定</h2>
            <p className="settings-description">AIの動作や応答の詳細さを指定するためのプロンプトを設定できます</p>
            <textarea 
              value={systemPrompt} 
              onChange={(e) => setSystemPrompt(e.target.value)}
              rows={8}
              placeholder="システムプロンプトを入力..."
            />
            <div className="settings-actions">
              <button onClick={() => setShowSettings(false)} className="cancel-button">キャンセル</button>
              <button onClick={updateSystemPrompt} className="save-button">保存</button>
            </div>
          </div>
        )}
        
        <div className="messages-container">
          {messages.length === 0 ? (
            <div className="empty-state">
              チャットを開始してください。下のフォームからメッセージを送信できます。
            </div>
          ) : (
            messages.map((message, index) => (
              <div
                key={index}
                className={`message ${
                  message.role === 'user' 
                    ? 'user-message' 
                    : message.role === 'tool'
                    ? 'tool-message'
                    : 'assistant-message'
                }`}
              >
                <div className="message-role">{message.role === 'user' ? 'あなた' : 
                  message.role === 'tool' ? 'ツール実行' : 'AI'}</div>
                <div className={`message-content ${message.role === 'tool' ? 'tool-message-content' : ''}`}>
                  {message.role === 'assistant' || message.role === 'tool' ? (
                    <ReactMarkdown 
                      remarkPlugins={[remarkGfm]}
                      components={{
                        // リストのレンダリングをカスタマイズ
                        ul: ({node, ...props}) => <ul className="md-list" {...props} />,
                        ol: ({node, ...props}) => <ol className="md-list" {...props} />,
                        li: ({node, ...props}) => <li className="md-list-item" {...props} />
                      }}
                    >
                      {message.content}
                    </ReactMarkdown>
                  ) : (
                    message.content
                  )}
                </div>
              </div>
            ))
          )}
          {isLoading && (
            <div className="message assistant-message">
              <div className="message-role">AI</div>
              <div className="message-content loading">
                <span className="dot"></span>
                <span className="dot"></span>
                <span className="dot"></span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
        
        <form className="input-container" onSubmit={sendMessage}>
          <textarea
            value={input}
            onChange={handleTextareaResize}
            onKeyDown={handleKeyDown}
            placeholder="メッセージを入力..."
            disabled={isLoading}
            rows={1}
            className="chat-textarea"
          />
          {isLoading ? (
            <button type="button" onClick={stopGeneration} className="send-button stop-button">
              <FiSquare />
              <span className="shortcut-hint">停止</span>
            </button>
          ) : (
            <button type="submit" disabled={!input.trim()} className="send-button">
              <FiSend />
              <span className="shortcut-hint">Ctrl + Enter</span>
            </button>
          )}
        </form>
      </div>
    </div>
  );
}

export default App; 