# Snake Game — AWS 3層アーキテクチャ構成

## 概要

スネークゲームを AWS 上で運用するための 3層アーキテクチャ構成です。
静的フロントエンドの高速配信、サーバーレス API によるスコア管理、RDS によるランキングデータ永続化を実現します。

---

## アーキテクチャ全体図

```
ユーザー (ブラウザ / スマートフォン)
        │
        │ HTTPS
        ▼
┌───────────────────────────────────────┐
│  プレゼンテーション層                  │
│                                       │
│  CloudFront (CDN・HTTPS 終端)         │
│       │                               │
│       ▼                               │
│  S3 Bucket (静的ファイル配信)          │
│  ├── index.html                       │
│  ├── css/style.css                    │
│  └── js/                             │
│      ├── api.js                       │
│      └── snake.js                    │
└───────────────────────────────────────┘
        │
        │ API 呼び出し (HTTPS / JSON)
        ▼
┌───────────────────────────────────────┐
│  アプリケーション層                   │
│                                       │
│  API Gateway (HTTP API)               │
│  ├── POST /scores  ──▶ Lambda         │
│  │                    post_score      │
│  └── GET  /ranking ──▶ Lambda         │
│                        get_ranking    │
└───────────────────────────────────────┘
        │
        │ VPC 内通信 (MySQL 3306)
        │ VPC Interface/Gateway エンドポイント経由
        ▼
┌───────────────────────────────────────┐
│  データ層                             │
│                                       │
│  RDS MySQL 8.0 (プライベートサブネット)│
│  └── scores テーブル                  │
│      ├── player_name                  │
│      ├── score                        │
│      ├── level_reached                │
│      └── created_at                   │
└───────────────────────────────────────┘
```

---

## フォルダ構成

```
snake_game_demo/
│
├── frontend/                        # プレゼンテーション層 (S3 + CloudFront)
│   ├── index.html                   # メインページ（ランキング表示・スコア登録モーダル）
│   ├── css/
│   │   └── style.css                # スタイル（レスポンシブ・モバイル対応）
│   └── js/
│       ├── api.js                   # API Gateway クライアント
│       └── snake.js                 # ゲームロジック（ESC ポーズ・スワイプ操作対応）
│
├── backend/                         # アプリケーション層 (API Gateway + Lambda)
│   ├── post_score/
│   │   └── lambda_function.py       # スコア登録 Lambda (POST /scores)
│   ├── get_ranking/
│   │   └── lambda_function.py       # ランキング取得 Lambda (GET /ranking)
│   └── layer/                       # PyMySQL Lambda Layer
│       └── requirements.txt         # SAM が sam build 時に自動インストール
│
└── infrastructure/                  # IaC + データ層定義
    ├── template.yaml                # SAM テンプレート（全 AWS リソース定義）
    └── sql/
        └── schema.sql               # RDS MySQL スキーマ定義（仕様ドキュメント兼緊急手動適用用）
```

---

## 各層の設計詳細

### プレゼンテーション層（S3 + CloudFront）

| 項目 | 内容 |
|---|---|
| S3 バケット | パブリックアクセス全遮断、OAC 経由で CloudFront のみ許可 |
| CloudFront | HTTPS 強制（HTTP → HTTPS リダイレクト）、HTTP/2 and HTTP/3 対応 |
| キャッシュ | CachingOptimized ポリシー適用、静的ファイルを CDN でキャッシュ |
| 配信エリア | PriceClass_200（北米・欧州・アジア） |

**ゲームの主な機能**

- ESC キー / ボタンでポーズ・再開
- スマートフォン・タブレット対応（D-pad ボタン・スワイプ操作）
- レスポンシブレイアウト（デスクトップ・モバイル自動切り替え）
- タブ非表示時の自動ポーズ
- ゲームオーバー後のスコア登録モーダル
- リアルタイムランキング表示

---

### アプリケーション層（API Gateway + Lambda）

#### API 一覧

| メソッド | パス | 説明 | Lambda 関数 |
|---|---|---|---|
| POST | `/scores` | スコアを登録する | `post_score` |
| GET | `/ranking` | ランキング上位を取得する | `get_ranking` |

#### POST /scores

**リクエスト**
```json
{
  "player_name":   "PLAYER_A",
  "score":         20,
  "level_reached": 4
}
```

**レスポンス（201 Created）**
```json
{
  "id":   42,
  "rank": 3
}
```

#### GET /ranking

**クエリパラメータ**

| パラメータ | デフォルト | 最大 | 説明 |
|---|---|---|---|
| `limit` | 10 | 100 | 取得件数 |

**レスポンス（200 OK）**
```json
[
  {
    "rank": 1,
    "player_name": "PLAYER_A",
    "score": 25,
    "level_reached": 6,
    "played_at": "2026-04-11T10:00:00"
  }
]
```

#### Lambda 設計ポイント

- ランタイム: Python 3.12（ARM64 / Graviton2 でコスト最適化）
- コネクション再利用: グローバル変数でコンテナ再利用時の接続コスト削減
- パスワード管理: Secrets Manager から実行時に動的取得（コンテナ内キャッシュ）
- タイムアウト: 15秒
- VPC 内配置: RDS へはプライベート通信のみ
- CORS: API Gateway レベルで CloudFront ドメインのみ許可

---

### データ層（RDS MySQL）

#### scores テーブル

```sql
CREATE TABLE IF NOT EXISTS scores (
    id            INT UNSIGNED      NOT NULL AUTO_INCREMENT,
    player_name   VARCHAR(20)       NOT NULL DEFAULT 'ANONYMOUS',
    score         SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    level_reached TINYINT UNSIGNED  NOT NULL DEFAULT 1,
    created_at    TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    INDEX idx_score_desc  (score DESC, created_at ASC),
    INDEX idx_player_name (player_name),
    INDEX idx_created_at  (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE utf8mb4_unicode_ci;
```

> `sam deploy` 時に Custom Resource（SchemaInitFunction）が自動適用します。手動実行は不要です。

#### RDS 設定

| 項目 | dev / stg | prod | 備考 |
|---|---|---|---|
| エンジン | MySQL 8.0.40 | MySQL 8.0.40 | |
| インスタンスクラス | db.t4g.micro | db.t4g.small | Stage パラメータで自動選択 |
| ストレージ | gp3 / 20GB | gp3 / 20GB | 自動スケールアップ可 |
| 暗号化 | 有効 | 有効 | |
| バックアップ保持 | 1日 | 7日 | Stage パラメータで自動選択 |
| Multi-AZ | 無効 | 有効 | Stage パラメータで自動選択 |
| DeletionProtection | 無効 | 有効 | Stage パラメータで自動選択 |
| パブリックアクセス | 無効 | 無効 | Lambda SG からの 3306 のみ許可 |
| パスワード管理 | Secrets Manager | Secrets Manager | ManageMasterUserPassword で自動生成 |

---

## デプロイ手順

### 前提条件

- AWS CLI v2 設定済み（`aws configure`）
- AWS SAM CLI インストール済み（`sam --version`）
- Python 3.12 インストール済み
- 対象 AWS リージョン: `ap-northeast-1`（東京）推奨

---

### 事前準備 — VPC・サブネット・ルートテーブルの確認

以下のリソースを事前に用意してください（既存 VPC を使用する場合はそのまま利用可）。

```
VPC (例: 10.0.0.0/16)
├── プライベートサブネット1 (例: 10.0.1.0/24) — ap-northeast-1a
├── プライベートサブネット2 (例: 10.0.2.0/24) — ap-northeast-1c
└── プライベートサブネットに紐づくルートテーブル ID (rtb-xxxxxxxxx)
```

> インターネットゲートウェイ・NAT Gateway は不要です。
> VPC エンドポイント（CloudWatch Logs / Secrets Manager / S3）が `sam deploy` で自動作成されるため、
> Lambda はインターネットを経由せず AWS サービスと通信します。

---

### Step 1 — PyMySQL Lambda Layer の確認

`backend/layer/requirements.txt` が存在することを確認してください（リポジトリに含まれています）。

```
backend/layer/requirements.txt
  pymysql==1.1.1
```

`sam build` 時に SAM が自動でインストールするため、**手動での pip install は不要**です。

---

### Step 2 — SAM ビルド

```bash
cd infrastructure
sam build
```

---

### Step 3 — SAM デプロイ（初回）

```bash
sam deploy --guided
```

対話形式で以下を入力します。

| 項目 | 入力例 | 備考 |
|---|---|---|
| Stack Name | `snake-game-stack` | |
| AWS Region | `ap-northeast-1` | |
| Stage | `dev` or `prod` | prod 時は MultiAZ・DeletionProtection が自動有効化 |
| DBName | `snake_game` | |
| DBUser | `admin` | |
| VpcId | `vpc-xxxxxxxxx` | |
| PrivateSubnet1 | `subnet-xxxxxxxxx` | |
| PrivateSubnet2 | `subnet-yyyyyyyyy` | |
| PrivateRouteTable | `rtb-xxxxxxxxx` | S3 Gateway エンドポイント追加先 |
| Confirm changes before deploy | `y` | |
| Allow SAM CLI IAM role creation | `y` | |

> **パスワードについて**: `DBPassword` パラメータは廃止されました。
> RDS の `ManageMasterUserPassword` により Secrets Manager にパスワードが自動生成されます。
> デプロイ後、`DBSecretArn` 出力値で参照できます。

---

### Step 4 — データベース初期化（自動）

`sam deploy` が完了すると、Custom Resource（SchemaInitFunction）が自動でスキーマを適用します。
**手動での mysql コマンド実行は不要です。**

デプロイログで以下を確認してください。

```
SchemaInitializer     CREATE_COMPLETE
```

> 2回目以降のデプロイでは `CREATE TABLE IF NOT EXISTS` により冪等に動作します。
> 緊急時の手動適用が必要な場合は `infrastructure/sql/schema.sql` を参照してください。

---

### Step 5 — フロントエンドの API エンドポイント設定

デプロイ出力の `ApiEndpoint` を `frontend/index.html` に設定します。

```html
<!-- index.html 内のコメントを外して URL を変更 -->
<script>
  window.API_BASE = 'https://xxxxxxxxxx.execute-api.ap-northeast-1.amazonaws.com/prod';
</script>
```

---

### Step 6 — フロントエンドを S3 へアップロード

```bash
# デプロイ出力の FrontendBucketName を使用
aws s3 sync frontend/ s3://<BUCKET_NAME>/ --delete

# CloudFront キャッシュを無効化
aws cloudfront create-invalidation \
  --distribution-id <DISTRIBUTION_ID> \
  --paths "/*"
```

---

### Step 7 — 動作確認

デプロイ出力の `CloudFrontURL` にアクセスしてゲームが表示されれば完了です。

```
https://xxxxxxxxxxxxxxxx.cloudfront.net
```

---

## 2回目以降のデプロイ

```bash
cd infrastructure
sam build && sam deploy
```

フロントエンドのみ更新する場合は Step 6 のみ実行します。

---

## 環境変数一覧（Lambda）

SAM テンプレートで自動設定されます。手動設定が必要な場合は Lambda コンソールから変更してください。

| 変数名 | 説明 | 設定箇所 |
|---|---|---|
| `DB_HOST` | RDS エンドポイント | template.yaml で自動設定 |
| `DB_PORT` | MySQL ポート（デフォルト: 3306） | template.yaml |
| `DB_NAME` | データベース名 | SAM パラメータ |
| `DB_USER` | DB ユーザー名 | SAM パラメータ |
| `SECRET_ARN` | Secrets Manager ARN（パスワード動的取得） | template.yaml で自動設定 |

---

## コスト概算（東京リージョン / 月額）

| サービス | 想定利用量 | 概算コスト |
|---|---|---|
| CloudFront | 10GB 転送 + 100万リクエスト | 約 $1–2 |
| S3 | 1MB ストレージ + PUT/GET | 約 $0.01 以下 |
| API Gateway | 10万リクエスト | 約 $0.10 |
| Lambda | 10万実行 × 256MB × 1秒 | 無料枠内 |
| RDS db.t4g.micro (dev) | 730時間稼働 | 約 $13–15 |
| VPC Interface エンドポイント | logs / secretsmanager × 2AZ | 約 $29 |
| **合計 (dev)** | | **約 $43–46 / 月** |

> **コスト削減のヒント**:
> - RDS を停止（開発時）すると $13–15 を節約できます。
> - VPC エンドポイントは常時課金のため、開発終了時はスタックごと削除することを推奨します（`sam delete`）。
> - prod（db.t4g.small + MultiAZ）では RDS が約 $40–50 となり合計 $70–80 程度になります。

---

## セキュリティ考慮事項

- S3 バケットはパブリックアクセス全遮断（CloudFront OAC 経由のみ）
- RDS はプライベートサブネット配置、パブリックアクセス無効
- Lambda から RDS への通信は VPC 内で完結
- CORS は API Gateway レベルで CloudFront ドメインのみ許可
- DB パスワードは Secrets Manager で管理（`ManageMasterUserPassword` により自動生成・ローテーション）
- VPC エンドポイントにより Lambda からの AWS サービス通信はインターネットを経由しない
- prod 環境では DeletionProtection が自動有効化され、誤削除を防止

---

## ゲーム操作方法

| 操作 | キーボード | モバイル |
|---|---|---|
| 移動 | 矢印キー / WASD | D-pad ボタン / スワイプ |
| スタート / リトライ | SPACE | START ボタン |
| ポーズ / 再開 | ESC | PAUSE / RESUME ボタン |

### レベル進行

| レベル | 必要スコア | 速度 |
|---|---|---|
| Lv 1 | 0 | 180ms/tick |
| Lv 2 | 5 | 150ms/tick |
| Lv 3 | 10 | 135ms/tick |
| Lv 4 | 15 | 120ms/tick |
| Lv 5 | 20 | 105ms/tick |
| Lv 6 | 25 | 90ms/tick |
| Lv 10（最大） | 45 | 60ms/tick |
