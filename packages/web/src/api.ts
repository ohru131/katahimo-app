import type {
  AttendanceRowData,
  CouponAudience,
  CouponBirthdaySubject,
  CouponCreateRequest,
  CouponDiscountKind,
  CouponEligibilityKind,
  CouponUpdateRequest,
  CouponUsageLimitKind,
  CustomerCouponUpsertRequest,
  FamilyAllergyStatus,
  FamilyMemberAllergyUpdateRequest,
  PromptTemplateKey,
} from '@katahimo/shared';

export type {
  AttendanceRowData,
  CouponAudience,
  CouponBirthdaySubject,
  CouponCreateRequest,
  CouponDiscountKind,
  CouponEligibilityKind,
  CouponUpdateRequest,
  CouponUsageLimitKind,
  CustomerCouponUpsertRequest,
};

export interface StaffView {
  staffId?: string;
  id?: string;
  tenantId: string;
  name: string;
  email: string;
  isAdmin: boolean;
  /** 初期パスワードのまま。trueの間は変更するまで他の操作ができない(APIも403を返す)。 */
  mustChangePassword: boolean;
}

export interface CustomerView {
  id: string;
  name: string;
  phone: string | null;
  city: string | null;
}

export interface FamilyMemberView {
  id: string;
  name: string;
  /** 'YYYY-MM-DD'。解析できた場合のみ(doc/db/guidelines.md §6)。 */
  dobDate: string | null;
  /** 生年月日の元表記。dobDateの解析成否によらず常に入る。 */
  dobRaw: string | null;
  info: string | null;
  /** 'unknown'(未確認) / 'none'(確認して無し) / 'present'(あり)。doc/db/guidelines.md §11。 */
  allergyStatus: FamilyAllergyStatus;
  allergyNote: string | null;
}

export interface CustomerDetailView {
  id: string;
  externalSource: string | null;
  externalId: string | null;
  name: string;
  familyNameKana: string | null;
  givenNameKana: string | null;
  email: string | null;
  phone: string | null;
  addressDetail: string | null;
  city: string | null;
  parkingArea: string | null;
  parkingDetail: string | null;
  emergencyContact: string | null;
  emergencyContactRelation: string | null;
  evacuationSite: string | null;
  memo: string | null;
  benefitMemberId: string | null;
  address2: string | null;
  address2StartDate: string | null;
  address2EndDate: string | null;
  /** 緯度・経度(doc/db/guidelines.md §7)。解析できた場合のみ数値、解析できない場合はlatLngRawだけが入る。 */
  lat: number | null;
  lng: number | null;
  latLngRaw: string | null;
  memberType: string | null;
  memberStatus: string | null;
  paymentMethod: string | null;
  paymentStatus: string | null;
  gender: string | null;
  ageBracket: string | null;
  dobDate: string | null;
  dobRaw: string | null;
  registeredAt: string | null;
  externalLastUpdatedAt: string | null;
  deactivatedAt: string | null;
  familyMembers: FamilyMemberView[];
}

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message = body && typeof body.message === 'string' ? body.message : `APIエラー: ${res.status}`;
    throw new Error(message);
  }
  return body as T;
}

export async function login(tenantSlug: string, email: string, password: string): Promise<StaffView> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ tenantSlug, email, password }),
  });
  const body = await parseJsonOrThrow<{ staff: StaffView }>(res);
  return body.staff;
}

export async function fetchMe(): Promise<StaffView | null> {
  const res = await fetch('/api/auth/me', { credentials: 'include' });
  if (res.status === 401) return null;
  const body = await parseJsonOrThrow<{ staff: StaffView }>(res);
  return body.staff;
}

export async function logout(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const res = await fetch('/api/auth/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  const body = await parseJsonOrThrow<{ success: boolean; message?: string }>(res);
  if (!body.success) throw new Error(body.message || 'パスワードの変更に失敗しました');
}

/**
 * パスワード再設定コードの発行を依頼する。
 *
 * 宛先が登録されているかどうかにかかわらず成功する。存在しないメールアドレスで
 * エラーになると、誰でも「この事業所に誰が登録されているか」を確かめられてしまうため
 * (サーバー側も同じ理由で結果を出し分けていない)。
 */
export async function requestPasswordReset(tenantSlug: string, email: string): Promise<void> {
  const res = await fetch('/api/auth/forgot-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ tenantSlug, email }),
  });
  await parseJsonOrThrow<{ success: boolean }>(res);
}

/** メールで届いた認証コードでパスワードを再設定する。 */
export async function resetPasswordWithCode(input: {
  tenantSlug: string;
  email: string;
  code: string;
  newPassword: string;
}): Promise<void> {
  const res = await fetch('/api/auth/reset-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(input),
  });
  const body = await parseJsonOrThrow<{ success: boolean; message?: string }>(res);
  if (!body.success) throw new Error(body.message || 'パスワードの再設定に失敗しました');
}

export interface StaffAdminView {
  id: string;
  name: string;
  email: string;
  isAdmin: boolean;
  retirementDate: string | null;
  retired: boolean;
  mustChangePassword: boolean;
}

/** 管理者のスタッフ管理画面用。退職済みも含む全件。 */
export async function fetchStaffForAdmin(): Promise<StaffAdminView[]> {
  const res = await fetch('/api/staff/admin', { credentials: 'include' });
  const body = await parseJsonOrThrow<{ staff: StaffAdminView[] }>(res);
  return body.staff;
}

/**
 * スタッフを登録する。初期パスワードは本人のメールへ自動送信される。
 *
 * 戻り値の `mailDelivered` がfalseのときは、アカウントは作成できたがメールを
 * 送れていない。呼び出し側は「初期パスワードを再発行してください」と案内する
 * (作成自体は済んでいるので、やり直すとメールアドレス重複で弾かれる)。
 */
export async function createStaff(input: {
  name: string;
  email: string;
  isAdmin: boolean;
}): Promise<{ mailDelivered: boolean }> {
  const res = await fetch('/api/staff/admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(input),
  });
  const body = await parseJsonOrThrow<{
    success: boolean;
    mailDelivered?: boolean;
    message?: string;
  }>(res);
  if (!body.success) throw new Error(body.message || 'スタッフの登録に失敗しました');
  return { mailDelivered: body.mailDelivered !== false };
}

/** 氏名・管理者権限・退職日の更新。渡した項目だけが変わる。 */
export async function updateStaff(
  staffId: string,
  patch: { name?: string; isAdmin?: boolean; retirementDate?: string | null },
): Promise<void> {
  const res = await fetch(`/api/staff/admin/${staffId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(patch),
  });
  const body = await parseJsonOrThrow<{ success: boolean; message?: string }>(res);
  if (!body.success) throw new Error(body.message || 'スタッフ情報の更新に失敗しました');
}

/** 初期パスワードを再発行してメールで送り直す。既存のログインは切れる。 */
export async function resetStaffPassword(staffId: string): Promise<{ mailDelivered: boolean }> {
  const res = await fetch(`/api/staff/admin/${staffId}/reset-password`, {
    method: 'POST',
    credentials: 'include',
  });
  const body = await parseJsonOrThrow<{
    success: boolean;
    mailDelivered?: boolean;
    message?: string;
  }>(res);
  if (!body.success) throw new Error(body.message || '初期パスワードの再発行に失敗しました');
  return { mailDelivered: body.mailDelivered !== false };
}

export interface ActiveStaffView {
  id: string;
  name: string;
}

/** 管理者向け「対象スタッフ」一覧(退職者を除く)。管理者以外は空配列が返る。 */
export async function fetchActiveStaffForAdmin(): Promise<ActiveStaffView[]> {
  const res = await fetch('/api/staff', { credentials: 'include' });
  const body = await parseJsonOrThrow<{ staff: ActiveStaffView[] }>(res);
  return body.staff;
}

// ── 管理者設定(GAS版の設定モーダル「管理者設定」に対応) ──

export interface AdminSettingsView {
  /** Gemini APIキーが保存済みかどうか。平文はサーバーから返らない(書き込み専用)。 */
  hasGeminiApiKey: boolean;
  /** どのキーが入っているか見分けるための末尾数文字。短すぎるキーの場合はnull。 */
  geminiApiKeyPreview: string | null;
  geminiReportModel: string;
  geminiOcrModel: string;
  gchatReportWebhookUrl: string;
  gchatReceiptWebhookUrl: string;
  /** 会計の締め日(1〜28)。nullは月末(doc/db/guidelines.md §10)。 */
  receiptClosingDay: number | null;
  /** 領収書を取り消せる日数(暦日)。 */
  receiptCancellableDays: number;
}

export async function fetchAdminSettings(): Promise<AdminSettingsView> {
  const res = await fetch('/api/settings/admin', { credentials: 'include' });
  const body = await parseJsonOrThrow<{ settings: AdminSettingsView }>(res);
  return body.settings;
}

export interface SaveSettingsResult {
  ok: boolean;
  message: string;
}

async function postSettings(path: string, payload: unknown): Promise<SaveSettingsResult> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  return parseJsonOrThrow<SaveSettingsResult>(res);
}

export function saveGeminiApiKey(apiKey: string): Promise<SaveSettingsResult> {
  return postSettings('/api/settings/admin/gemini-key', { apiKey });
}

export function saveGeminiModelSettings(reportModel: string, ocrModel: string): Promise<SaveSettingsResult> {
  return postSettings('/api/settings/admin/gemini-models', { reportModel, ocrModel });
}

export function saveGoogleChatWebhookSettings(
  reportWebhookUrl: string,
  receiptWebhookUrl: string,
): Promise<SaveSettingsResult> {
  return postSettings('/api/settings/admin/gchat-webhooks', { reportWebhookUrl, receiptWebhookUrl });
}

/**
 * 領収書の締め日設定を保存する(doc/db/guidelines.md §10)。
 * 領収書を取り消せる期限がこの2つから決まる。
 */
export function saveReceiptDeadlineSettings(input: {
  closingDay: number | null;
  cancellableDays: number;
}): Promise<SaveSettingsResult> {
  return postSettings('/api/settings/admin/receipt-deadline', input);
}

export interface GeminiModelInfo {
  name: string;
  displayName: string;
}

/**
 * 利用可能なモデル一覧を取得する。apiKeyを渡すと入力途中の(未保存の)キーで試せる。
 * 省略した場合はサーバー側が保存済みのキーを使う(画面は保存済みキーの平文を持たないため)。
 */
export async function listAvailableGeminiModels(apiKey?: string): Promise<GeminiModelInfo[]> {
  const res = await fetch('/api/settings/admin/gemini-models/available', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(apiKey ? { apiKey } : {}),
  });
  const body = await parseJsonOrThrow<{ success: boolean; models?: GeminiModelInfo[]; message?: string }>(
    res,
  );
  if (!body.success) throw new Error(body.message || 'モデル一覧の取得に失敗しました');
  return body.models ?? [];
}

// ── AIプロンプトテンプレート(GAS版「ＡＩプロンプト」シートに対応) ──

/**
 * 管理者向けプロンプトテンプレート1件の表示用データ。`isDefault=true` はテナントが版を
 * 保存しておらず、`defaultBody`(@katahimo/shared DEFAULT_PROMPT_TEMPLATES)がそのまま
 * 使われていることを示す。
 */
export interface PromptTemplateAdminView {
  key: PromptTemplateKey;
  label: string;
  body: string;
  version: number | null;
  isDefault: boolean;
  note: string;
  updatedAt: string | null;
  defaultBody: string;
  placeholders: string[];
}

export interface PromptTemplateVersionView {
  id: string;
  version: number;
  body: string;
  note: string;
  createdByStaffId: string | null;
  createdAt: string;
}

/** 管理者のAIプロンプト管理画面用。全キーを既定/保存済みの区別付きで返す。 */
export async function fetchPromptTemplatesForAdmin(): Promise<PromptTemplateAdminView[]> {
  const res = await fetch('/api/settings/admin/prompts', { credentials: 'include' });
  const body = await parseJsonOrThrow<{ templates: PromptTemplateAdminView[] }>(res);
  return body.templates;
}

/** 指定キーの保存履歴(新しい順)。 */
export async function fetchPromptTemplateVersions(
  key: PromptTemplateKey,
): Promise<PromptTemplateVersionView[]> {
  const res = await fetch(`/api/settings/admin/prompts/${key}/versions`, { credentials: 'include' });
  const body = await parseJsonOrThrow<{ versions: PromptTemplateVersionView[] }>(res);
  return body.versions;
}

export interface SavePromptTemplateResult {
  ok: boolean;
  message: string;
  template?: PromptTemplateAdminView;
}

/**
 * 文面を新しい版として保存する。他の管理者設定(postSettings)と違い、検証エラーは
 * HTTPステータス400で返る(`{ ok: false, message }`)。parseJsonOrThrowがそのmessageを
 * そのままErrorにするので、呼び出し側はtry/catchで受け取れば良い。
 */
export async function savePromptTemplate(
  key: PromptTemplateKey,
  body: string,
  note?: string,
): Promise<SavePromptTemplateResult> {
  const res = await fetch(`/api/settings/admin/prompts/${key}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ body, note }),
  });
  return parseJsonOrThrow<SavePromptTemplateResult>(res);
}

/** 既定の文面に戻す(既定に戻したことも新しい版として記録される)。エラー時の扱いはsavePromptTemplateと同じ。 */
export async function resetPromptTemplate(key: PromptTemplateKey): Promise<SavePromptTemplateResult> {
  const res = await fetch(`/api/settings/admin/prompts/${key}/reset`, {
    method: 'POST',
    credentials: 'include',
  });
  return parseJsonOrThrow<SavePromptTemplateResult>(res);
}

/** 日報・事故報告の入力欄プレースホルダー/記載要領(UI文言)。ログイン済みスタッフなら誰でも取得できる。 */
export interface ReportUiTextsView {
  dailyMemoPlaceholder: string;
  accidentMemoPlaceholder: string;
  accidentHint: string;
  hiyariHint: string;
}

/** 日報・事故報告の入力欄プレースホルダー/記載要領(UI文言)をサーバーから取得する。 */
export async function fetchReportUiTexts(): Promise<ReportUiTextsView> {
  const res = await fetch('/api/reports/ui-texts', { credentials: 'include' });
  return parseJsonOrThrow<ReportUiTextsView>(res);
}

export async function searchCustomersByFamilyName(familyName: string): Promise<CustomerView[]> {
  const res = await fetch(`/api/customers?familyName=${encodeURIComponent(familyName)}`, {
    credentials: 'include',
  });
  const body = await parseJsonOrThrow<{ customers: CustomerView[] }>(res);
  return body.customers;
}

export interface CustomerListResult {
  customers: CustomerView[];
  cities: string[];
}

/**
 * 有効な顧客を全件取得する。GAS版のgetData()相当(訪問先一覧の既定表示・名前の部分一致検索・
 * 地区絞り込みは全てこれで取得した一覧をブラウザ側で絞り込む)。
 */
export async function fetchAllCustomers(): Promise<CustomerListResult> {
  const res = await fetch('/api/customers', { credentials: 'include' });
  return parseJsonOrThrow<CustomerListResult>(res);
}

export async function fetchCustomerDetail(customerId: string): Promise<CustomerDetailView> {
  const res = await fetch(`/api/customers/${encodeURIComponent(customerId)}`, { credentials: 'include' });
  const body = await parseJsonOrThrow<{ customer: CustomerDetailView }>(res);
  return body.customer;
}

export interface AttendanceDayDerived {
  leg1MoveStart: string;
  leg1MoveEnd: string;
  leg1WeatherAdjustedMoveMin: number | '';
  leg1WaitMin: number | '';
  leg2MoveStart: string;
  leg2MoveEnd: string;
  leg2WeatherAdjustedMoveMin: number | '';
  leg2WaitMin: number | '';
  laborMinutes: number;
  overtimeMinutes: number;
  totalMoveMin: number;
  totalDistanceKm: number;
  overThresholdCount: number;
  visitCount: number;
}

export interface AttendanceDayView {
  businessDate: string;
  rowData: AttendanceRowData;
  derived: AttendanceDayDerived;
}

export interface AttendanceMonthlyTotals {
  laborMinutes: number;
  overtimeMinutes: number;
  totalMoveMin: number;
  leg1DistanceKmTotal: number;
  leg2DistanceKmTotal: number;
  attendanceDistanceKmTotal: number;
  leavingDistanceKmTotal: number;
  totalDistanceKm: number;
  overThresholdCount: number;
  visitCountTotal: number;
  shoppingErrandTotal: number;
}

/** 月次集計に埋め込む領収書の1日分。core AttendanceMonthReceiptDayと同じ形。 */
export interface AttendanceMonthReceiptDay {
  date: string;
  amountYen: number;
}

export interface AttendanceMonthReceipts {
  byDay: AttendanceMonthReceiptDay[];
  totalYen: number;
  unreadableAmountCount: number;
  cancelledCount: number;
}

export interface AttendanceMonthView {
  yearMonth: string;
  staffName: string;
  /** その月の全日(1日〜末日)。記録が無い日も空のrowData・0の派生値で並ぶ。 */
  days: AttendanceDayView[];
  totals: AttendanceMonthlyTotals;
  receipts: AttendanceMonthReceipts;
}

/** staffIdは管理者が「対象スタッフ」を選んでいる場合のみ渡す(非管理者は常に自分自身なので不要)。 */
export async function fetchAttendanceDay(date: string, staffId?: string): Promise<AttendanceDayView> {
  const params = new URLSearchParams({ date });
  if (staffId) params.set('staffId', staffId);
  const res = await fetch(`/api/attendance/day?${params.toString()}`, { credentials: 'include' });
  const body = await parseJsonOrThrow<{ attendance: AttendanceDayView }>(res);
  return body.attendance;
}

export async function saveAttendanceDay(
  date: string,
  rowData: AttendanceRowData,
  staffId?: string,
): Promise<AttendanceDayView> {
  const res = await fetch('/api/attendance/day', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ date, rowData, staffId }),
  });
  const body = await parseJsonOrThrow<{ attendance: AttendanceDayView }>(res);
  return body.attendance;
}

export async function fetchAttendanceMonth(
  yearMonth: string,
  staffId?: string,
): Promise<AttendanceMonthView> {
  const params = new URLSearchParams({ month: yearMonth });
  if (staffId) params.set('staffId', staffId);
  const res = await fetch(`/api/attendance/month?${params.toString()}`, {
    credentials: 'include',
  });
  const body = await parseJsonOrThrow<{ month: AttendanceMonthView }>(res);
  return body.month;
}

export type ScheduleEventType = 'CUSTOMER APPOINTMENT' | 'OFFICE WORK';

/**
 * どの枠のイベントかを、配列の種類と添字で表す。doc/db/guidelines.md §2の段階1で訪問・事務作業が固定5枠
 * (slot1〜3, office1〜2)から配列になったのに合わせ、'slot1'のような固定キーではなく
 * { kind, index } にした(packages/core/src/domain/attendance/scheduleEvents.tsのScheduleEventと
 * 同じ形。@katahimo/coreはwebの依存に入っていないため、ここに複製している)。
 */
export interface ScheduleEventSlot {
  kind: 'visit' | 'office';
  index: number;
}

export interface ScheduleEvent {
  date: string;
  slot: ScheduleEventSlot;
  title: string;
  eventType: ScheduleEventType;
  start: string;
  end: string;
}

export async function fetchAttendanceWeekEvents(
  start: string,
  end: string,
  staffId?: string,
): Promise<ScheduleEvent[]> {
  const params = new URLSearchParams({ start, end });
  if (staffId) params.set('staffId', staffId);
  const res = await fetch(`/api/attendance/week?${params.toString()}`, { credentials: 'include' });
  const body = await parseJsonOrThrow<{ events: ScheduleEvent[] }>(res);
  return body.events;
}

// ── Googleカレンダー → 出勤簿の反映(GAS版の「📅 カレンダーから取得」「📅 一括反映(管理者用)」)──

/** 反映で書き換わる列1つぶんの差分。core CalendarSyncChangeと同じ形。 */
export interface CalendarSyncChange {
  column: string;
  label: string;
  oldValue: string;
  newValue: string;
}

export interface CalendarSyncPreview {
  staffId: string;
  staffName: string;
  date: string;
  appointmentCount: number;
  hasChanges: boolean;
  changes: CalendarSyncChange[];
}

export interface CalendarSyncApplyResult extends CalendarSyncPreview {
  changedCount: number;
}

/** 書き込まずに差分だけ取る(差分確認モーダル用)。 */
export async function previewCalendarSync(date: string, staffId?: string): Promise<CalendarSyncPreview> {
  const res = await fetch('/api/attendance/calendar-sync/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ date, staffId }),
  });
  const body = await parseJsonOrThrow<{ preview: CalendarSyncPreview }>(res);
  return body.preview;
}

/**
 * 実際に出勤簿へ反映する。差分はサーバー側で計算し直されるので、プレビューの結果を
 * 送り返す必要はない(送っても使われない)。
 */
export async function applyCalendarSync(date: string, staffId?: string): Promise<CalendarSyncApplyResult> {
  const res = await fetch('/api/attendance/calendar-sync/apply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ date, staffId }),
  });
  const body = await parseJsonOrThrow<{ result: CalendarSyncApplyResult }>(res);
  return body.result;
}

// ── 割引クーポン(doc/db/guidelines.md §9。日報画面の選択UIと、管理者向けクーポン管理画面の両方で使う) ──
// リクエストの形は@katahimo/sharedのzodスキーマ(CouponCreateRequest/CouponUpdateRequest、
// ファイル冒頭でimport済み)をそのまま使う。web側で同じ形を再定義すると、DBのCHECK制約に
// 合わせた値域(割引率1〜100等)の二重管理になってしまうため。

/** 日報画面の「クーポンを選ぶ」セレクタ用の1件(GET /api/coupons)。core CouponSelectionViewと同じ形。 */
export interface CouponSelectionView {
  id: string;
  code: string;
  name: string;
  discountKind: CouponDiscountKind;
  discountAmountYen: number | null;
  discountPercent: number | null;
  eligibilityKind: CouponEligibilityKind;
  usageLimitKind: CouponUsageLimitKind;
  /** 誕生月クーポンのとき、根拠になる人の氏名(「○○さんの誕生月」と出すため)。 */
  birthdaySubjectName: string | null;
  /** この顧客では使用上限に達している。選択肢には残すが選べない。 */
  alreadyUsed: boolean;
}

/** 管理者のクーポン管理画面用の1件(GET /api/coupons/admin)。廃止済み(active=false)も含む。 */
export interface CouponView {
  id: string;
  code: string;
  name: string;
  discountKind: CouponDiscountKind;
  discountAmountYen: number | null;
  discountPercent: number | null;
  /** 有効期間の下限('YYYY-MM-DD')。nullは下限なし。 */
  validFrom: string | null;
  /** 有効期間の上限('YYYY-MM-DD')。nullは無期限。 */
  validTo: string | null;
  /** 'all'=全顧客、'assigned'=配った顧客だけ(顧客カルテから配る)。 */
  audience: CouponAudience;
  /** 'manual'=条件なし、'birthday_month'=対象者の誕生月のみ。 */
  eligibilityKind: CouponEligibilityKind;
  /** eligibilityKind='birthday_month'のときだけ値が入る(誰の誕生日を見るか)。 */
  birthdaySubject: CouponBirthdaySubject | null;
  /** 同じ顧客が何回使えるか。 */
  usageLimitKind: CouponUsageLimitKind;
  /** false=廃止済み。廃止しても行は消さない(doc/db/guidelines.md §9)ので一覧には引き続き出る。 */
  active: boolean;
  note: string | null;
}

/** 顧客カルテの「この顧客が使えるクーポン」1件(GET /api/coupons/admin/customers/:customerId)。 */
export interface CustomerCouponView {
  couponId: string;
  code: string;
  name: string;
  discountKind: CouponDiscountKind;
  discountAmountYen: number | null;
  discountPercent: number | null;
  /** この顧客に限った有効期間。nullはクーポンマスタの期間に従う。 */
  validFrom: string | null;
  validTo: string | null;
  note: string | null;
  /** クーポンマスタ側が廃止済み。配ってあっても使えない。 */
  couponInactive: boolean;
}

/** 日報1件に適用済みのクーポン1件(保存結果・履歴表示で使う)。core DailyReportCouponViewと同じ形。 */
export interface DailyReportCouponView {
  couponId: string;
  code: string;
  name: string;
  discountKind: CouponDiscountKind;
  discountAmountYen: number | null;
  discountPercent: number | null;
  /** 誕生月クーポンのとき、根拠にした人の氏名(適用時点の値)。 */
  birthdaySubjectName: string | null;
}

/**
 * 日報画面のクーポン選択用一覧。その顧客がその日に使える条件を満たすものだけが返る
 * (doc/db/guidelines.md §9)。誕生月でない月の誕生月クーポンや、その顧客に配られていないクーポンは
 * 返ってこないので、画面側で条件を判定する必要はない。
 *
 * reportIdは編集中の日報。その日報が既に使っている分を「使用済み」に数えないために渡す。
 */
export async function fetchCouponsForSelection(
  customerId: string,
  date: string,
  reportId?: string | null,
): Promise<CouponSelectionView[]> {
  const params = new URLSearchParams({ customerId, date });
  if (reportId) params.set('reportId', reportId);
  const res = await fetch(`/api/coupons?${params.toString()}`, { credentials: 'include' });
  const body = await parseJsonOrThrow<{ coupons: CouponSelectionView[] }>(res);
  return body.coupons;
}

/**
 * 顧客の生年月日を登録・更新する(管理者のみ)。誕生月クーポンの判定に使う。
 * 空文字を渡すと消える。顧客の他の項目はRESERVA CSVの取込が正なので編集できない。
 */
export async function updateCustomerBirthday(customerId: string, dob: string): Promise<void> {
  const res = await fetch(`/api/customers/${encodeURIComponent(customerId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ dob }),
  });
  const body = await parseJsonOrThrow<{ success: boolean; message?: string }>(res);
  if (!body.success) throw new Error(body.message || '生年月日の更新に失敗しました');
}

/**
 * 世帯構成員のアレルギーを登録・更新する。訪問の現場で聞き取る情報なので管理者に限らない。
 * 「あり」にするときは内容が必須(サーバー側とDBの制約でも縛っている)。
 */
export async function updateFamilyMemberAllergy(
  customerId: string,
  memberId: string,
  allergy: FamilyMemberAllergyUpdateRequest,
): Promise<void> {
  const res = await fetch(
    `/api/customers/${encodeURIComponent(customerId)}/family/${encodeURIComponent(memberId)}/allergy`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(allergy),
    },
  );
  const body = await parseJsonOrThrow<{ success: boolean; message?: string }>(res);
  if (!body.success) throw new Error(body.message || 'アレルギーの更新に失敗しました');
}

/** 顧客カルテの「この顧客が使えるクーポン」一覧(管理者のみ)。 */
export async function fetchCustomerCoupons(customerId: string): Promise<CustomerCouponView[]> {
  const res = await fetch(`/api/coupons/admin/customers/${encodeURIComponent(customerId)}`, {
    credentials: 'include',
  });
  const body = await parseJsonOrThrow<{ coupons: CustomerCouponView[] }>(res);
  return body.coupons;
}

/** 顧客にクーポンを配る(既に配ってあれば有効期間・メモを上書きする)。 */
export async function assignCouponToCustomer(
  customerId: string,
  input: CustomerCouponUpsertRequest,
): Promise<void> {
  const res = await fetch(`/api/coupons/admin/customers/${encodeURIComponent(customerId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(input),
  });
  const body = await parseJsonOrThrow<{ success: boolean; message?: string }>(res);
  if (!body.success) throw new Error(body.message || 'クーポンの配布に失敗しました');
}

/** 顧客への配布を取り消す。過去の適用記録は残る。 */
export async function unassignCouponFromCustomer(customerId: string, couponId: string): Promise<void> {
  const res = await fetch(
    `/api/coupons/admin/customers/${encodeURIComponent(customerId)}/${encodeURIComponent(couponId)}`,
    { method: 'DELETE', credentials: 'include' },
  );
  const body = await parseJsonOrThrow<{ success: boolean; message?: string }>(res);
  if (!body.success) throw new Error(body.message || 'クーポンの配布取り消しに失敗しました');
}

/** 管理者のクーポン管理画面用。廃止済みも含む全件。 */
export async function fetchCouponsForAdmin(): Promise<CouponView[]> {
  const res = await fetch('/api/coupons/admin', { credentials: 'include' });
  const body = await parseJsonOrThrow<{ coupons: CouponView[] }>(res);
  return body.coupons;
}

/** クーポンを登録する。 */
export async function createCoupon(input: CouponCreateRequest): Promise<void> {
  const res = await fetch('/api/coupons/admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(input),
  });
  const body = await parseJsonOrThrow<{ success: boolean; message?: string }>(res);
  if (!body.success) throw new Error(body.message || 'クーポンの登録に失敗しました');
}

/** クーポンを部分更新する。有効/廃止の切り替え(active)もここから行う。 */
export async function updateCoupon(couponId: string, patch: CouponUpdateRequest): Promise<void> {
  const res = await fetch(`/api/coupons/admin/${encodeURIComponent(couponId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(patch),
  });
  const body = await parseJsonOrThrow<{ success: boolean; message?: string }>(res);
  if (!body.success) throw new Error(body.message || 'クーポンの更新に失敗しました');
}

// ── 日報/事故報告/活動記録/領収書登録(gas-childcare-visit-appの訪問先カード内モーダルに対応) ──

export interface DailyReportDraft {
  warnings: string[];
  internal: string;
  customer: string;
}

export interface AccidentReportDraft {
  occurrenceTime: string;
  location: string;
  accidentContent: string;
  situation: string;
  immediateResponse: string;
  parentCorrespondence: string;
  diagnosisTreatment: string;
  prevention: string;
}

export interface AccidentReportDraftError {
  error: string;
}

export async function generateDailyReportDraft(
  text: string,
  start?: string,
  end?: string,
): Promise<DailyReportDraft> {
  const res = await fetch('/api/reports/daily/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ text, start, end }),
  });
  const body = await parseJsonOrThrow<{ draft: DailyReportDraft }>(res);
  return body.draft;
}

export async function generateAccidentReportDraft(
  text: string,
  start?: string,
  end?: string,
): Promise<AccidentReportDraft | AccidentReportDraftError> {
  const res = await fetch('/api/reports/accident/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ text, start, end }),
  });
  const body = await parseJsonOrThrow<{ draft: AccidentReportDraft | AccidentReportDraftError }>(res);
  return body.draft;
}

export interface SaveDailyReportInput {
  reportId?: string;
  customerId: string;
  reportDate?: string;
  startTime: string;
  endTime: string;
  inputText: string;
  internalText: string;
  customerText: string;
  stressLevel: number | null;
  esRating: number | null;
  /** 適用する割引クーポンのID配列(doc/db/guidelines.md §9)。省略/空配列は「クーポン無し」。 */
  couponIds?: string[];
}

export interface DailyReportView {
  id: string;
  occurredAt: string;
  staffId: string;
  customerId: string;
  stressLevel: number | null;
  esRating: number | null;
  /** この日報に適用された割引クーポン(doc/db/guidelines.md §9)。 */
  coupons: DailyReportCouponView[];
}

/** 「訪問完了」通知のみを送信する(DB書き込みなし)。GAS版sendVisitComplete相当。 */
export async function sendVisitCompleteNotification(
  customerId: string,
  visitDate: string,
  startTime: string,
  endTime: string,
): Promise<void> {
  const res = await fetch('/api/reports/visit-complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ customerId, visitDate, startTime, endTime }),
  });
  const body = await parseJsonOrThrow<{ success: boolean; message?: string }>(res);
  if (!body.success) throw new Error(body.message || '訪問完了通知の送信に失敗しました');
}

export async function saveDailyReport(input: SaveDailyReportInput): Promise<DailyReportView> {
  const res = await fetch('/api/reports/daily', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(input),
  });
  const body = await parseJsonOrThrow<{ success: boolean; report: DailyReportView; message?: string }>(res);
  if (!body.success) throw new Error(body.message || '日報の保存に失敗しました');
  return body.report;
}

export interface SaveAccidentReportInput {
  reportId?: string;
  customerId: string;
  reportType?: string;
  targetName: string;
  targetDob: string;
  occurrenceTime: string;
  location: string;
  accidentContent: string;
  situation: string;
  immediateResponse: string;
  parentCorrespondence: string;
  diagnosisTreatment: string;
  prevention: string;
  inputText: string;
}

export interface AccidentReportView {
  id: string;
  occurredAt: string;
  staffId: string;
  customerId: string;
  reportType: string;
}

export async function saveAccidentReport(input: SaveAccidentReportInput): Promise<AccidentReportView> {
  const res = await fetch('/api/reports/accident', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(input),
  });
  const body = await parseJsonOrThrow<{ success: boolean; report: AccidentReportView; message?: string }>(
    res,
  );
  if (!body.success) throw new Error(body.message || '事故報告の保存に失敗しました');
  return body.report;
}

export interface HistoryItem {
  type: 'daily' | 'accident';
  id: string;
  occurredAtIso: string;
  timestamp: string;
  staff: string;
  original: string;
  internal: string;
  customer: string;
  risk?: number | null;
  es?: number | null;
  isAccident?: boolean;
  subtype?: string;
}

export async function fetchCustomerHistory(customerId: string, before?: string): Promise<HistoryItem[]> {
  const params = new URLSearchParams({ customerId });
  if (before) params.set('before', before);
  const res = await fetch(`/api/reports/history?${params.toString()}`, { credentials: 'include' });
  const body = await parseJsonOrThrow<{ items: HistoryItem[] }>(res);
  return body.items;
}

/** 領収書の請求区分。'customer_billable'=顧客に請求する、'company_expense'=会社が立て替える(doc/db/guidelines.md §10)。 */
export type ReceiptBillingType = 'customer_billable' | 'company_expense';

export interface ReceiptImageUpload {
  data: string;
  amount?: string | number | null;
  storeName?: string | null;
  receiptDate?: string | null;
  /** 未指定ならAPI側でcompany_expense扱いになる(取りこぼしが顧客請求に転ばないための既定)。 */
  billingType?: ReceiptBillingType;
}

export interface UploadReceiptsInput {
  customerId: string | null;
  images: ReceiptImageUpload[];
  receiptTimestamp?: string;
  handoffText?: string;
}

export interface ReceiptDuplicateInfo {
  index: number;
  timestamp: string;
  amount: string;
  storeName: string;
}

export interface UploadReceiptsResult {
  success: boolean;
  message: string;
  uploadedCount: number;
  duplicateCount: number;
  duplicates: ReceiptDuplicateInfo[];
}

export async function uploadReceipts(input: UploadReceiptsInput): Promise<UploadReceiptsResult> {
  const res = await fetch('/api/receipts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(input),
  });
  return parseJsonOrThrow<UploadReceiptsResult>(res);
}

/** 勤怠タブの領収書一覧の1件(GET /api/receipts)。core ReceiptListItemViewと同じ形。 */
export interface ReceiptListItemView {
  id: string;
  /** 'yyyy/MM/dd HH:mm'(JST)。 */
  receiptTimestamp: string;
  amountYen: number | null;
  /** OCRが返した金額の生文字列。amountYenがnullのときに何が読めていたのかを示す。 */
  amountRaw: string | null;
  storeName: string | null;
  handoffText: string | null;
  customerId: string | null;
  /** 顧客に紐付かない経費領収書(駐車場代等)はnull。 */
  customerName: string | null;
  billingType: ReceiptBillingType;
  /** 取り消し済みなら'yyyy/MM/dd HH:mm'(JST)。有効な行はnull。 */
  cancelledAt: string | null;
  cancellationReason: string | null;
  cancelledByStaffName: string | null;
  /** いま取り消せるか(期限はテナントごとの締め日設定で決まる。管理者は期限後も真)。falseなら取消ボタンを出さない。 */
  canCancel: boolean;
  /** ミラー送信(スプレッドシートへの書き出し)の状態。ミラーを使っていないテナントはnull。 */
  mirrorStatus: 'pending' | 'processing' | 'done' | 'failed' | null;
  /** pendingのとき、次に送信を試みる時刻。再試行待ちのときだけ意味を持つ(登録直後は「今」)。 */
  mirrorScheduledAt: string | null;
  /** 直近の送信失敗の理由。pendingのまま残っていれば再試行待ち、failedなら打ち切り。 */
  mirrorError: string | null;
}

export interface ReceiptListView {
  yearMonth: string;
  receipts: ReceiptListItemView[];
  customerBillableTotalYen: number;
  companyExpenseTotalYen: number;
  /** 金額を数値にできていない領収書の件数(合計に入っていない分)。 */
  unreadableAmountCount: number;
  /** 取り消し済みの件数(一覧には残るが集計には入らない)。 */
  cancelledCount: number;
  /** まだスプレッドシートへ送っていない件数(ワーカー待ち・再試行待ち)。 */
  pendingMirrorCount: number;
  /** 送信に失敗して止まっている件数。0でなければ管理者の対応が要る。 */
  failedMirrorCount: number;
}

/**
 * 登録済みの領収書を月単位で取得する。`staffId`は管理者だけが指定でき、それ以外は
 * サーバー側で本人のstaffIdに強制される。
 */
export async function fetchReceipts(yearMonth: string, staffId?: string): Promise<ReceiptListView> {
  const params = new URLSearchParams({ yearMonth });
  if (staffId) params.set('staffId', staffId);
  const res = await fetch(`/api/receipts?${params.toString()}`, { credentials: 'include' });
  return parseJsonOrThrow<ReceiptListView>(res);
}

/**
 * 領収書を取り消す(論理削除。doc/db/guidelines.md §10)。
 * 会計の記録なので編集はできない。訂正は「取り消して登録し直す」。
 *
 * 戻り値の `mirrorAlreadySent` は「取り消した時点で既に外部シートへ送られていた」ことを表す。
 * 管理者が期限後に取り消したときだけ起こりうる。シート側の行はこちらからは消せないので、
 * 呼び出し側は操作した人へ伝える必要がある。
 */
export async function cancelReceipt(
  receiptId: string,
  reason: string,
): Promise<{ mirrorAlreadySent: boolean }> {
  const res = await fetch(`/api/receipts/${encodeURIComponent(receiptId)}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ reason }),
  });
  const body = await parseJsonOrThrow<{
    success: boolean;
    message?: string;
    mirrorAlreadySent?: boolean;
  }>(res);
  if (!body.success) throw new Error(body.message || '領収書の取り消しに失敗しました');
  return { mirrorAlreadySent: body.mirrorAlreadySent === true };
}

/**
 * 領収書画像を取得し、`<img src>` に渡せるオブジェクトURLを返す。
 *
 * 【URLを組み立てて <img src> に直接渡さない理由】
 * 公開デモはAPIサーバーを持たず、ページ内で `window.fetch` を横取りしてブラウザ内の
 * PGliteに繋いでいる(packages/demo/src/demoApi.ts)。`<img src>` の読み込みはfetchを
 * 通らないので、デモでは実在しないパスへの本物のリクエストになり必ず失敗する。
 * fetchで取ってからオブジェクトURLにすれば、本番でもデモでも同じコードで動く。
 *
 * 画像の実体を一覧のJSONに載せない(base64にするとレスポンスが重くなる)のは変わらない。
 * 返したURLは使い終わったら `URL.revokeObjectURL` で解放すること。
 */
export async function fetchReceiptImageObjectUrl(receiptId: string): Promise<string> {
  const res = await fetch(`/api/receipts/${encodeURIComponent(receiptId)}/image`, {
    credentials: 'include',
  });
  if (!res.ok) throw new Error('領収書画像を取得できませんでした');
  return URL.createObjectURL(await res.blob());
}

export interface ReceiptOcrResult {
  amount: string | number;
  storeName: string;
  receiptDate: string;
  /** OCR呼び出し自体が失敗した場合のエラーメッセージ(成功時はundefined)。 */
  error?: string;
}

export async function extractReceiptOcr(image: string): Promise<ReceiptOcrResult> {
  const res = await fetch('/api/receipts/ocr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ image }),
  });
  const body = await parseJsonOrThrow<{ result: ReceiptOcrResult }>(res);
  return body.result;
}

// ── 予定タブ(GAS版Schedule.js/RouteSearch.jsのブリッジ経由) ──

export interface DailyScheduleAppointment {
  title: string;
  eventType: string;
  start: string;
  end: string;
  address: string;
}

export interface DailyScheduleResult {
  success: boolean;
  date?: string;
  staffName?: string;
  appointments?: DailyScheduleAppointment[];
  message?: string;
}

/** ルート・移動時間を含まない軽量版。GAS版Schedule.js getScheduleForDate相当。 */
export async function fetchDailySchedule(date: string, staffId?: string): Promise<DailyScheduleResult> {
  const params = new URLSearchParams({ date });
  if (staffId) params.set('staffId', staffId);
  const res = await fetch(`/api/schedule?${params.toString()}`, { credentials: 'include' });
  return parseJsonOrThrow<DailyScheduleResult>(res);
}

export interface DailyScheduleAppointmentWithRoute {
  eventType: string;
  customerName: string;
  startTime: string;
  endTime: string;
  reservaUrl: string;
  moveUrl: string;
  moveMin: number | string;
  moveKm: number | string;
  attendanceUrl: string;
  attendanceMin: number | string;
  attendanceKm: number | string;
  leavingUrl: string;
  leavingMin: number | string;
  leavingKm: number | string;
  customerId: string;
  address: string;
}

export interface DailyScheduleWithRouteResult {
  success: boolean;
  date?: string;
  staffName?: string;
  appointments?: DailyScheduleAppointmentWithRoute[];
  message?: string;
}

/** ルート・移動時間つき。GAS版Schedule.js getRouteForStaffOnDate相当(Maps連携を伴うため時間がかかる)。 */
export async function fetchDailyScheduleWithRoute(
  date: string,
  staffId?: string,
  forceRefresh?: boolean,
): Promise<DailyScheduleWithRouteResult> {
  const params = new URLSearchParams({ date });
  if (staffId) params.set('staffId', staffId);
  if (forceRefresh) params.set('forceRefresh', '1');
  const res = await fetch(`/api/schedule/route?${params.toString()}`, { credentials: 'include' });
  return parseJsonOrThrow<DailyScheduleWithRouteResult>(res);
}
