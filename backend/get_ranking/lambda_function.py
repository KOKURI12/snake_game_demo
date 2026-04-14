"""
get_ranking/lambda_function.py
アプリケーション層 — ランキング取得 Lambda
API Gateway: GET /ranking?limit=10

クエリパラメータ:
  limit  (省略可, デフォルト: 10, 最大: 100)

レスポンス (JSON Array):
  [
    {
      "rank":          int,
      "player_name":   string,
      "score":         int,
      "level_reached": int,
      "played_at":     string  (ISO 8601)
    },
    ...
  ]

環境変数 (Lambda コンソール or SAM template.yaml で設定):
  DB_HOST, DB_PORT, DB_NAME, DB_USER, SECRET_ARN
"""

import json
import os
import logging
import boto3          # [修正A追加] Secrets Manager 呼び出しに必要
import pymysql
from datetime import datetime

logger = logging.getLogger()
logger.setLevel(logging.INFO)

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


CORS_HEADERS = {
    "Content-Type":                "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Cache-Control": "no-cache, no-store",
}


def response(status_code: int, body) -> dict:
    return {
        "statusCode": status_code,
        "headers":    CORS_HEADERS,
        "body":       json.dumps(body, ensure_ascii=False, default=str),
    }


def lambda_handler(event, context):
    # CORS プリフライト
    if event.get("httpMethod") == "OPTIONS":
        return response(200, {})

    # ── limit パラメータ ──
    params = event.get("queryStringParameters") or {}
    try:
        limit = max(1, min(100, int(params.get("limit", 10))))
    except (ValueError, TypeError):
        limit = 10

    # ── DB 読み取り ──
    try:
        conn = get_connection()
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    player_name,
                    score,
                    level_reached,
                    created_at AS played_at
                FROM scores
                ORDER BY score DESC, created_at ASC
                LIMIT %s
                """,
                (limit,),
            )
            rows = cur.fetchall()

        # ランキング番号を付与
        result = []
        for i, row in enumerate(rows):
            result.append({
                "rank":          i + 1,
                "player_name":   row["player_name"],
                "score":         row["score"],
                "level_reached": row["level_reached"],
                "played_at":     row["played_at"].isoformat()
                                 if isinstance(row["played_at"], datetime)
                                 else str(row["played_at"]),
            })

        logger.info("Returned %d ranking entries", len(result))
        return response(200, result)

    except pymysql.MySQLError as e:
        logger.error("DB error: %s", e)
        return response(500, {"error": "Database error"})
