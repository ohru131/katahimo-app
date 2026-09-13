import {
  getAdminSettings,
  resolveGeminiApiKey,
  saveGeminiApiKey,
  saveGeminiModelSettings,
  saveGoogleChatWebhookSettings,
  saveReceiptDeadlineSettings,
} from '@katahimo/core';
import type { ResolvedSession } from '@katahimo/core/usecases';
import { RECEIPT_CANCELLABLE_DAYS_MAX, RECEIPT_CLOSING_DAY_MAX } from '@katahimo/db/schema';
import { Hono } from 'hono';
import type { Container } from '../container';
import { getAuthenticatedSession } from '../session';

/**
 * 整数かつ指定範囲内か。JSONで来た値をそのままDBへ渡すと、範囲外はCHECK制約違反(23514)
 * という分かりにくいエラーで初めて気付く形になるため、ここで弾いて400にする(doc/14 §1.6)。
 * 小数や文字列も落とす(`'3'` や `3.5` を締め日として受けない)。
 */
function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

/**
 * GAS版の各getXXXForAdmin/saveXXXForAdminの `!session.isAdmin` チェックに対応。
 * 管理者以外には403を返す(GAS版は`{success:false, message:'権限がありません。'}`を200で
 * 返していたが、RESTらしく403にする)。
 */
function isAdmin(session: ResolvedSession | null): session is ResolvedSession {
  return !!session && session.isAdmin;
}

export function createSettingsRoutes(container: Container) {
  const app = new Hono();

  /**
   * 現在の管理者設定を返す。GAS版のgetGeminiApiKeyForAdmin等をまとめたもの。
   * Gemini APIキーは平文を返さず、設定済みかどうか(hasGeminiApiKey)と
   * 末尾数文字(geminiApiKeyPreview)だけをusecaseから受け取ってそのまま返す。
   */
  app.get('/admin', async (c) => {
    const session = await getAuthenticatedSession(c, container);
    if (!session) return c.json({ code: 'unauthenticated', message: '未ログインです' }, 401);
    if (!isAdmin(session)) return c.json({ code: 'forbidden', message: '権限がありません' }, 403);

    const settings = await getAdminSettings(container, session.tenantId);
    return c.json({ settings });
  });

  /** GAS版saveGeminiApiKeyForAdmin相当。空文字は拒否される(usecase側のガード)。 */
  app.post('/admin/gemini-key', async (c) => {
    const session = await getAuthenticatedSession(c, container);
    if (!session) return c.json({ code: 'unauthenticated', message: '未ログインです' }, 401);
    if (!isAdmin(session)) return c.json({ code: 'forbidden', message: '権限がありません' }, 403);

    const body = await c.req.json().catch(() => null);
    if (typeof body?.apiKey !== 'string') {
      return c.json({ ok: false, message: 'apiKey が必要です' }, 400);
    }
    const result = await saveGeminiApiKey(container, session.tenantId, body.apiKey);
    return c.json(result);
  });

  /** GAS版saveGeminiModelSettingsForAdmin相当。 */
  app.post('/admin/gemini-models', async (c) => {
    const session = await getAuthenticatedSession(c, container);
    if (!session) return c.json({ code: 'unauthenticated', message: '未ログインです' }, 401);
    if (!isAdmin(session)) return c.json({ code: 'forbidden', message: '権限がありません' }, 403);

    const body = await c.req.json().catch(() => null);
    if (typeof body?.reportModel !== 'string' || typeof body?.ocrModel !== 'string') {
      return c.json({ ok: false, message: 'reportModel, ocrModel が必要です' }, 400);
    }
    const result = await saveGeminiModelSettings(
      container,
      session.tenantId,
      body.reportModel,
      body.ocrModel,
    );
    return c.json(result);
  });

  /** GAS版saveGoogleChatWebhookSettingsForAdmin相当。 */
  app.post('/admin/gchat-webhooks', async (c) => {
    const session = await getAuthenticatedSession(c, container);
    if (!session) return c.json({ code: 'unauthenticated', message: '未ログインです' }, 401);
    if (!isAdmin(session)) return c.json({ code: 'forbidden', message: '権限がありません' }, 403);

    const body = await c.req.json().catch(() => null);
    if (typeof body?.reportWebhookUrl !== 'string' || typeof body?.receiptWebhookUrl !== 'string') {
      return c.json({ ok: false, message: 'reportWebhookUrl, receiptWebhookUrl が必要です' }, 400);
    }
    const result = await saveGoogleChatWebhookSettings(
      container,
      session.tenantId,
      body.reportWebhookUrl,
      body.receiptWebhookUrl,
    );
    return c.json(result);
  });

  /**
   * 領収書の締め日設定(doc/14 §10)。領収書を取り消せる期限がここから導かれる。
   *
   * 値域はDBのCHECK制約でも縛っているが、ここでも見る。23514で返すと利用者には
   * 何が悪いのか分からないため(doc/14 §1.6の方針)。
   */
  app.post('/admin/receipt-deadline', async (c) => {
    const session = await getAuthenticatedSession(c, container);
    if (!session) return c.json({ code: 'unauthenticated', message: '未ログインです' }, 401);
    if (!isAdmin(session)) return c.json({ code: 'forbidden', message: '権限がありません' }, 403);

    const body = await c.req.json().catch(() => null);
    const closingDay = body?.closingDay;
    // nullは「月末」という意味を持つ正当な値なので、未指定(undefined)とは区別する。
    if (closingDay !== null && !isIntegerInRange(closingDay, 1, RECEIPT_CLOSING_DAY_MAX)) {
      return c.json(
        {
          ok: false,
          message: `締め日は1〜${RECEIPT_CLOSING_DAY_MAX}の整数か、月末(null)で指定してください。`,
        },
        400,
      );
    }
    if (!isIntegerInRange(body?.cancellableDays, 0, RECEIPT_CANCELLABLE_DAYS_MAX)) {
      return c.json(
        { ok: false, message: `取り消せる日数は0〜${RECEIPT_CANCELLABLE_DAYS_MAX}で指定してください。` },
        400,
      );
    }

    const result = await saveReceiptDeadlineSettings(container, session.tenantId, {
      closingDay,
      cancellableDays: body.cancellableDays,
    });
    return c.json(result);
  });

  /**
   * 保存前の入力中キーでも確認できるよう、apiKeyはリクエストボディで受け取れる
   * (GAS版listAvailableGeminiModelsForAdminのapiKeyOverrideと同じ)。
   * 画面は保存済みキーの平文を持てないため、apiKey未指定なら保存済みキーで取得する。
   */
  app.post('/admin/gemini-models/available', async (c) => {
    const session = await getAuthenticatedSession(c, container);
    if (!session) return c.json({ code: 'unauthenticated', message: '未ログインです' }, 401);
    if (!isAdmin(session)) return c.json({ code: 'forbidden', message: '権限がありません' }, 403);

    const body = await c.req.json().catch(() => null);
    const override = typeof body?.apiKey === 'string' ? body.apiKey.trim() : '';
    const apiKey = override || (await resolveGeminiApiKey(container, session.tenantId));
    if (!apiKey) {
      return c.json(
        {
          success: false,
          message: 'Gemini APIキーが設定されていません。先にAPIキーを入力してください。',
        },
        400,
      );
    }
    try {
      const models = await container.listGeminiModels(apiKey);
      return c.json({ success: true, models });
    } catch (e) {
      return c.json({ success: false, message: e instanceof Error ? e.message : String(e) }, 502);
    }
  });

  return app;
}
