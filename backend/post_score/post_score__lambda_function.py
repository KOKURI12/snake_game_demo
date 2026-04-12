"""
post_score/lambda_function.py
アプリケーション層 — スコア登録 Lambda
API Gateway: POST /scores

リクエストボディ (JSON):
  {
    "player_name":   string  (必須, max 20文字),
    "score":         int     (必須, >= 0),
    "level_reached": int     (省略可, デフォルト 1)
  }

レスポンス (JSON):
  {
    "id":   int,   -- 挿入された行の ID
    "rank": int    -- 現在のランキング順位
  }

環境変数 (Lambda コンソール or SAM template.yaml で設定):
  DB_HOST     - RDS MySQL エンドポイント
  DB_PORT     - MySQL ポート (デフォルト: 3306)
  DB_NAME     - データベース名
  DB_USER     - ユーザー名
  SECRET_ARN  - Secrets Manager ARN（パスワードを動的取得）
"""

import json
import os
import logging
import boto3          # [修正A追加] Secrets Manager 呼び出しに必要
import pymysql

logger = logging.getLogger()
logger.setLevel(logging.INFO)

# ── DB 接続設定 ──────────────────────────────────────────────
# [修正A] "password" キーを削除
#   モジュールトップレベルで os.environ["DB_PASSWORD"] を評価すると
#   cold start 時点（関数呼び出し前）で KeyError が発生するため。
#   パスワードは get_connection() 内で Secrets Manager から動的取得する。
DB_CONFIG = {
    "host":     os.environ["DB_HOST"],
    "port":     int(os.environ.get("DB_PORT", 3306)),
    "db":       os.environ["DB_NAME"],
    "user":     os.environ["DB_USER"],
    "charset":  "utf8mb4",
    "cursorclass": pymysql.cursors.DictCursor,
    "connect_timeout": 5,
}

# Lambda コンテナ再利用のため、グローバルに接続を保持
_connection   = None
_secret_cache = None   # [修正A追加] パスワードのコンテナ内キャッシュ


# [修正A追加] Secrets Manager からパスワードを取得（コンテナ内キャッシュ）
def _get_password() -> str:
    global _secret_cache
    if _secret_cache is None:
        client = boto3.client("secretsmanager")
        secret = client.get_secret_value(SecretId=os.environ["SECRET_ARN"])
        _secret_cache = json.loads(secret["SecretString"])["password"]
    return _secret_cache


def get_connection():
    global _connection
    if _connection is None or not _connection.open:
        _connection = pymysql.connect(**DB_CONFIG, password=_get_password())  # [修正A] password を動的渡し
    return _connection


# ── CORS ヘッダー ─────────────────────────────────────────────
CORS_HEADERS = {
    "Content-Type":                "application/json",
    "Access-Control-Allow-Origin": "*",          # 本番では CloudFront ドメインに限定
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
}


def response(status_code: int, body: dict) -> dict:
    return {
        "statusCode": status_code,
        "headers":    CORS_HEADERS,
        "body":       json.dumps(body, ensure_ascii=False),
    }


# ── Lambda ハンドラー ─────────────────────────────────────────
def lambda_handler(event, context):
    # CORS プリフライト
    if event.get("httpMethod") == "OPTIONS":
        return response(200, {})

    # ── リクエスト解析 ──
    try:
        body = json.loads(event.get("body") or "{}")
    except json.JSONDecodeError:
        return response(400, {"error": "Invalid JSON"})

    player_name = str(body.get("player_name", "")).strip()[:20] or "ANONYMOUS"
    score_val = body.get("score")
    level_reached = int(body.get("level_reached", 1))

    if score_val is None:
        return response(400, {"error": "'score' is required"})
    try:
        score_val = int(score_val)
        if score_val < 0:
            raise ValueError
    except (ValueError, TypeError):
        return response(400, {"error": "'score' must be a non-negative integer"})

    # ── DB 書き込み ──
    try:
        conn = get_connection()
        with conn.cursor() as cur:
            # スコア挿入
            cur.execute(
                """
                INSERT INTO scores (player_name, score, level_reached)
                VALUES (%s, %s, %s)
                """,
                (player_name, score_val, level_reached),
            )
            new_id = cur.lastrowid

            # ランキング順位を取得（自分より高いスコアの件数 + 1）
            cur.execute(
                "SELECT COUNT(*) + 1 AS rank FROM scores WHERE score > %s",
                (score_val,),
            )
            rank = cur.fetchone()["rank"]

        conn.commit()
        logger.info("Inserted score: id=%d, player=%s, score=%d, rank=%d",
                    new_id, player_name, score_val, rank)

        return response(201, {"id": new_id, "rank": rank})

    except pymysql.MySQLError as e:
        logger.error("DB error: %s", e)
        try:
            if _connection:
                _connection.rollback()
        except Exception:
            pass
        return response(500, {"error": "Database error"})
