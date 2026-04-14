import json
import os
import boto3
import pymysql

_conn = None

def get_conn():
    global _conn
    if _conn and _conn.open:
        return _conn
    sm = boto3.client('secretsmanager')
    secret = json.loads(
        sm.get_secret_value(SecretId=os.environ['SECRET_ARN'])['SecretString']
    )
    _conn = pymysql.connect(
        host=os.environ['DB_HOST'],
        port=int(os.environ['DB_PORT']),
        user=secret['username'],
        password=secret['password'],
        db=os.environ['DB_NAME'],
        charset='utf8mb4',
        connect_timeout=10,
    )
    return _conn

def lambda_handler(event, context):
    """SQSトリガー：キューからスコアを受け取りDBに書き込む"""
    for record in event['Records']:
        body = json.loads(record['body'])
        player_name   = body['player_name']
        score         = int(body['score'])
        level_reached = int(body['level_reached'])

        conn = get_conn()
        try:
            with conn.cursor() as cur:
                # 同じ名前の既存レコードを確認
                cur.execute(
                    "SELECT id, score FROM scores WHERE player_name = %s "
                    "ORDER BY score DESC LIMIT 1",
                    (player_name,)
                )
                existing = cur.fetchone()

                if existing is None:
                    # 新規登録
                    cur.execute(
                        "INSERT INTO scores (player_name, score, level_reached) "
                        "VALUES (%s, %s, %s)",
                        (player_name, score, level_reached)
                    )
                    print(f"[NEW] player={player_name} score={score}")

                elif score > existing[1]:
                    # 既存より高いスコアなら更新
                    cur.execute(
                        "UPDATE scores SET score=%s, level_reached=%s, "
                        "created_at=CURRENT_TIMESTAMP "
                        "WHERE id=%s",
                        (score, level_reached, existing[0])
                    )
                    print(f"[UPDATE] player={player_name} "
                          f"{existing[1]} → {score}")

                else:
                    # 既存以下のスコアは登録しない
                    print(f"[SKIP] player={player_name} "
                          f"score={score} <= best={existing[1]}")

            conn.commit()
        except Exception as e:
            conn.rollback()
            print(f"[ERROR] {e}")
            raise

    return {'batchItemFailures': []}