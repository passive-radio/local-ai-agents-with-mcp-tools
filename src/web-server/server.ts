import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages';
import { BaseMessage } from '@langchain/core/messages';
import { convertMcpToLangchainTools } from '@h1deya/langchain-mcp-tools';
import { initChatModel } from '../init-chat-model.js';
import { loadConfig, Config, LLMConfig } from '../load-config.js';
import dotenv from 'dotenv';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { MemorySaver } from '@langchain/langgraph';
import { Message } from "../@types/index.js";
import { ChatOpenAI } from '@langchain/openai';
import fs from 'fs-extra';
import YAML from 'yaml';
import { pino } from 'pino';

fs.ensureDirSync('./logs');

const streams = [
  { stream: process.stdout, level: 'debug' },
  { stream: fs.createWriteStream('./logs/server.log', { flags: 'a' }), level: 'debug' },
];

const logger = pino({ level: 'debug' }, pino.multistream(streams));

logger.debug('test of file out');

// プロセスの起動時にLANGCHAIN DEBUGモードを有効化
process.env.LANGCHAIN_TRACING = "false";
process.env.LANGCHAIN_VERBOSE = "true";

// Load environment variables from .env file
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

const maxMessagesLength = 20;

// チャット履歴ディレクトリの設定
const CHAT_HISTORY_DIR = path.join(process.cwd(), 'chat_history');
fs.ensureDirSync(CHAT_HISTORY_DIR);

// デフォルトセッションID
const DEFAULT_SESSION_ID = 'default';

// デフォルトシステムプロンプト - アプリケーション全体で単一定義
const DEFAULT_SYSTEM_PROMPT = `あなたは私が雇っている世界最高峰の秘書であり、私からの質問や依頼に忠実かつ専門的に応えます。

## タスク遂行のルール
1. 最良のアウトプットを出すために、最初に必ずタスクを設計して、分解したタスクを実行してください
2. **指示にまっすぐ答えている正確な回答を生成できるまで、ツール操作や推論を繰り返してください**
3. 推論・タスクのチェーンが完了できるのは、指示に対して正確な回答が生成できたときだけです

## 思考のルール
1. まず必ず私の発言内容を文脈や背景を踏まえて構造的に理解する
2. あなたが呼び出せるツールの一覧を把握して、私の期待を超える最良のアウトプットを出すためにツールを使用すべきかを必ず判断する
3. ツールを使用したほうが適切と判断したら、必ずツールを使用して回答を作成する。

## 出力のルール
1. Web検索情報を回答に使用した場合は、必ず引用して出典した記事のタイトル、URLを記載する。
2. 回答は省略せず詳細に記述する。

## 以下のガイドラインに従ってください
1. 質問に対して詳細で具体的な情報を提供してください。
2. 回答は簡潔すぎないように、十分な説明と例を含めてください。
3. ツールを使用する場合、得られた情報を単に転記するのではなく、その情報から洞察を引き出し、整理してわかりやすく説明してください。
4. 日本語の質問には日本語で回答してください。英語の質問には英語で回答してください。
5. 一般常識から演繹できないタスク、依頼の場合は、積極的にWeb検索を行う。
6. 専門的な情報や専門知識を活かして詳細に説明してください。
7. 情報が不明確な場合は、誤った情報を提供せず、わからないことを正直に伝えてください。

ユーザーの時間を尊重し、価値ある情報を提供するよう心がけてください。

## 具体的なツール使用ルール

### Web検索
1. 回答の作成には必ず3つ以上の記事を参照する。
2. 回答の中に必ず出典した記事のタイトル、URLを記載する。

### レストランの空き予約確認、店舗の提案、決定
**必ず Playwright を使用してください**

- URL: https://tabelog.com/
- 検索方法: ヘッダーエリアにある「エリア・駅」に場所を入力、「キーワード」に依頼された料理のジャンルなどを入力、隣の日時欄に予約したい日時を入力、ついで人数を入力して検索。
- 検索結果: 条件に合致した予約可能な店舗が表示されるので、上位5件の店舗情報を候補として一旦ユーザーに提示する。
- ブラウザ操作タスクの完了条件: ユーザーからの回答に従って、予約可能な店舗を選択して、後続のタスクを遂行する。
`;

// アクティブなチャットリクエストを追跡
type AbortControllerMap = {
  [sessionId: string]: AbortController;
};
const activeRequests: AbortControllerMap = {};

// チャットリクエストを停止する関数
function abortChatRequest(sessionId: string): boolean {
  if (activeRequests[sessionId]) {
    console.log(`Aborting request for session ${sessionId}`);
    activeRequests[sessionId].abort();
    delete activeRequests[sessionId];
    return true;
  }
  return false;
}

// 新しいセッションIDを生成する関数（タイムスタンプベース）
function generateSessionId(): string {
  return `chat_${Math.floor(Date.now() / 1000)}`;
}

// YAMLからチャット履歴を読み込む関数
function loadChatHistoryFromYaml(sessionId: string): Message[] {
  try {
    const filePath = path.join(CHAT_HISTORY_DIR, `${sessionId}.yaml`);
    if (!fs.existsSync(filePath)) {
      return [];
    }
    
    const yamlContent = fs.readFileSync(filePath, 'utf8');
    const parsedData = YAML.parse(yamlContent);
    return Array.isArray(parsedData) ? parsedData : [];
  } catch (error) {
    logger.error(
      { 
        type: 'history_load_error', 
        sessionId, 
        error: error instanceof Error ? error.message : String(error)
      }, 
      `Error loading chat history from YAML for session ${sessionId}`
    );
    return [];
  }
}

// チャット履歴をYAMLに保存する関数
function saveChatHistoryToYaml(
  sessionId: string, 
  history: Message[]
): void {
  try {
    const filePath = path.join(CHAT_HISTORY_DIR, `${sessionId}.yaml`);
    const yamlContent = YAML.stringify(history);
    fs.writeFileSync(filePath, yamlContent, 'utf8');
    logger.debug({ type: 'history_saved', sessionId, filePath }, `Chat history saved to ${filePath}`);
  } catch (error) {
    logger.error(
      { 
        type: 'history_save_error', 
        sessionId, 
        error: error instanceof Error ? error.message : String(error)
      }, 
      `Error saving chat history to YAML for session ${sessionId}`
    );
  }
}

// 利用可能なチャットセッションの一覧を取得する関数
function listChatSessions(): string[] {
  try {
    const files = fs.readdirSync(CHAT_HISTORY_DIR);
    // filename: chat_{timestamp (int)}.yaml
    return files
      .filter((file: string) => file.endsWith('.yaml'))
      .map((file: string) => file.replace('.yaml', ''))
      .sort((a: string, b: string) => {
        const aTimestamp = parseInt(a.split('_')[1]);
        const bTimestamp = parseInt(b.split('_')[1]);
        return bTimestamp - aTimestamp;
      });
  } catch (error) {
    console.error('Error listing chat sessions:', error);
    return [];
  }
}

// Add request logging middleware
app.use((req, res, next) => {
  logger.info({
    type: 'request',
    method: req.method,
    url: req.url,
    ip: req.ip,
    timestamp: new Date().toISOString()
  });
  next();
});

// ミドルウェア
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../../dist')));

// クライアント別にセッション管理（メモリ内）
interface SessionData {
  chatHistory: Message[];
  langChainMessages: BaseMessage[];
  systemPrompt: string;
}

const sessions: Map<string, SessionData> = new Map();

// セッションの初期化または取得
function getOrCreateSession(sessionId: string): SessionData {
  if (!sessions.has(sessionId)) {
    // ファイルからチャット履歴を読み込む
    const savedHistory = loadChatHistoryFromYaml(sessionId);
    
    // LangChainメッセージを構築
    const langChainMessages: BaseMessage[] = [
      new SystemMessage(DEFAULT_SYSTEM_PROMPT)
    ];
    
    // 保存された履歴からLangChainメッセージを追加
    savedHistory.forEach(msg => {
      if (msg.role === 'user') {
        langChainMessages.push(new HumanMessage(msg.content));
      } else if (msg.role === 'assistant') {
        langChainMessages.push(new AIMessage(msg.content));
      }
    });
    
    sessions.set(sessionId, {
      chatHistory: savedHistory,
      langChainMessages,
      systemPrompt: DEFAULT_SYSTEM_PROMPT
    });
  }
  
  return sessions.get(sessionId)!;
}

// MCP初期化状態を追跡
let mcpInitialized = false;

// MCP初期化
let mcpTools: any[] = [];
let mcpCleanup: () => Promise<void>;
let mcpAgent: any;

// グローバルログバッファーを作成
const mcpLogBuffer: string[] = [];

// コンソールログをオーバーライドして情報をキャプチャ
const originalConsoleLog = console.log;
console.log = function(...args: any[]) {
  originalConsoleLog.apply(this, args);
  
  // 全ての引数をログとして扱う
  const logStr = args.map(arg => {
    if (typeof arg === 'string') return arg;
    if (arg instanceof Error) return arg.stack || arg.message;
    try {
      return JSON.stringify(arg);
    } catch (e) {
      return String(arg);
    }
  }).join(' ');
  
  // MCP関連のログを保存
  if (logStr.includes('MCP tool') && 
     (logStr.includes('received input') || 
      logStr.includes('received result'))) {
    mcpLogBuffer.push(logStr);
  }
  
  // LangChainのツール呼び出し情報を保存
  if (logStr.includes('tool_calls') || 
      logStr.includes('ToolMessage') ||
      logStr.includes('[chain/start]') || 
      logStr.includes('[chain/end]')) {
    mcpLogBuffer.push(logStr);
  }
  
  // バッファサイズを制限する
  if (mcpLogBuffer.length > 200) {
    mcpLogBuffer.shift();
  }
};

// MCP初期化関数
async function initializeMcp(llmKey?: string) {
  try {
    // Default values in case config loading fails
    const defaultLlmConfig: LLMConfig = {
      name: 'Default LLM',
      model_provider: 'openrouter',
      model: 'google/gemini-2.5-flash-preview',
    };

    // Load configuration with error handling
    let config: Config;
    try {
      config = loadConfig('llm_mcp_config.json5');
      console.log("Config loaded successfully");
    } catch (error) {
      console.error("Error loading config:", error);
      config = {
        llm: defaultLlmConfig,
        llms: { 'default': defaultLlmConfig },
        default_llm: 'default',
        mcp_servers: {}
      };
      console.warn("Using default config instead");
    }
    
    // 使用するLLMの選択 - with safety checks
    let llmConfig = defaultLlmConfig;
    
    if (llmKey && config.llms && config.llms[llmKey]) {
      llmConfig = config.llms[llmKey];
    } else if (config.default_llm && config.llms && config.llms[config.default_llm]) {
      llmConfig = config.llms[config.default_llm];
    }
    
    console.log(`Using LLM: ${llmConfig.name} (${llmConfig.model})`);
    
    // 既に初期化済みの場合は再利用
    if (mcpInitialized && mcpTools.length > 0 && mcpAgent) {
      console.log('MCP already initialized, reusing existing instance');
      return { config, tools: mcpTools, llmConfig };
    }
    
    const mcpServers = config.mcp_servers || {};
    console.log(`Initializing ${Object.keys(mcpServers).length} MCP server(s)...`);
    const { tools, cleanup } = await convertMcpToLangchainTools(mcpServers);
    
    // 特定のツールに対してサイズ制限を適用
    const wrappedTools = tools.map(tool => {
      // directory_treeツールのみラップする
      if (tool.name === 'filesystem/directory_tree') {
        // 型アサーションを使用
        const anyTool = tool as any;
        const originalHandler = anyTool.handler;
        anyTool.handler = async (...args: any[]) => {
          console.log('Intercepting directory_tree call with size limit...');
          try {
            // 引数から最大深さを制限
            const params = args[0] || {};
            if (!params.max_depth || params.max_depth > 2) {
              params.max_depth = 2; // 深さを2に制限
            }
            if (!params.max_entries_per_dir || params.max_entries_per_dir > 10) {
              params.max_entries_per_dir = 10; // ディレクトリあたりの最大エントリ数を10に制限
            }
            
            return await originalHandler(params);
          } catch (error) {
            console.error('Error in directory_tree handler:', error);
            return { error: 'ディレクトリツリーの取得中にエラーが発生しました。対象を絞るか、別のコマンドを試してください。' };
          }
        };
        return anyTool;
      }
      return tool;
    });
    
    mcpTools = wrappedTools;
    mcpCleanup = cleanup;
    
    // モデル設定をオーバーライド
    const modelConfig = {
      ...llmConfig,
      temperature: 0.1,  // 創造性と詳細さのバランスを取る
      max_tokens: 5000,  // 十分な長さのレスポンスを許可
    };
    
    // LLMの初期化（カスタマイズされたシステムプロンプト付き）
    const llm = initChatModel({
      modelProvider: llmConfig.model_provider,
      model: llmConfig.model,
      temperature: modelConfig.temperature,
      maxTokens: modelConfig.max_tokens || 5000,
    });

    // ReactAgentの初期化 - インスタンス生成
    mcpAgent = createReactAgent({
      llm,
      tools: wrappedTools,
      checkpointSaver: new MemorySaver(),
    });
    
    // 初期化完了をマーク
    mcpInitialized = true;
    
    return { config, tools: wrappedTools, llmConfig };
  } catch (error) {
    console.error('Error initializing MCP:', error);
    throw error;
  }
}

// アクティブなSSE接続を保持するオブジェクト
type SSEConnection = {
  res: express.Response;
  intervalId: NodeJS.Timeout;
};

const sseConnections: Record<string, SSEConnection[]> = {};

// SSEのためのエンドポイント
app.get('/api/stream/:sessionId', (req, res) => {
  const sessionId = req.params.sessionId || DEFAULT_SESSION_ID;
  
  // SSEヘッダーを設定
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });
  
  // クライアント接続時のメッセージ
  res.write(`data: ${JSON.stringify({ type: 'connected', message: 'Stream connected' })}\n\n`);
  
  // このセッション用のSSEハンドラーを保存
  const intervalId = setInterval(() => {
    try {
      // Check if connection is still writable
      if (res.writable) {
        res.write(`data: ${JSON.stringify({ type: 'keep-alive' })}\n\n`);
        logger.debug(`Keep-alive sent to session ${sessionId}`);
        if (res.flushHeaders && typeof res.flushHeaders === 'function') {
          res.flushHeaders();
        }
      } else {
        // Connection not writable anymore
        clearInterval(intervalId);
        logger.info(`SSE connection for session ${sessionId} no longer writable, cleaning up`);
        // Remove from connections list
        removeConnection(sessionId, res);
      }
    } catch (error) {
      // Error handling if write fails
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Error sending keep-alive to session ${sessionId}: ${errorMessage}`);
      clearInterval(intervalId);
      removeConnection(sessionId, res);
    }
  }, 30000);
  
  // 接続を保存
  if (!sseConnections[sessionId]) {
    sseConnections[sessionId] = [];
  }
  sseConnections[sessionId].push({ res, intervalId });
  
  console.log(`New SSE connection established for session ${sessionId}. Total connections: ${sseConnections[sessionId].length}`);
  
  // クライアント切断時のクリーンアップ
  req.on('close', () => {
    if (sseConnections[sessionId]) {
      // この接続を削除
      sseConnections[sessionId] = sseConnections[sessionId].filter(conn => {
        if (conn.res === res) {
          clearInterval(conn.intervalId);
          return false;
        }
        return true;
      });
      
      if (sseConnections[sessionId].length === 0) {
        delete sseConnections[sessionId];
      }
    }
    console.log(`SSE connection closed for session ${sessionId}`);
  });
});

// メッセージをSSEクライアントに送信する関数
function sendSSEMessage(sessionId: string, message: any) {
  const connections = sseConnections[sessionId];
  if (!connections || connections.length === 0) {
    logger.warn(`No active SSE connections for session ${sessionId}`);
    return;
  }
  
  logger.debug(`Sending message to ${connections.length} connections for session ${sessionId}`);
  
  const data = JSON.stringify(message);
  const eventString = `data: ${data}\n\n`;
  
  let activeConnections = 0;
  connections.forEach(conn => {
    try {
      if (conn.res.writable) {
        conn.res.write(eventString);
        activeConnections++;
        if (conn.res.flushHeaders && typeof conn.res.flushHeaders === 'function') {
          conn.res.flushHeaders();
        }
      } else {
        logger.warn(`Connection not writable for session ${sessionId}, removing`);
        removeConnection(sessionId, conn.res);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error({ type: 'sse_error', sessionId, error: errorMessage }, 
        `Error sending SSE message to session ${sessionId}`);
      removeConnection(sessionId, conn.res);
    }
  });
  
  logger.info({ type: 'sse_message_sent', sessionId, activeConnections }, 
    `Message sent to ${activeConnections}/${connections.length} connections for session-${sessionId}`);
}

// 新しいチャットセッションを作成するエンドポイント
app.post('/api/new-chat', async (req, res) => {
  try {
    // 新しいセッションID生成
    const newSessionId = generateSessionId();
    
    // 空のチャット履歴でセッションを初期化
    getOrCreateSession(newSessionId);
    
    // 空のYAMLファイルを作成
    saveChatHistoryToYaml(newSessionId, []);
    
    res.json({ 
      success: true, 
      sessionId: newSessionId,
    });
  } catch (error) {
    console.error('Error creating new chat:', error);
    res.status(500).json({ 
      error: 'Failed to create new chat session',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

// APIエンドポイント
app.post('/api/chat', async (req, res) => {
  try {
    console.log('Received chat request:', req.body);
    const { message, llmKey, sessionId = DEFAULT_SESSION_ID } = req.body;
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const userParentId = req.body.parentId;
    const agentParentId = userParentId.replace("-user", "-ai");

    // 同じセッションの既存リクエストがあれば停止
    if (activeRequests[sessionId]) {
      abortChatRequest(sessionId);
    }

    // このリクエスト用のAbortControllerを作成
    const abortController = new AbortController();
    activeRequests[sessionId] = abortController;
    
    // セッションデータを取得
    const sessionData = getOrCreateSession(sessionId);
    const { chatHistory, langChainMessages } = sessionData;

    // ユーザーメッセージをチャット履歴に追加
    chatHistory.push({ role: 'user', content: message, parentId: userParentId, isFinalMessage: true, isToolCall: false, displayMessage: true });
    
    // ユーザーメッセージをLangChain形式で追加
    const userMessage = new HumanMessage(message);
    langChainMessages.push(userMessage);
    
    // 現在の会話の状態をログ
    console.log('Chat history length:', chatHistory.length);
    console.log('LangChain messages length:', langChainMessages.length);

    // 設定と MCP ツールを取得（指定されたLLMを使用）
    const { config, llmConfig } = await initializeMcp(llmKey);
    console.log('Using LLM:', llmConfig.name);
    
    // Check if API key exists
    if (llmConfig.model_provider === 'openrouter' && !process.env.OPENROUTER_API_KEY) {
      throw new Error('OPENROUTER_API_KEY is missing in environment variables');
    } else if (llmConfig.model_provider === 'anthropic' && !process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is missing in environment variables');
    } else if (llmConfig.model_provider === 'groq' && !process.env.GROQ_API_KEY) {
      throw new Error('GROQ_API_KEY is missing in environment variables');
    }
    
    try {
      // Add at the beginning of the agent call:
      const stepTimeouts: {[key: string]: NodeJS.Timeout} = {};
      let lastStepTime = Date.now();

      // カレントタイムスタンプをParentIDに設定
      const currentTimestamp = new Date().toISOString();
      const parentId = userParentId;
      
      // ツール呼び出しや思考プロセスの監視用ハンドラー
      let lastToolName = '';
      let toolCallCount = 0;
      
      // ステップハンドラーを定義
      const handleAgentStep = (step: any) => {
        try {
          logger.debug(`Agent step received: ${JSON.stringify({
            actionType: step.action?.type,
            hasTool: !!step.action?.tool,
            hasObservation: step.observation !== undefined
          })}`);
          
          // ステップタイプを確認
          logger.info("current agent action type:", step.action);
          if (step.action) {
            logger.info("agent called tool:", step.action.tool)
            if (step.action.tool) {
              toolCallCount++;
              const toolName = step.action.tool;
              lastToolName = toolName;
              
              // ツール呼び出しメッセージを作成
              const toolInputStr = typeof step.action.toolInput === 'object' 
                ? JSON.stringify(step.action.toolInput, null, 2)
                : String(step.action.toolInput || '');
              
              const toolCallMessage = {
                role: 'tool',
                content: `🔧 **ツール実行**: ${toolName}\n\n**入力パラメータ**:\n\`\`\`json\n${toolInputStr}\n\`\`\``,
                parentId,
                isToolCall: true,
                isFinalMessage: false,
                displayMessage: true
              };
              
              // チャット履歴に追加
              chatHistory.push(toolCallMessage);
              
              // SSEでリアルタイム通知
              sendSSEMessage(sessionId, {
                type: 'tool_call',
                message: toolCallMessage
              });

              logger.debug(`SSE message for tool call ${toolName} sent to session ${sessionId}`);
              
              console.log(`Tool execution: ${toolName} (${toolCallCount})`);
            } else if (step.action.log) {
              // 思考プロセスメッセージを作成
              const thoughtMessage = {
                role: 'assistant',
                content: `💭 **思考プロセス**:\n${step.action.log}`,
                parentId,
                isToolCall: false,
                isFinalMessage: false,
                displayMessage: true
              };
              
              // チャット履歴に追加
              chatHistory.push(thoughtMessage);
              
              // SSEでリアルタイム通知
              sendSSEMessage(sessionId, {
                type: 'thought',
                message: thoughtMessage
              });
              
              console.log(`Thought process detected`);
            }
          }
          
          // ツール実行結果がある場合
          if (step.observation !== undefined && lastToolName) {
            let observationText = typeof step.observation === 'object'
              ? JSON.stringify(step.observation, null, 2)
              : String(step.observation);
              
            // 長すぎる出力は省略（UIで表示しきれない）
            const isLongOutput = observationText.length > 3000;
            const displayText = isLongOutput
              ? observationText.substring(0, 3000) + '... (省略されました)'
              : observationText;
            
            // ツール結果メッセージを作成
            const toolResultMessage = {
              role: 'tool',
              content: `📊 **ツール実行結果** (${lastToolName}):\n\n${displayText}`,
              parentId,
              isToolCall: false,
              isFinalMessage: false,
              displayMessage: true
            };
            
            // チャット履歴に追加
            chatHistory.push(toolResultMessage);
            
            // SSEでリアルタイム通知
            sendSSEMessage(sessionId, {
              type: 'tool_result',
              message: toolResultMessage
            });
            
            console.log(`Tool result received for ${lastToolName}`);
            logger.info(`Tool result received for ${lastToolName}`);
            lastToolName = ''; // ツール名をリセット
          }
          
          // YAMLファイルに中間履歴を保存（リアルタイム更新用）
          saveChatHistoryToYaml(sessionId, chatHistory);
          
          // Add to the step handler:
          const stepId = `step-${Date.now()}`;
          lastStepTime = Date.now();

          // Clear any previous step timeout
          if (stepTimeouts[sessionId]) {
            clearTimeout(stepTimeouts[sessionId]);
          }

          // Set new timeout to detect stuck steps
          stepTimeouts[sessionId] = setTimeout(() => {
            const timeSinceLastStep = Date.now() - lastStepTime;
            logger.warn(`No agent step for ${timeSinceLastStep}ms in session ${sessionId}, may be stuck`);
            
            // Send notification to client
            sendSSEMessage(sessionId, {
              type: 'system_message',
              message: {
                role: 'system',
                content: `処理に時間がかかっています (${Math.round(timeSinceLastStep/1000)}秒経過)`,
                parentId,
                isToolCall: false,
                isFinalMessage: false,
                displayMessage: true
              }
            });
          }, 10000); // 10 seconds without a step is suspicious
          
        } catch (stepError) {
          const errorMessage = stepError instanceof Error ? stepError.message : String(stepError);
          logger.error(`Error in agent step handler: ${errorMessage}`);
          // Still try to send a message about the error
          try {
            const errorNotification = {
              role: 'system',
              content: `エラーが発生しました: ${errorMessage}`,
              parentId,
              isToolCall: false,
              isFinalMessage: false,
              displayMessage: true
            };
            
            chatHistory.push(errorNotification);
            sendSSEMessage(sessionId, {
              type: 'error',
              message: errorNotification
            });
          } catch (notifyError) {
            logger.error(`Failed to send error notification: ${notifyError}`);
          }
        }
      };
      
      const agentFinalState = await mcpAgent.invoke(
        { messages: [new SystemMessage(sessionData.systemPrompt), ...langChainMessages.filter(msg => msg._getType() !== 'system'), userMessage] },
        { 
          configurable: { 
            thread_id: `web-thread-${new Date().getTime()}`,
            max_iterations: 20,  // 最大20ステップまで継続的に実行
            with_agent_state: true,  // エージェントの状態を返すように設定
            callbacks: {
              // ステップごとのコールバック
              handleAgentStep
            }
          },
          signal: abortController.signal 
        }
      );
      
      // 応答から最後のAIメッセージを取得
      const messages = agentFinalState.messages;
      console.log('Agent response received, messages count:', messages.length);
      
      // 最後のAIメッセージを取得
      const lastAiMessage = messages
        .filter((msg: BaseMessage) => msg._getType() === 'ai')
        .pop();
        
      if (!lastAiMessage) {
        throw new Error('No AI response received from agent');
      }
      
      // ReactAgentの実行ステップ構造をより詳細に調査
      // console.log('Agent final state keys:', Object.keys(agentFinalState));
      // console.log('Agent final state type:', agentFinalState.constructor?.name || typeof agentFinalState);
      
      // メッセージの詳細を調査
      // console.log('===== ALL MESSAGES IN AGENT RESPONSE =====');
      // if (Array.isArray(messages)) {
      //   for (let i = 0; i < messages.length; i++) {
      //     const msg = messages[i];
      //     console.log(`Message[${i}] type:`, msg._getType ? msg._getType() : typeof msg);
      //     console.log(`Message[${i}] keys:`, Object.keys(msg));
          
      //     // ツール呼び出し情報を取得
      //     if (msg.additional_kwargs?.tool_calls) {
      //       console.log(`Message[${i}] has tool_calls:`, JSON.stringify(msg.additional_kwargs.tool_calls));
      //     }
          
      //     // ToolMessage からツール実行結果を取得
      //     if (msg._getType && msg._getType() === 'tool') {
      //       console.log(`Message[${i}] is a ToolMessage with content:`, 
      //         msg.content ? (msg.content.length > 100 ? msg.content.substring(0, 100) + '...' : msg.content) : 'N/A');
      //       console.log(`Message[${i}] tool name:`, msg.name);
      //     }
      //   }
      // }
      // console.log('===========================================');
      
      // ツール実行のログを処理
      // エージェントの思考プロセスとツール呼び出しのログを抽出
      const executionSteps = agentFinalState.steps || [];
      const toolCallsLog: string[] = [];
      
      // LangChainチェーンからの直接的なツール呼び出し情報を追加
      if (Array.isArray(messages)) {
        for (const msg of messages) {
          // AIメッセージのtool_callsを追加
          if (msg.additional_kwargs?.tool_calls) {
            for (const toolCall of msg.additional_kwargs.tool_calls) {
              if (toolCall.function && toolCall.function.name) {
                const toolName = toolCall.function.name;
                let toolInput = toolCall.function.arguments || '{}';
                
                try {
                  // JSONの整形
                  const inputObj = JSON.parse(toolInput);
                  toolInput = JSON.stringify(inputObj, null, 2);
                } catch (e) {
                  // JSONとしてパースできなければそのまま使用
                }
                
                toolCallsLog.push(`🔧 ツール呼び出し: ${toolName}\n入力パラメータ: ${toolInput}`);
                console.log(`Added tool call from message: ${toolName}`);
              }
            }
          }
          
          // ToolMessageの結果を追加
          if (msg._getType && msg._getType() === 'tool' && msg.name && msg.content) {
            toolCallsLog.push(`📊 ツール実行結果 (${msg.name}):\n${msg.content.length > 500 ? msg.content.substring(0, 500) + '... (省略)' : msg.content}`);
            console.log(`Added tool result from ToolMessage: ${msg.name}`);
          }
        }
      }
      
      // TerminalログからAIのツール呼び出しを探す
      const terminalLogs = mcpLogBuffer;
      console.log(`TerminalログからAIのツール呼び出しを探します。ログ数: ${terminalLogs.length}`);
      
      // 独立したチェーンログからツール呼び出しを探す
      const toolCallPatterns = [
        // Gemini/GPT-4形式
        /tool_calls".*?"function": {\s*"name": "([^"]+)",\s*"arguments": "([^"]+)"/,
        // 別の形式
        /"name": "([^"]+)",\s*"args": ({.+?}),\s*"id": "/
      ];
      const toolResultPatterns = [
        // ToolMessageの一般的なパターン
        /ToolMessage.*content": "([^"]+)"/,
        // 生のJSON形式
        /"content": "([^"]*)",\s*"tool_call_id": "[^"]+",\s*"name": "([^"]+)"/
      ];
      
      // MCP固有のパターン
      const mcpToolPattern = /MCP tool "([^"]*)"\/"([^"]*)" received input: (.*)/;
      const mcpResultPattern = /MCP tool "([^"]*)"\/"([^"]*)" received result \(size: (\d+)\)/;
      
      // chainの開始終了部分からToolメッセージを抽出する
      let chainLogCapture = false;
      let capturedChainLog = '';
      
      for (const log of terminalLogs) {
        // チェーン処理の開始と終了を捕捉
        if (log.includes('[chain/start]')) {
          chainLogCapture = true;
          capturedChainLog = '';
          continue;
        }
        
        if (chainLogCapture) {
          capturedChainLog += log + '\n';
          
          if (log.includes('[chain/end]')) {
            chainLogCapture = false;
            
            // チェーンログから有用な情報を抽出
            if (capturedChainLog.includes('tool_calls') || capturedChainLog.includes('ToolMessage')) {
              // ツール呼び出しを探す
              const toolCalls = capturedChainLog.match(/"function": {\s*"name": "([^"]+)",\s*"arguments": "([^"]+)"/g);
              if (toolCalls) {
                for (const toolCall of toolCalls) {
                  const nameMatch = toolCall.match(/"name": "([^"]+)"/);
                  const argsMatch = toolCall.match(/"arguments": "([^"]+)"/);
                  
                  if (nameMatch && argsMatch) {
                    const toolName = nameMatch[1];
                    // バックスラッシュの処理
                    const cleanArgs = argsMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
                    
                    try {
                      const args = JSON.parse(cleanArgs);
                      toolCallsLog.push(`🔧 チェーンログからのツール呼び出し: ${toolName}\n入力パラメータ: ${JSON.stringify(args, null, 2)}`);
                      console.log(`Chain log: Found tool call: ${toolName}`);
                    } catch (e) {
                      toolCallsLog.push(`🔧 チェーンログからのツール呼び出し: ${toolName}\n入力パラメータ: ${cleanArgs}`);
                    }
                  }
                }
              }
              
              // ToolMessageを探す
              const toolMessages = capturedChainLog.match(/"type": "constructor",\s*"id": \[\s*"langchain_core",\s*"messages",\s*"ToolMessage"\s*\],\s*"kwargs": {[^}]+}/g);
              if (toolMessages) {
                for (const message of toolMessages) {
                  const contentMatch = message.match(/"content": "([^"]+)"/);
                  const nameMatch = message.match(/"name": "([^"]+)"/);
                  
                  if (contentMatch) {
                    const content = contentMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n');
                    const name = nameMatch ? nameMatch[1] : '不明なツール';
                    toolCallsLog.push(`📊 チェーンログからのツール実行結果 (${name}):\n${content.length > 500 ? content.substring(0, 500) + '... (省略)' : content}`);
                    console.log(`Chain log: Found tool result for ${name}`);
                  }
                }
              }
            }
            
            continue;
          }
        }
        
        // MCP固有のパターン
        const mcpMatch = log.match(mcpToolPattern);
        if (mcpMatch) {
          const [_, serverName, toolName, inputJson] = mcpMatch;
          const toolId = `${serverName}/${toolName}`;
          
          try {
            // 整形された入力JSONを取得
            const inputData = JSON.parse(inputJson);
            toolCallsLog.push(`🔧 MCP ツール実行: ${toolId}\n入力パラメータ: ${JSON.stringify(inputData, null, 2)}`);
            console.log(`MCP log: Found tool call: ${toolId}`);
          } catch (e) {
            toolCallsLog.push(`🔧 MCP ツール実行: ${toolId}\n入力パラメータ: ${inputJson}`);
          }
          continue;
        }
        
        // MCP結果パターン
        const mcpResultMatch = log.match(mcpResultPattern);
        if (mcpResultMatch) {
          const [_, serverName, toolName, sizeStr] = mcpResultMatch;
          const toolId = `${serverName}/${toolName}`;
          const size = parseInt(sizeStr);
          
          toolCallsLog.push(`📊 MCP ツール実行結果 (${toolId}): サイズ ${size} バイトのデータを受信しました`);
          console.log(`MCP log: Found tool result for ${toolId} with size ${size}`);
          continue;
        }
        
        // 通常のツールパターン
        for (const pattern of toolCallPatterns) {
          const match = log.match(pattern);
          if (match) {
            const toolName = match[1];
            let argsStr = match[2];
            
            // バックスラッシュの処理
            const cleanArgs = argsStr.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
            
            try {
              const args = JSON.parse(cleanArgs);
              toolCallsLog.push(`🔧 ツール呼び出し: ${toolName}\n入力パラメータ: ${JSON.stringify(args, null, 2)}`);
              console.log(`Log: Found tool call: ${toolName}`);
            } catch (e) {
              toolCallsLog.push(`🔧 ツール呼び出し: ${toolName}\n入力パラメータ: ${cleanArgs}`);
            }
            break;
          }
        }
        
        // ツール結果パターン
        for (const pattern of toolResultPatterns) {
          const match = log.match(pattern);
          if (match) {
            const content = match[1].replace(/\\"/g, '"').replace(/\\n/g, '\n');
            const toolName = match[2] || '不明なツール';
            
            toolCallsLog.push(`📊 ツール実行結果 (${toolName}):\n${content.length > 500 ? content.substring(0, 500) + '... (省略)' : content}`);
            console.log(`Log: Found tool result for ${toolName}`);
            break;
          }
        }
      }
      
      console.log('Execution steps count:', executionSteps.length);
      
      // ステップから思考プロセスとツール呼び出しを抽出
      for (const step of executionSteps) {
        console.log('Processing step:', JSON.stringify(step, null, 2));
        
        // 思考プロセスがあれば追加
        if (step.action?.log) {
          toolCallsLog.push(`💭 思考プロセス:\n${step.action.log}`);
          console.log('Added thought process');
        }
        
        // ツール呼び出しがあれば追加
        if (step.action?.tool) {
          const toolName = step.action.tool;
          const toolInput = typeof step.action.toolInput === 'object' 
            ? JSON.stringify(step.action.toolInput, null, 2)
            : String(step.action.toolInput || '');
            
          toolCallsLog.push(`🔧 ツール実行: ${toolName}\n入力パラメータ: ${toolInput}`);
          console.log(`Added tool execution: ${toolName}`);
        }
        
        // ツール実行結果があれば追加
        if (step.observation !== undefined) {
          let observationText = typeof step.observation === 'object'
            ? JSON.stringify(step.observation, null, 2)
            : String(step.observation);
            
          // 長すぎる出力は省略
          if (observationText.length > 500) {
            observationText = observationText.substring(0, 500) + '... (省略)';
          }
          
          toolCallsLog.push(`📊 ツール実行結果:\n${observationText}`);
          console.log('Added tool execution result');
        }
      }
      
      // MCP関連のログも探す
      if (process.env.DEBUG_LOGS) {
        const debugLogs = process.env.DEBUG_LOGS.split(',');
        for (const log of debugLogs) {
          if (log.includes('MCP tool') && log.includes('received input')) {
            toolCallsLog.push(`🔍 ${log}`);
          }
        }
      }
      
      // 最終的な応答
      const responseContent = lastAiMessage.content.toString();
      console.log('Response content length:', responseContent.length);
      console.log('Response preview:', responseContent.substring(0, 100) + '...');
      
      // 重複するログエントリを除去
      const uniqueToolLogs = [];
      const seenLogs = new Set();
      const toolNameRegex = /ツール(?:呼び出し|実行): ([^(\n]+)/;
      
      for (const log of toolCallsLog) {
        // ツール名を抽出してキーの一部に使用
        const toolNameMatch = log.match(toolNameRegex);
        const toolName = toolNameMatch ? toolNameMatch[1].trim() : '';
        
        // ログの種類を特定（実行、結果など）
        const logType = log.startsWith('🔧') ? 'call' : 
                        log.startsWith('📊') ? 'result' : 
                        log.startsWith('💭') ? 'thought' : 'other';
        
        // 重複排除するためのキーを作成
        const key = `${logType}-${toolName}-${log.substring(0, 20)}`;
        
        if (!seenLogs.has(key)) {
          seenLogs.add(key);
          uniqueToolLogs.push(log);
        } else {
          console.log(`重複ログをスキップ: ${logType} ${toolName}`);
        }
      }
      
      // ツール実行ログが存在する場合、それも含めてチャット履歴に追加
      if (uniqueToolLogs.length > 0) {
        console.log(`重複除去後のツール実行ログ数: ${uniqueToolLogs.length}件`);
        
        // ツール実行ログをメッセージとして追加
        const toolExecutionLog = uniqueToolLogs.join('\n\n');
        chatHistory.push({ role: 'tool', content: toolExecutionLog, parentId: agentParentId, isFinalMessage: false, isToolCall: true, displayMessage: false });
        
        // すぐに保存する
        saveChatHistoryToYaml(sessionId, chatHistory);
      } else {
        console.log('ツール実行ログなし - 実行ステップ確認:', 
          JSON.stringify(agentFinalState.steps ? agentFinalState.steps.map((s: any) => ({
            type: s.type,
            hasAction: !!s.action,
            actionType: s.action?.type,
            hasTool: !!s.action?.tool,
            hasObservation: s.observation !== undefined
          })) : 'no steps')
        );
        
        // TerminalログからAIのツール呼び出しを探す
        const terminalLogs = mcpLogBuffer;
        console.log(`TerminalログからAIのツール呼び出しを探します。ログ数: ${terminalLogs.length}`);
        
        // 独立したチェーンログからツール呼び出しを探す
        const toolCallPatterns = [
          // Gemini/GPT-4形式
          /tool_calls".*?"function": {\s*"name": "([^"]+)",\s*"arguments": "([^"]+)"/,
          // 別の形式
          /"name": "([^"]+)",\s*"args": ({.+?}),\s*"id": "/
        ];
        const toolResultPatterns = [
          // ToolMessageの一般的なパターン
          /ToolMessage.*content": "([^"]+)"/,
          // 生のJSON形式
          /"content": "([^"]*)",\s*"tool_call_id": "[^"]+",\s*"name": "([^"]+)"/
        ];
        
        // MCP固有のパターン
        const mcpToolPattern = /MCP tool "([^"]*)"\/"([^"]*)" received input: (.*)/;
        const mcpResultPattern = /MCP tool "([^"]*)"\/"([^"]*)" received result \(size: (\d+)\)/;
        
        // chainの開始終了部分からToolメッセージを抽出する
        let chainLogCapture = false;
        let capturedChainLog = '';
        
        for (const log of terminalLogs) {
          // チェーン処理の開始と終了を捕捉
          if (log.includes('[chain/start]')) {
            chainLogCapture = true;
            capturedChainLog = '';
            continue;
          }
          
          if (chainLogCapture) {
            capturedChainLog += log + '\n';
            
            if (log.includes('[chain/end]')) {
              chainLogCapture = false;
              
              // チェーンログから有用な情報を抽出
              if (capturedChainLog.includes('tool_calls') || capturedChainLog.includes('ToolMessage')) {
                // ツール呼び出しを探す
                const toolCalls = capturedChainLog.match(/"function": {\s*"name": "([^"]+)",\s*"arguments": "([^"]+)"/g);
                if (toolCalls) {
                  for (const toolCall of toolCalls) {
                    const nameMatch = toolCall.match(/"name": "([^"]+)"/);
                    const argsMatch = toolCall.match(/"arguments": "([^"]+)"/);
                    
                    if (nameMatch && argsMatch) {
                      const toolName = nameMatch[1];
                      // バックスラッシュの処理
                      const cleanArgs = argsMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
                      
                      try {
                        const args = JSON.parse(cleanArgs);
                        toolCallsLog.push(`🔧 チェーンログからのツール呼び出し: ${toolName}\n入力パラメータ: ${JSON.stringify(args, null, 2)}`);
                        console.log(`Chain log: Found tool call: ${toolName}`);
                      } catch (e) {
                        toolCallsLog.push(`🔧 チェーンログからのツール呼び出し: ${toolName}\n入力パラメータ: ${cleanArgs}`);
                      }
                    }
                  }
                }
                
                // ToolMessageを探す
                const toolMessages = capturedChainLog.match(/"type": "constructor",\s*"id": \[\s*"langchain_core",\s*"messages",\s*"ToolMessage"\s*\],\s*"kwargs": {[^}]+}/g);
                if (toolMessages) {
                  for (const message of toolMessages) {
                    const contentMatch = message.match(/"content": "([^"]+)"/);
                    const nameMatch = message.match(/"name": "([^"]+)"/);
                    
                    if (contentMatch) {
                      const content = contentMatch[1].replace(/\\"/g, '"').replace(/\\n/g, '\n');
                      const name = nameMatch ? nameMatch[1] : '不明なツール';
                      toolCallsLog.push(`📊 チェーンログからのツール実行結果 (${name}):\n${content.length > 500 ? content.substring(0, 500) + '... (省略)' : content}`);
                      console.log(`Chain log: Found tool result for ${name}`);
                    }
                  }
                }
              }
              
              continue;
            }
          }
          
          // MCP固有のパターン
          const mcpMatch = log.match(mcpToolPattern);
          if (mcpMatch) {
            const [_, serverName, toolName, inputJson] = mcpMatch;
            const toolId = `${serverName}/${toolName}`;
            
            try {
              // 整形された入力JSONを取得
              const inputData = JSON.parse(inputJson);
              toolCallsLog.push(`🔧 MCP ツール実行: ${toolId}\n入力パラメータ: ${JSON.stringify(inputData, null, 2)}`);
              console.log(`MCP log: Found tool call: ${toolId}`);
            } catch (e) {
              toolCallsLog.push(`🔧 MCP ツール実行: ${toolId}\n入力パラメータ: ${inputJson}`);
            }
            continue;
          }
          
          // MCP結果パターン
          const mcpResultMatch = log.match(mcpResultPattern);
          if (mcpResultMatch) {
            const [_, serverName, toolName, sizeStr] = mcpResultMatch;
            const toolId = `${serverName}/${toolName}`;
            const size = parseInt(sizeStr);
            
            toolCallsLog.push(`📊 MCP ツール実行結果 (${toolId}): サイズ ${size} バイトのデータを受信しました`);
            console.log(`MCP log: Found tool result for ${toolId} with size ${size}`);
            continue;
          }
          
          // 通常のツールパターン
          for (const pattern of toolCallPatterns) {
            const match = log.match(pattern);
            if (match) {
              const toolName = match[1];
              let argsStr = match[2];
              
              // バックスラッシュの処理
              const cleanArgs = argsStr.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
              
              try {
                const args = JSON.parse(cleanArgs);
                toolCallsLog.push(`🔧 ツール呼び出し: ${toolName}\n入力パラメータ: ${JSON.stringify(args, null, 2)}`);
                console.log(`Log: Found tool call: ${toolName}`);
              } catch (e) {
                toolCallsLog.push(`🔧 ツール呼び出し: ${toolName}\n入力パラメータ: ${cleanArgs}`);
              }
              break;
            }
          }
          
          // ツール結果パターン
          for (const pattern of toolResultPatterns) {
            const match = log.match(pattern);
            if (match) {
              const content = match[1].replace(/\\"/g, '"').replace(/\\n/g, '\n');
              const toolName = match[2] || '不明なツール';
              
              toolCallsLog.push(`📊 ツール実行結果 (${toolName}):\n${content.length > 500 ? content.substring(0, 500) + '... (省略)' : content}`);
              console.log(`Log: Found tool result for ${toolName}`);
              break;
            }
          }
        }
        
        // 追加でログが見つかった場合
        if (toolCallsLog.length > 0) {
          console.log(`追加でツール実行ログを${toolCallsLog.length}件見つけました`);
          // ツール実行ログをメッセージとして追加
          const toolExecutionLog = toolCallsLog.join('\n\n');
          chatHistory.push({ role: 'tool', content: toolExecutionLog, parentId: agentParentId, isFinalMessage: false, isToolCall: true, displayMessage: false });
          
          // すぐに保存する
          saveChatHistoryToYaml(sessionId, chatHistory);
        }
      }
      
      // AIの最終応答をチャット履歴に追加
      chatHistory.push({ role: 'assistant', content: responseContent, parentId: agentParentId, isFinalMessage: true, isToolCall: false, displayMessage: true });
      
      // LangChain形式の履歴にも応答を追加
      langChainMessages.push(new AIMessage(responseContent));
      
      // メッセージ数が多すぎる場合は古いものを削除（システムメッセージは保持）
      if (langChainMessages.length > maxMessagesLength) {
        // システムメッセージを一時保存
        const systemMessages = langChainMessages.filter(msg => msg._getType() === 'system');
        // 新しいメッセージだけを残す（システムメッセージを除く最新の16メッセージ）
        const recentMessages = langChainMessages
          .filter(msg => msg._getType() !== 'system')
          .slice(-16);
        // 配列をクリアして再構築
        langChainMessages.length = 0;
        langChainMessages.push(...systemMessages, ...recentMessages);
        console.log('Trimmed langchain messages to:', langChainMessages.length);
      }
      
      // YAMLファイルに履歴を保存
      saveChatHistoryToYaml(sessionId, chatHistory);
      
      // アクティブリクエスト追跡から削除
      delete activeRequests[sessionId];
      
      res.json({ 
        response: responseContent,
        history: chatHistory,
        llm: llmConfig,
        sessionId
      });
    } catch (invokeError: unknown) {
      console.error('Error invoking MCP Agent:', invokeError);
      
      // AbortError（ユーザーによる停止）の場合は専用メッセージを返す
      if (
        (invokeError instanceof Error && invokeError.name === 'AbortError') || 
        (typeof invokeError === 'object' && invokeError !== null && 'message' in invokeError && 
         typeof invokeError.message === 'string' && invokeError.message.includes('aborted'))
      ) {
        const abortMessage = 'リクエストがキャンセルされました。';
        
        // ここまでのツール実行ログがあれば追加
        if ((invokeError as any).agentState?.steps) {
          const executionSteps = (invokeError as any).agentState.steps || [];
          const toolCallsLog: string[] = [];
          
          // ステップから思考プロセスとツール呼び出しを抽出
          for (const step of executionSteps) {
            if (step.action?.log) {
              toolCallsLog.push(step.action.log);
            }
            
            if (step.action?.tool && step.action?.toolInput) {
              const toolName = step.action.tool;
              const toolInput = typeof step.action.toolInput === 'object' 
                ? JSON.stringify(step.action.toolInput, null, 2)
                : step.action.toolInput;
                
              toolCallsLog.push(`🔧 ツール実行: ${toolName}\n入力パラメータ: ${toolInput}`);
            }
            
            if (step.observation) {
              let observationText = typeof step.observation === 'object'
                ? JSON.stringify(step.observation, null, 2)
                : String(step.observation);
                
              // 長すぎる出力は省略
              if (observationText.length > 500) {
                observationText = observationText.substring(0, 500) + '... (省略)';
              }
              
              toolCallsLog.push(`📊 ツール実行結果:\n${observationText}`);
            }
          }
          
          // ツール実行ログが存在する場合、それも含めてチャット履歴に追加
          if (toolCallsLog.length > 0) {
            // ツール実行ログをメッセージとして追加
            const toolExecutionLog = toolCallsLog.join('\n\n');
            chatHistory.push({ role: 'tool', content: toolExecutionLog, parentId: agentParentId, isFinalMessage: false, isToolCall: true, displayMessage: false });
          }
        }
        
        chatHistory.push({ role: 'assistant', content: abortMessage, parentId: agentParentId, isFinalMessage: true, isToolCall: false, displayMessage: true });
        langChainMessages.push(new AIMessage(abortMessage));
        
        console.log('Request aborted by user');
        
        res.json({
          response: abortMessage,
          history: chatHistory,
          aborted: true,
          sessionId
        });
      } else {
        // その他のエラー発生時は固定メッセージを返す
        const errorMessage = 'すみません、応答の生成中にエラーが発生しました。もう一度お試しください。';
        chatHistory.push({ role: 'assistant', content: errorMessage, parentId: agentParentId, isFinalMessage: true, isToolCall: false, displayMessage: true });
        langChainMessages.push(new AIMessage(errorMessage));
        
        // エラーの詳細をログに記録
        console.error('Detailed error:', invokeError);
        
        // YAMLファイルに履歴を保存（エラー時も）
        saveChatHistoryToYaml(sessionId, chatHistory);
        
        res.json({
          response: errorMessage,
          history: chatHistory,
          error: invokeError instanceof Error ? invokeError.message : String(invokeError),
          llm: llmConfig,
          sessionId
        });
      }
    } finally {
      // クリーンアップ: アクティブリクエスト追跡から削除
      delete activeRequests[sessionId];
    }
  } catch (error) {
    console.error('Error in chat API:', error);
    res.status(500).json({ 
      error: 'An error occurred while processing your request',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

// 利用可能なLLMモデル一覧を取得するエンドポイント
app.get('/api/llms', (req, res) => {
  try {
    const config = loadConfig('llm_mcp_config.json5');
    res.json({
      defaultLlm: config.default_llm,
      llms: config.llms
    });
  } catch (error) {
    console.error('Error fetching LLM models:', error);
    res.status(500).json({ 
      error: 'Failed to fetch LLM models',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

// セッション一覧の取得エンドポイント
app.get('/api/sessions', (req, res) => {
  try {
    const sessionsList = listChatSessions();
    res.json({ sessions: sessionsList });
  } catch (error) {
    console.error('Error listing sessions:', error);
    res.status(500).json({ 
      error: 'Failed to list sessions',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

// 履歴取得エンドポイント
app.get('/api/history/:sessionId?', (req, res) => {
  const sessionId = req.params.sessionId || DEFAULT_SESSION_ID;
  const sessionData = getOrCreateSession(sessionId);
  res.json({ 
    history: sessionData.chatHistory,
    sessionId
  });
});

// カスタムシステムプロンプト設定エンドポイント
app.post('/api/system-prompt', (req, res) => {
  try {
    const { prompt, sessionId = DEFAULT_SESSION_ID } = req.body;
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'Valid prompt string is required' });
    }
    
    // グローバルな定数は変更できないため、関数でオーバーライド
    const newSystemPrompt = `${prompt}`;
    
    // セッションデータを取得
    const sessionData = getOrCreateSession(sessionId);
    
    // セッションのシステムプロンプトを更新
    sessionData.systemPrompt = newSystemPrompt;
    
    // 履歴リセット
    sessionData.chatHistory.length = 0;
    sessionData.langChainMessages.length = 0;
    sessionData.langChainMessages.push(new SystemMessage(newSystemPrompt));
    
    // YAMLファイルに空の履歴を保存
    saveChatHistoryToYaml(sessionId, sessionData.chatHistory);
    
    console.log(`System prompt updated for session ${sessionId}: ${newSystemPrompt.substring(0, 50)}...`);
    
    res.json({
      success: true, 
      message: 'System prompt updated successfully',
      newPrompt: newSystemPrompt,
      sessionId
    });
  } catch (error) {
    console.error('Error updating system prompt:', error);
    res.status(500).json({ 
      error: 'Failed to update system prompt',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

// 履歴リセットエンドポイント
app.post('/api/reset/:sessionId?', (req, res) => {
  const sessionId = req.params.sessionId || DEFAULT_SESSION_ID;
  
  // セッションデータを取得
  const sessionData = getOrCreateSession(sessionId);
  
  // 履歴リセット
  sessionData.chatHistory.length = 0;
  sessionData.langChainMessages.length = 0;
  // システムプロンプトを初期状態に戻す
  sessionData.langChainMessages.push(new SystemMessage(sessionData.systemPrompt));
  
  // YAMLファイルに空の履歴を保存
  saveChatHistoryToYaml(sessionId, sessionData.chatHistory);
  
  res.json({ success: true, message: 'Chat history has been reset', sessionId });
});

// セッション削除エンドポイント
app.delete('/api/sessions/:sessionId', (req, res) => {
  try {
    const { sessionId } = req.params;
    if (!sessionId) {
      return res.status(400).json({ error: 'Session ID is required' });
    }
    
    // セッションをメモリから削除
    sessions.delete(sessionId);
    
    // YAMLファイルを削除
    const filePath = path.join(CHAT_HISTORY_DIR, `${sessionId}.yaml`);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`Deleted session file: ${filePath}`);
    }
    
    res.json({ success: true, message: `Session ${sessionId} deleted successfully` });
  } catch (error) {
    console.error('Error deleting session:', error);
    res.status(500).json({ 
      error: 'Failed to delete session',
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

// ステータスチェックエンドポイント
app.get('/api/status', (req, res) => {
  res.json({
    status: 'ok',
    sessionsCount: sessions.size,
    savedSessionsCount: listChatSessions().length,
    apiKeys: {
      openrouter: process.env.OPENROUTER_API_KEY ? 'present' : 'missing',
      anthropic: process.env.ANTHROPIC_API_KEY ? 'present' : 'missing',
      groq: process.env.GROQ_API_KEY ? 'present' : 'missing'
    },
    systemPrompt: DEFAULT_SYSTEM_PROMPT
  });
});

// すべてのルートをReactアプリケーションにリダイレクト
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../../dist/index.html'));
});

// サーバー起動
const server = app.listen(PORT, () => {
  logger.info(`Server running on http://localhost:${PORT}`);
  logger.info(`Chat history directory: ${CHAT_HISTORY_DIR}`);
  logger.info('Environment variables loaded:');
  logger.info(`- OPENROUTER_API_KEY=${process.env.OPENROUTER_API_KEY ? 'present' : 'missing'}`);
  logger.info(`- ANTHROPIC_API_KEY=${process.env.ANTHROPIC_API_KEY ? 'present' : 'missing'}`);
  logger.info(`- GROQ_API_KEY=${process.env.GROQ_API_KEY ? 'present' : 'missing'}`);
  logger.info(`Using custom system prompt: ${DEFAULT_SYSTEM_PROMPT.substring(0, 50)}...`);
});

// クリーンアップ
process.on('SIGINT', async () => {
  logger.info('Shutting down MCP servers...');
  if (mcpCleanup) {
    await mcpCleanup();
  }
  server.close();
  process.exit(0);
});

function removeConnection(sessionId: string, response: express.Response) {
  if (sseConnections[sessionId]) {
    sseConnections[sessionId] = sseConnections[sessionId].filter(conn => {
      if (conn.res === response) {
        clearInterval(conn.intervalId);
        return false;
      }
      return true;
    });
    
    if (sseConnections[sessionId].length === 0) {
      delete sseConnections[sessionId];
    }
  }
}

export default server; 