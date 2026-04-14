import json
import os
import boto3

def lambda_handler(event, context):
    """スコアをSQSキューに送信して即座に202を返す"""
    try:
        body = json.loads(event.get('body', '{}'))
        player_name   = body.get('player_name', 'ANONYMOUS')[:20]
        score         = int(body.get('score', 0))
        level_reached = int(body.get('level_reached', 1))

        # バリデーション
        if not player_name:
            player_name = 'ANONYMOUS'
        if score < 0:
            score = 0

        # SQSにメッセージ送信
        sqs = boto3.client('sqs')
        sqs.send_message(
            QueueUrl=os.environ['SQS_QUEUE_URL'],
            MessageBody=json.dumps({
                'player_name':   player_name,
                'score':         score,
                'level_reached': level_reached,
            })
        )

        return {
            'statusCode': 202,
            'headers': {'Content-Type': 'application/json'},
            'body': json.dumps({'message': 'Score accepted'})
        }

    except Exception as e:
        print(f"[ERROR] {e}")
        return {
            'statusCode': 500,
            'headers': {'Content-Type': 'application/json'},
            'body': json.dumps({'error': str(e)})
        }