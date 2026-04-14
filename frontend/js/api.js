/**
 * api.js — API Gateway クライアント
 * プレゼンテーション層 (S3/CloudFront) → アプリケーション層 (API Gateway + Lambda) の通信
 *
 * 本番環境では config.js で API_BASE を上書きするか、
 * 下記の定数を CloudFront のビルド時に置換する。
 */

(function (global) {
  'use strict';

  /* ── エンドポイント設定 ──
   * デプロイ後は実際の API Gateway URL に変更すること
   * 例: https://abc123def.execute-api.ap-northeast-1.amazonaws.com/prod
   */
  const API_BASE = global.API_BASE || 'https://YOUR_API_ID.execute-api.ap-northeast-1.amazonaws.com/prod';

  const TIMEOUT_MS = 8000;

  /* ── fetchWithTimeout ── */
  function fetchWithTimeout(url, options) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    return fetch(url, { ...options, signal: controller.signal })
      .finally(() => clearTimeout(timer));
  }

  /**
   * スコアを登録する
   * POST /scores
   * @param {string} playerName  プレイヤー名 (最大20文字)
   * @param {number} score       スコア
   * @param {number} levelReached  到達レベル
   * @returns {Promise<{id: number, rank: number}>}
   */
  async function postScore(playerName, score, levelReached) {
    const res = await fetchWithTimeout(`${API_BASE}/scores`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        player_name:   playerName.trim().slice(0, 20) || 'ANONYMOUS',
        score:         score,
        level_reached: levelReached,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`postScore failed: ${res.status} ${body}`);
    }
    return res.json();
  }

  /**
   * ランキング上位を取得する
   * GET /ranking?limit=10
   * @param {number} limit  取得件数 (デフォルト: 10)
   * @returns {Promise<Array<{rank:number, player_name:string, score:number, level_reached:number}>>}
   */
  async function getRanking(limit = 10) {
    const res = await fetchWithTimeout(`${API_BASE}/ranking?limit=${limit}&t=${Date.now()}`);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`getRanking failed: ${res.status} ${body}`);
    }
    return res.json();
  }

  /* ── グローバルに公開 ── */
  global.SnakeAPI = { postScore, getRanking };

})(window);
