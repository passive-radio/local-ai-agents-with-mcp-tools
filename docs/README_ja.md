# LangChain連携 MCPクライアント Web UI [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/hideya/mcp-langchain-client-ts/blob/main/LICENSE)

このアプリケーションは、複数の[Model Context Protocol (MCP)](https://modelcontextprotocol.io/)サーバーを呼び出して自律的にタスクを遂行するAIエージェントのWeb UIを提供します。エージェントはLangChainのReActフレームワークを活用し、推論やタスク分解を行います。

## 主な特徴

- **モダンなWebインターフェース**：ダークモード対応のクリーンで使いやすいUI
- **セッション管理**：複数の会話セッションを作成・管理可能
- **多様なLLM対応**：以下を含む複数の言語モデルを切り替えて利用可能
  - OpenAI GPT-4.1
  - Google Gemini 2.5 Flash
  - Anthropic Claude 3.7 Sonnet
  - その他設定可能なモデル
- **多彩なツール連携（MCPサーバー）**：
  - Brave SearchによるWeb検索
  - ファイルシステム操作
  - Playwrightによるブラウザ自動操作
  - 天気情報取得
  - Googleカレンダー連携
  - 時刻取得
  - タスク分解（sequential thinking）
  - メモリ永続化
- **チャット履歴の永続化**：会話履歴はYAML形式で保存
- **システムプロンプトのカスタマイズ**：エージェントの振る舞いを自由に調整可能

## 必要環境

- Node.js 16以上
- Node.jsベースMCPサーバー用にnpm 7以上（`npx`）
- PythonベースMCPサーバー用に`uv`（`uvx`）
- 一部MCPサーバー用にDocker
- OpenAI, Google, Anthropic, OpenRouter等のAPIキー
- Brave APIキー（Web検索用）
- Googleカレンダー連携用にGoogle Cloudプロジェクト（Calendar API有効化）

## セットアップ手順

1. 依存パッケージのインストール:
   ```bash
   npm install
   ```

2. APIキーの設定:
   ```bash
   cp .env.template .env
   ```
   `.env`ファイルに各種APIキーを記入してください（このファイルはgit管理外です）。

3. LLMやMCPサーバーの設定（`llm_mcp_config.json5`）:
   - [JSON5](https://json5.org/)形式（コメントや末尾カンマ可）
   - `${VAR_NAME}`で環境変数参照可
   - `llms`セクションで複数LLMを設定
   - `mcp_servers`セクションでMCPサーバーを定義

## アプリケーションの起動

WebサーバーとUIの起動:
```bash
npm start
```

詳細ログ付きで起動:
```bash
npm run start:v
```

コマンドラインオプションの確認:
```bash
npm run start:h
```

デフォルトで http://localhost:3000 でWeb UIが利用可能です。

## MCPサーバー連携

### Googleカレンダー連携

Googleカレンダー連携には [nspady/google-calendar-mcp](https://github.com/nspady/google-calendar-mcp) を利用します。利用手順：

1. Google Calendar MCPリポジトリをクローン：
   ```bash
   git clone https://github.com/nspady/google-calendar-mcp.git
   cd google-calendar-mcp
   ```

2. Google Calendar MCPサーバーのセットアップ：
   - Google Cloudプロジェクト作成＆Calendar API有効化
   - OAuth 2.0クレデンシャル（Client ID/Secret）作成
   - `gcp-oauth.keys.json`としてダウンロード
   - 依存パッケージインストール：`npm install`
   - 認証フロー実行：`npm run auth`
   - ビルド：`npm run build`

3. `llm_mcp_config.json5`にローカルGoogle Calendar MCPサーバーを追加：
   ```json
   "google-calendar": {
     "command": "node",
     "args": ["<プロジェクトフォルダへの絶対パス>/build/index.js"]
   }
   ```
   `<プロジェクトフォルダへの絶対パス>`はご自身の環境に合わせて書き換えてください。

4. これで自然言語でカレンダーイベントの作成・取得・更新・検索が可能になります。

## 使い方

1. ブラウザでWeb UIを開く
2. 会話セッションを選択または新規作成
3. 好きなLLMモデルを選択
4. メッセージを入力して送信
5. エージェントが内容を解析し、必要に応じて各種ツールを自律的に活用します
6. 複雑な依頼はタスク分解ツールで自動的に分割・実行されます

## サンプルクエリ

- 「明日のサンフランシスコの天気は？」
- 「AI技術に関する最新ニュースを要約して」
- 「渋谷で明日夜4人で予約できるレストランを探して」
- 「来週月曜14時にチームミーティングの予定をカレンダーに追加して」
- 「このプロジェクト内の特定ファイルの内容を説明して」
- 「来週の自分の予定を一覧表示し、重複や空き時間を教えて」
- 「金曜15時の歯医者のリマインダーを追加して」
- 「来週チーム全員が集まれる会議時間を探して」

## 設定

設定パネルからシステムプロンプトを自由に編集できます。`llm_mcp_config.json5`で利用する言語モデルやMCPサーバーもカスタマイズ可能です。

## ライセンス

このプロジェクトはMITライセンスで公開されています。詳細はLICENSEファイルをご覧ください。 