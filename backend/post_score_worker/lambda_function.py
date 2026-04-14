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
                cur.execute(
                    "INSERT INTO scores (player_name, score, level_reached) "
                    "VALUES (%s, %s, %s)",
                    (player_name, score, level_reached)
                )
            conn.commit()
            print(f"[OK] player={player_name} score={score}")
        except Exception as e:
            conn.rollback()
            print(f"[ERROR] {e}")
            raise

    return {'batchItemFailures': []}