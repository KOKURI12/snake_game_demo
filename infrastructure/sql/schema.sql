-- ============================================================
-- schema.sql — データ層（RDS MySQL）
-- Snake Game スコア管理スキーマ
-- ============================================================
--
-- 【適用方法について】
--   sam deploy 時: infrastructure/template.yaml の SchemaInitFunction
--                  (Custom Resource) が CREATE TABLE のみを自動適用する。
--                  手動実行は不要。
--
--   このファイルの用途:
--     1. スキーマ定義の仕様ドキュメント（正）
--     2. Custom Resource が到達不能な場合の緊急手動適用
--     3. ローカル開発環境での初期化
--
--   以下の項目は Custom Resource では自動適用されない（手動のみ）:
--     - CREATE DATABASE / USE
--     - サンプルデータ INSERT（開発・動作確認用）
--     - VIEW v_ranking
-- ============================================================

CREATE DATABASE IF NOT EXISTS snake_game
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE snake_game;

-- ── スコアテーブル ────────────────────────────────────────────
-- ランキング・プレイヤー情報・スコアを一元管理
CREATE TABLE IF NOT EXISTS scores (
    id             INT UNSIGNED    NOT NULL AUTO_INCREMENT,
    player_name    VARCHAR(20)     NOT NULL DEFAULT 'ANONYMOUS' COMMENT 'プレイヤー名',
    score          SMALLINT UNSIGNED NOT NULL DEFAULT 0           COMMENT '取得スコア',
    level_reached  TINYINT UNSIGNED  NOT NULL DEFAULT 1           COMMENT '到達レベル',
    created_at     TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'プレイ日時',

    PRIMARY KEY (id),

    -- ランキング取得クエリ (ORDER BY score DESC) の高速化
    INDEX idx_score_desc (score DESC, created_at ASC),

    -- プレイヤー別履歴検索
    INDEX idx_player_name (player_name),

    -- 日付範囲検索
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci
  COMMENT='スネークゲーム スコアテーブル';


-- ============================================================
-- サンプルデータ（開発・動作確認用）
-- ※ Custom Resource では自動適用されない
-- ============================================================
INSERT INTO scores (player_name, score, level_reached) VALUES
    ('PLAYER_A',  25, 5),
    ('PLAYER_B',  20, 4),
    ('PLAYER_C',  15, 3),
    ('PLAYER_D',  10, 2),
    ('PLAYER_E',   5, 1);


-- ============================================================
-- ランキング取得ビュー（参考：Lambda では直接 SQL を使用）
-- ※ Custom Resource では自動適用されない
-- ============================================================
CREATE OR REPLACE VIEW v_ranking AS
SELECT
    ROW_NUMBER() OVER (ORDER BY score DESC, created_at ASC) AS rank,
    player_name,
    score,
    level_reached,
    created_at AS played_at
FROM scores
ORDER BY score DESC, created_at ASC
LIMIT 100;
