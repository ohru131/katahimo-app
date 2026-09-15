import {
  getCustomerDetail,
  getCustomerReportProfile,
  listCustomers,
  saveCustomerReportProfile,
  searchCustomersByFamilyName,
  updateCustomerBirthday,
  updateFamilyMemberAllergy,
} from '@katahimo/core';
import {
  customerReportProfileInputSchema,
  customerUpdateRequestSchema,
  familyMemberAllergyUpdateRequestSchema,
  idSchema,
} from '@katahimo/shared';
import { Hono } from 'hono';
import type { Container } from '../container';
import { getAuthenticatedSession } from '../session';

export function createCustomerRoutes(container: Container) {
  const app = new Hono();

  /**
   * `familyName`クエリ省略時は有効な顧客を全件返す(GAS版Main.js fetchDataFromSheetが顧客DB全件を
   * 一度にクライアントへ返し、名前の部分一致・地区絞り込み・並び替えはブラウザ側で行っていたのと
   * 同じ「訪問先一覧」タブの既定表示に使う)。`familyName`を指定した場合のみ、従来通り苗字の
   * ブラインドインデックス完全一致検索を行う。tenantIdは必ずセッションから取得したものだけを使い、
   * クエリパラメータでtenantIdを受け取ることはしない(他テナントの顧客を覗けてしまうため)。
   */
  app.get('/', async (c) => {
    const session = await getAuthenticatedSession(c, container);
    if (!session) return c.json({ code: 'unauthenticated', message: '未ログインです' }, 401);

    const familyName = c.req.query('familyName');
    if (!familyName) {
      const { customers, cities } = await listCustomers(container, session.tenantId);
      return c.json({ customers, cities });
    }

    const results = await searchCustomersByFamilyName(container, session.tenantId, familyName);
    return c.json({ customers: results });
  });

  /**
   * 顧客1件の全項目(世帯構成員含む)を復号して返す詳細取得。
   * こちらもtenantIdはセッション由来のものだけを使う(URLのcustomerIdだけでは他テナントの
   * 顧客IDを推測して覗かれる心配は無いが、念のためfindByIdもtenant_idでスコープする)。
   */
  app.get('/:id', async (c) => {
    const session = await getAuthenticatedSession(c, container);
    if (!session) return c.json({ code: 'unauthenticated', message: '未ログインです' }, 401);

    const customerId = c.req.param('id');
    const detail = await getCustomerDetail(container, session.tenantId, customerId);
    if (!detail) return c.json({ code: 'not_found', message: '顧客が見つかりません' }, 404);

    // 日報AIの★設定(customer_report_profiles)。未設定の家庭はnullで、生成時は既定(★2相当)
    // として扱う(doc/db/new-domains.md 第6章)。顧客詳細を開くたびに一緒に使うので、
    // 画面が2回引かなくて済むよう同じ応答に載せる。
    const reportProfile = await getCustomerReportProfile(container, session.tenantId, customerId);

    return c.json({ customer: { ...detail, reportProfile } });
  });

  /**
   * 家庭ごとの日報AI設定(教育関心度★とメモ)を保存する。
   *
   * 管理者に限らないのは、★が「この家庭にどこまで教育の言葉を使うか」という現場の見立てで、
   * 訪問した担当者が保護者の反応から付けるものだから(設計書「管理者・担当者が付ける」)。
   * アレルギーの登録(下のPATCH)と同じ理由で、請求額にも影響しない。
   */
  app.put('/:id/report-profile', async (c) => {
    const session = await getAuthenticatedSession(c, container);
    if (!session) return c.json({ code: 'unauthenticated', message: '未ログインです' }, 401);

    // uuid列との比較にUUID以外の文字列を渡すとPostgreSQLが例外を投げて500になる(下のPATCHと同じ理由)。
    const customerId = idSchema.safeParse(c.req.param('id'));
    if (!customerId.success) {
      return c.json({ code: 'validation_failed', message: 'IDの形式が不正です' }, 400);
    }

    const parsed = customerReportProfileInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
      const message = parsed.error.issues
        .map((issue) => `${issue.path.join('.') || '値'}: ${issue.message}`)
        .join(' / ');
      return c.json({ code: 'validation_failed', message }, 400);
    }

    // 存在しない顧客に★だけが残らないよう、先に顧客の実在を確かめる
    // (customer_report_profiles は顧客への複合外部キーを持つので、実DBなら23503で落ちるが、
    // 利用者には何が悪いのか分からないため404で返す)。
    const detail = await getCustomerDetail(container, session.tenantId, customerId.data);
    if (!detail) return c.json({ code: 'not_found', message: '顧客が見つかりません' }, 404);

    const reportProfile = await saveCustomerReportProfile(
      container,
      session.tenantId,
      customerId.data,
      parsed.data,
      session.staffId,
    );
    return c.json({ reportProfile });
  });

  /**
   * 顧客の生年月日を登録・更新する(誕生月クーポンの判定に使う。doc/db/guidelines.md §9)。
   *
   * 受け付けるのは生年月日だけ。他の項目はRESERVA CSVの取込が正で、画面から直しても
   * 次の取込で消えるため編集させない(@katahimo/shared の customerUpdateRequestSchema 参照)。
   * 請求額に影響する情報なので、クーポンマスタの編集と同じく管理者だけに許す。
   */
  app.patch('/:id', async (c) => {
    const session = await getAuthenticatedSession(c, container);
    if (!session) return c.json({ code: 'unauthenticated', message: '未ログインです' }, 401);
    if (!session.isAdmin) return c.json({ code: 'forbidden', message: '権限がありません' }, 403);

    // uuid列との比較にUUID以外の文字列を渡すとPostgreSQLが例外を投げて500になる。
    // 入力の形の誤りは400で返す(routes/coupons.ts の parsePathId と同じ理由)。
    const customerId = idSchema.safeParse(c.req.param('id'));
    if (!customerId.success) {
      return c.json({ code: 'validation_failed', message: 'IDの形式が不正です' }, 400);
    }

    const body = await c.req.json().catch(() => null);
    const parsed = customerUpdateRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, message: '入力内容を確認してください' }, 400);
    }

    const updated = await updateCustomerBirthday(
      container,
      session.tenantId,
      customerId.data,
      parsed.data.dob,
    );
    if (!updated) return c.json({ code: 'not_found', message: '顧客が見つかりません' }, 404);
    return c.json({ success: true });
  });

  /**
   * 世帯構成員のアレルギーを登録・更新する(doc/db/guidelines.md §11)。
   *
   * 生年月日の更新(上のPATCH)と違って管理者に限らないのは、アレルギーが訪問の現場で
   * 保護者から聞き取る情報だから。管理者しか入れられないと、聞いたその場で残せず、
   * 「あとで管理者に伝える」までの間だけ記録が欠ける。請求額にも影響しない。
   */
  app.patch('/:id/family/:memberId/allergy', async (c) => {
    const session = await getAuthenticatedSession(c, container);
    if (!session) return c.json({ code: 'unauthenticated', message: '未ログインです' }, 401);

    // uuid列との比較にUUID以外の文字列を渡すとPostgreSQLが例外を投げて500になる(上と同じ理由)。
    const customerId = idSchema.safeParse(c.req.param('id'));
    const memberId = idSchema.safeParse(c.req.param('memberId'));
    if (!customerId.success || !memberId.success) {
      return c.json({ code: 'validation_failed', message: 'IDの形式が不正です' }, 400);
    }

    const body = await c.req.json().catch(() => null);
    const parsed = familyMemberAllergyUpdateRequestSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ success: false, message: '入力内容を確認してください' }, 400);
    }

    const updated = await updateFamilyMemberAllergy(
      container,
      session.tenantId,
      customerId.data,
      memberId.data,
      parsed.data,
    );
    if (!updated) return c.json({ code: 'not_found', message: '世帯構成員が見つかりません' }, 404);
    return c.json({ success: true, familyMember: updated });
  });

  return app;
}
