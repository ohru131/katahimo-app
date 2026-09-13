import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { AdminTargetStaffSelector, useAdminTargetStaff } from './AdminTargetStaffContext';
import type {
  CustomerView,
  DailyScheduleAppointmentWithRoute,
  DailyScheduleResult,
  DailyScheduleWithRouteResult,
} from './api';
import { fetchAllCustomers, fetchDailySchedule, fetchDailyScheduleWithRoute } from './api';
import { ReportModal } from './reports/ReportModal';
import { Button, EmptyState, ErrorNotice, LoadingBlock, toFriendlyMessage } from './ui';

/** GAS版index.htmlのSCHEDULE_ROUTE_CACHE_PREFIX/TTLと同じ役割(ブラウザ内・2時間)。 */
const ROUTE_CACHE_PREFIX = 'katahimo_schedule_route_v1_';
const ROUTE_CACHE_TTL_MS = 2 * 60 * 60 * 1000;

const EVENT_TYPE_ICON: Record<string, string> = {
  'CUSTOMER APPOINTMENT': '📍',
  'OFFICE WORK': '📝',
  EVENT: '📅',
};
/** 訪問の種類の色は3つだけ: お客様=青の左帯・事務作業=灰・イベント=緑(提案書「文字・色・大きさのきまり」)。 */
const EVENT_TYPE_BORDER: Record<string, string> = {
  'CUSTOMER APPOINTMENT': 'border-l-4 border-l-app-primary',
  'OFFICE WORK': 'border-l-4 border-l-gray-300',
  EVENT: 'border-l-4 border-l-app-done',
};

const WEEKDAY_LABEL = ['日', '月', '火', '水', '木', '金', '土'];

/** 予定・移動時間を読めなかったときの言いかた。英語のe.messageは画面に出さずconsoleへ。 */
const SCHEDULE_ERROR_MESSAGE =
  '予定を読み込めませんでした。電波を確認して、下の「🔄 最新にする」をもう一度押してください';

function isCustomerEventType(eventType: string): boolean {
  return eventType === 'CUSTOMER APPOINTMENT';
}

function formatEventTypeLabel(eventType: string): string {
  if (eventType === 'CUSTOMER APPOINTMENT') return 'お客様';
  if (eventType === 'OFFICE WORK') return '事務作業';
  if (eventType === 'EVENT') return 'イベント';
  return eventType || '';
}

function dateStrForOffset(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toLocaleDateString('sv-SE'); // 'YYYY-MM-DD'
}

/** 'YYYY-MM-DD' を「9月3日(水)」にする。ハイフン区切りはコンピュータの表記なので画面には出さない。 */
function formatDateHeading(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map((v) => Number(v));
  if (!y || !m || !d) return dateStr;
  const date = new Date(y, m - 1, d);
  return `${m}月${d}日(${WEEKDAY_LABEL[date.getDay()]})`;
}

/** ルートを読んだ時刻。同じ日の話なので日付は出さず「10:02 時点」とだけ書く。 */
function formatFetchedAt(ts: number): string {
  const t = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(t.getHours())}:${pad(t.getMinutes())} 時点`;
}

function routeCacheKey(staffCacheId: string, dateStr: string): string {
  return `${ROUTE_CACHE_PREFIX}${staffCacheId}_${dateStr}`;
}

interface CachedRoute {
  res: DailyScheduleWithRouteResult;
  ts: number;
}

function getCachedRoute(staffCacheId: string, dateStr: string): CachedRoute | null {
  try {
    const raw = localStorage.getItem(routeCacheKey(staffCacheId, dateStr));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedRoute;
    if (!parsed?.ts || Date.now() - parsed.ts > ROUTE_CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function setCachedRoute(staffCacheId: string, dateStr: string, res: DailyScheduleWithRouteResult): void {
  try {
    localStorage.setItem(routeCacheKey(staffCacheId, dateStr), JSON.stringify({ res, ts: Date.now() }));
  } catch {
    // localStorage不可時は静かに無視(表示自体には影響しない)
  }
}

/** GAS版buildCurrentLocationMapsUrlと同じ、既存ルートURLの目的地座標だけを使って現在地起点のURLを作る。 */
function buildCurrentLocationMapsUrl(url: string): string {
  if (!url) return '';
  const m = url.match(/destination=(-?[0-9.]+),(-?[0-9.]+)/);
  if (!m) return '';
  return `https://www.google.com/maps/dir/?api=1&destination=${m[1]},${m[2]}&travelmode=driving`;
}

/**
 * 地図を開くリンク。<a>なので共通部品のButtonは使えないが、高さ44px以上・文字つきという
 * 決めごとは同じにそろえる(提案書「絶対に守ること」4・6)。
 */
function MapLink({ href, children }: { href: string; children: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-btn border border-gray-300 bg-white px-3 text-base font-bold text-app-text active:bg-gray-100"
    >
      {children}
    </a>
  );
}

/**
 * 訪問と訪問のあいだの移動(家から/次へ/家へ)。「出勤」「退勤」ではなく家の絵と矢印で言う
 * (言いかえ表「🚗 出勤: 12分 / 5.2km」→「🏠 家から 12分(5.2km)」)。
 */
function RouteLeg({
  icon,
  label,
  min,
  km,
  url,
}: {
  icon: string;
  label: string;
  min: number | string;
  km: number | string;
  url: string;
}) {
  if (!km && !min) return null;
  const detail = min && km ? `${min}分(${km}km)` : min ? `${min}分` : km ? `${km}km` : '';
  const curUrl = buildCurrentLocationMapsUrl(url);
  return (
    <div className="mb-2 rounded-card border border-gray-200 bg-gray-50 p-3">
      <div className="mb-2 text-base font-bold text-app-text">
        {icon} {label} {detail || '算出できません'}
      </div>
      {/* 横に2つ並べると、狭い端末では「📍 今いる場所から」が折り返して読めなくなる。
          日本語のボタンは横に並べず縦に積む。 */}
      {(url || curUrl) && (
        <div className="flex flex-col gap-3">
          {url && <MapLink href={url}>🗺️ 道順を見る</MapLink>}
          {curUrl && <MapLink href={curUrl}>📍 今いる場所から</MapLink>}
        </div>
      )}
    </div>
  );
}

/** 訪問カードの2行目。お客様なら住所、それ以外は訪問の種類を出す。 */
function ScheduleSubtitle({ eventType, address }: { eventType: string; address: string }) {
  if (!isCustomerEventType(eventType)) {
    return <div className="mt-1 text-sm text-app-muted">{formatEventTypeLabel(eventType)}</div>;
  }
  if (!address) {
    return <div className="mt-1 text-sm text-app-muted">住所が登録されていません(事務局へ連絡)</div>;
  }
  return <div className="mt-1 break-words text-sm text-app-muted">{address}</div>;
}

/**
 * 予定に入っているお名前から、お客様一覧のお客様を探す。カレンダーの件名は「佐藤 様」のように
 * 敬称や空白が入るので、そこを落としてから突き合わせる。見つからなければnull
 * (呼び出し側がお客様一覧タブへ渡して名前で探してもらう)。
 */
function normalizeCustomerName(name: string): string {
  return name
    .replace(/[\s　]/g, '')
    .replace(/(様|さま|さん)$/u, '')
    .toLowerCase();
}

function findCustomerByName(customers: CustomerView[], name: string): CustomerView | null {
  const key = normalizeCustomerName(name);
  if (!key) return null;

  // 完全一致が1人だけのときはその人。同姓同名が複数いるときは決められないので選ばせる。
  const exact = customers.filter((c) => normalizeCustomerName(c.name) === key);
  if (exact.length === 1) return exact[0] ?? null;
  if (exact.length > 1) return null;

  // 部分一致は「候補が1人に絞れたときだけ」使う。「佐藤」で「佐藤田」を開いてしまうと
  // 別のお客様の日報を書くことになるため、少しでも迷うならお客様一覧で選んでもらう。
  const partial = customers.filter((c) => {
    const n = normalizeCustomerName(c.name);
    return !!n && (n.includes(key) || key.includes(n));
  });
  return partial.length === 1 ? (partial[0] ?? null) : null;
}

/**
 * 「きょうの予定」タブ。GAS版index.htmlのtabSchedule(きょう/あすの切りかえ・予定カード一覧)と
 * 同じ操作感にしている。予定データ自体はGoogleカレンダーAPIを直接叩くのではなく、
 * gas-childcare-visit-appのWeb App(Bridge.js)を経由してGAS版RouteSearch.jsの既存関数
 * (カレンダー解析・ルート計算ロジックは本番で動いているものをそのまま使う)を呼び出す
 * (packages/core/src/ports/schedule.ts参照)。
 *
 * 訪問カードの「✏️ この訪問の日報を書く」は、お客様一覧タブを経由せずにこのタブで日報画面
 * (ReportModal)を開く(提案書「ホームの訪問カードに『日報を書く』を置く」)。お客様一覧の
 * 全件取得はCustomerSearchと同じqueryKeyなので、取り直さずキャッシュを使い回せる。
 * 名前から該当のお客様を見つけられなかったときだけ、従来どおりonJumpToCustomerで
 * お客様一覧タブへ渡して名前で探してもらう。
 *
 * 管理者向け「対象スタッフ」セレクタは出勤簿タブと共有(AdminTargetStaffContext)。
 */
export function ScheduleTab({ onJumpToCustomer }: { onJumpToCustomer: (customerName: string) => void }) {
  const { effectiveStaffId } = useAdminTargetStaff();
  const [offset, setOffset] = useState<0 | 1>(0);
  const dateStr = dateStrForOffset(offset);
  const staffCacheId = effectiveStaffId ?? 'self';

  const [lightResult, setLightResult] = useState<DailyScheduleResult | null>(null);
  const [routeResult, setRouteResult] = useState<DailyScheduleWithRouteResult | null>(null);
  const [routeFetchedAt, setRouteFetchedAt] = useState<number | null>(null);
  const [loadingInitial, setLoadingInitial] = useState(true);
  const [loadingRoute, setLoadingRoute] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reportCustomerId, setReportCustomerId] = useState<string | null>(null);

  // 日報画面を開くためのお客様一覧。CustomerSearchと同じqueryKeyにしてキャッシュを共有する。
  const customersQuery = useQuery({ queryKey: ['customers', 'all'], queryFn: fetchAllCustomers });

  // 日付/対象スタッフ切り替え・手動で「最新にする」を押すたびに増やし、古いリクエストの応答が
  // 後から届いても(以前の値のまま)setStateして表示を上書きしないようにする。
  const requestIdRef = useRef(0);

  const loadLightSchedule = async () => {
    const requestId = requestIdRef.current;
    try {
      const res = await fetchDailySchedule(dateStr, effectiveStaffId);
      if (requestIdRef.current !== requestId) return;
      setLightResult(res);
      if (!res.success) {
        setErrorMessage(
          toFriendlyMessage(res.message, 'ScheduleTab.loadLightSchedule', SCHEDULE_ERROR_MESSAGE),
        );
      }
    } catch (e) {
      if (requestIdRef.current !== requestId) return;
      setErrorMessage(toFriendlyMessage(e, 'ScheduleTab.loadLightSchedule', SCHEDULE_ERROR_MESSAGE));
    }
  };

  const loadRoute = async (forceRefresh: boolean) => {
    const requestId = requestIdRef.current;
    setLoadingRoute(true);
    setErrorMessage(null);
    try {
      const res = await fetchDailyScheduleWithRoute(dateStr, effectiveStaffId, forceRefresh);
      if (requestIdRef.current !== requestId) return;
      if (!res.success) {
        setErrorMessage(toFriendlyMessage(res.message, 'ScheduleTab.loadRoute', SCHEDULE_ERROR_MESSAGE));
        await loadLightSchedule();
        return;
      }
      setCachedRoute(staffCacheId, dateStr, res);
      setRouteResult(res);
      setRouteFetchedAt(Date.now());
    } catch (e) {
      if (requestIdRef.current !== requestId) return;
      setErrorMessage(toFriendlyMessage(e, 'ScheduleTab.loadRoute', SCHEDULE_ERROR_MESSAGE));
      await loadLightSchedule();
    } finally {
      if (requestIdRef.current === requestId) setLoadingRoute(false);
    }
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: loadRoute/loadLightScheduleは日付・対象スタッフが変わるたびに作り直されるクロージャのため、依存に含めると無限ループになる
  useEffect(() => {
    requestIdRef.current += 1;
    setLightResult(null);
    setRouteResult(null);
    setRouteFetchedAt(null);
    setErrorMessage(null);
    setLoadingInitial(true);

    const cached = getCachedRoute(staffCacheId, dateStr);
    if (cached) {
      setLoadingRoute(false);
      setRouteResult(cached.res);
      setRouteFetchedAt(cached.ts);
      setLoadingInitial(false);
      return;
    }

    // タブを開いた時点で移動時間も自動で読み込む(ブラウザに2時間キャッシュされ、同じブラウザで
    // 何度も読み直さない)。読めなかったときは移動時間なしの予定一覧だけでも表示する
    // (GAS版loadScheduleForOffset_/loadRouteInfoと同じ)。自動で読み込むので、画面下の
    // 「🔄 最新にする」は灰色の控えめなボタンにしている。
    const initialRequestId = requestIdRef.current;
    void loadRoute(false).finally(() => {
      if (requestIdRef.current === initialRequestId) setLoadingInitial(false);
    });
  }, [dateStr, staffCacheId]);

  const routeAppointments = routeResult?.appointments;
  const lightAppointments = lightResult?.appointments;
  const hasRoute = !!routeAppointments;
  const appointments = routeAppointments ?? lightAppointments ?? null;

  /** 「この訪問の日報を書く」。該当のお客様が分かればその場で日報画面を開く。 */
  const handleWriteReport = (customerName: string) => {
    const customer = findCustomerByName(customersQuery.data?.customers ?? [], customerName);
    if (customer) {
      setReportCustomerId(customer.id);
      return;
    }
    // 名前が一致しないとき(カレンダーの件名が登録名と違うなど)は、お客様一覧タブで
    // 名前から探してもらう。
    onJumpToCustomer(customerName);
  };

  return (
    <div>
      <AdminTargetStaffSelector />

      <div className="mb-3 flex gap-3">
        <button
          type="button"
          onClick={() => setOffset(0)}
          className={`min-h-[48px] flex-1 rounded-btn border text-base font-bold transition-colors ${
            offset === 0
              ? 'border-app-primary bg-app-primary-bg text-app-primary'
              : 'border-gray-300 bg-white text-app-muted'
          }`}
        >
          ☀️ きょう
        </button>
        <button
          type="button"
          onClick={() => setOffset(1)}
          className={`min-h-[48px] flex-1 rounded-btn border text-base font-bold transition-colors ${
            offset === 1
              ? 'border-app-primary bg-app-primary-bg text-app-primary'
              : 'border-gray-300 bg-white text-app-muted'
          }`}
        >
          🌙 あす
        </button>
      </div>

      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-lg font-bold text-app-text">{formatDateHeading(dateStr)}</h2>
        {routeFetchedAt && <span className="text-sm text-app-muted">{formatFetchedAt(routeFetchedAt)}</span>}
      </div>

      {loadingInitial && <LoadingBlock text="読み込んでいます…" />}

      {!loadingInitial && errorMessage && <ErrorNotice text={errorMessage} />}

      {!loadingInitial && appointments && appointments.length === 0 && (
        <EmptyState
          icon="📅"
          title="この日の予定はありません"
          nextStep={
            offset === 0
              ? 'あすの予定は上の『🌙 あす』で見られます'
              : 'きょうの予定は上の『☀️ きょう』で見られます'
          }
        />
      )}

      {!loadingInitial && appointments && appointments.length > 0 && (
        <div className="space-y-3">
          {appointments.map((app, idx) => {
            const withRoute = app as Partial<DailyScheduleAppointmentWithRoute>;
            const title = hasRoute ? withRoute.customerName : (app as { title?: string }).title;
            const start = hasRoute ? withRoute.startTime : (app as { start?: string }).start;
            const end = hasRoute ? withRoute.endTime : (app as { end?: string }).end;
            const isCustomer = isCustomerEventType(app.eventType);
            const address = app.address || '';
            const mapUrl = address
              ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
              : '';
            const hasAttendanceLeg = !!(
              withRoute.attendanceMin ||
              withRoute.attendanceKm ||
              withRoute.attendanceUrl
            );

            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: カレンダー予定由来のデータで安定したID(お客様のIDは無い場合もある)が無いため、GAS版のdata-appt-idxと同じくindexを使う
              <div key={`${idx}-${title}`}>
                {hasRoute &&
                  (hasAttendanceLeg ? (
                    <RouteLeg
                      icon="🏠"
                      label="家から"
                      min={withRoute.attendanceMin ?? ''}
                      km={withRoute.attendanceKm ?? ''}
                      url={withRoute.attendanceUrl ?? ''}
                    />
                  ) : (
                    <RouteLeg
                      icon="🚗"
                      label="次へ"
                      min={withRoute.moveMin ?? ''}
                      km={withRoute.moveKm ?? ''}
                      url={withRoute.moveUrl ?? ''}
                    />
                  ))}

                <div
                  className={`rounded-card border border-gray-200 ${
                    EVENT_TYPE_BORDER[app.eventType] || ''
                  } ${isCustomer ? 'bg-white' : 'bg-gray-50'} p-3.5`}
                >
                  {/* 時刻は横1行。縦に積むと「10:00」「〜11:30」が別行に割れて読みにくい。 */}
                  <div className="text-lg font-bold text-app-text">
                    {start || ''}
                    {end ? `〜${end}` : ''}
                  </div>
                  <div className="mt-1 flex min-w-0 items-start gap-1.5">
                    <span className="flex-shrink-0 text-base leading-7">
                      {EVENT_TYPE_ICON[app.eventType] || '🕒'}
                    </span>
                    <div className="min-w-0 flex-grow">
                      <span className="break-words text-lg font-bold text-app-text">
                        {title || '(名前なし)'}
                      </span>
                      <ScheduleSubtitle eventType={app.eventType} address={address} />
                    </div>
                  </div>

                  {isCustomer && (
                    <div className="mt-3 space-y-3">
                      <Button variant="primary" fullWidth onClick={() => handleWriteReport(title || '')}>
                        ✏️ この訪問の日報を書く
                      </Button>
                      {mapUrl && <MapLink href={mapUrl}>🗺️ 道順を見る</MapLink>}
                    </div>
                  )}
                </div>

                {hasRoute && (withRoute.leavingMin || withRoute.leavingKm || withRoute.leavingUrl) && (
                  <RouteLeg
                    icon="🏠"
                    label="家へ"
                    min={withRoute.leavingMin ?? ''}
                    km={withRoute.leavingKm ?? ''}
                    url={withRoute.leavingUrl ?? ''}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* 自動で読み込むので、読み直しは一番下に灰色で1つだけ置く(提案書「更新は一番下に灰色で1つ」)。 */}
      {!loadingInitial && (
        <div className="mt-4">
          <Button
            variant="subtle"
            fullWidth
            disabled={loadingRoute}
            onClick={() => {
              requestIdRef.current += 1;
              void loadRoute(true);
            }}
          >
            {loadingRoute ? '調べています…(10秒ほど)' : '🔄 最新にする'}
          </Button>
        </div>
      )}

      {reportCustomerId && (
        <ReportModal customerId={reportCustomerId} onClose={() => setReportCustomerId(null)} />
      )}
    </div>
  );
}
