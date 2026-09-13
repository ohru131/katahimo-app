import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { AttendanceRowData, ScheduleEvent, ScheduleEventSlot } from '../api';
import { fetchAttendanceDay, fetchAttendanceWeekEvents, saveAttendanceDay } from '../api';
import {
  Button,
  ButtonRow,
  EmptyState,
  ErrorNotice,
  LoadingBlock,
  toFriendlyMessage,
  useFeedback,
} from '../ui';
import { applySlotEdit, readSlotFields } from './arraySlot';
import {
  CAL_DOW,
  CAL_TYPE_STYLE,
  calComputeHourRange,
  calFormatHours,
  calFormatMonthDay,
  calGetWeekStart,
  calSumEventMinutes,
  calTimeToMinutes,
  calYmd,
} from './calendarUtils';
import { MoveDistancePanel } from './MoveDistancePanel';
import { SlotEditModal } from './SlotEditModal';
import { ATTENDANCE_SLOT_DEFS, slotKeyString } from './slotFields';

const CAL_WEEK_HOUR_HEIGHT = 48;
const CAL_DAY_HOUR_HEIGHT = 56;
const CAL_TIME_AXIS_WIDTH = 36;
/** 「表で見る」(7列のグリッド)の最小幅。これより狭い画面では横スクロールで見せる。 */
const CAL_WEEK_GRID_MIN_WIDTH = 560;

/** 予定を開始時刻の早い順に並べる(表示は必ずこの順。APIの並び順には依存しない)。 */
function sortByStart(events: ScheduleEvent[]): ScheduleEvent[] {
  return [...events].sort((a, b) => (calTimeToMinutes(a.start) ?? 0) - (calTimeToMinutes(b.start) ?? 0));
}

/**
 * 「🕒 出勤簿」タブの週の表示。
 *
 * 既定は「予定のある日だけのリスト」(1行 = 日にち・曜日 / お客様名を「→」でつないだ1行 /
 * 開始〜終了 / 合計時間)。GAS版から移したGoogleカレンダー風の7列グリッドは、スマホでは
 * 8pxの文字でしか入らないため既定から外し、「表で見る」で切りかえて残している
 * (doc/16_UIUX改善提案_2026-09-03.html「週の表示を『予定のある日のリスト』を既定に」)。
 *
 * 表示している予定は実際のGoogleカレンダーからではなく、保存済みの出勤簿(attendance_days)
 * の記録をそのままカレンダー風に色分け表示しているだけ(GAS版と同じ設計)。そのため
 * Googleカレンダー連携(Phase 5)が無くても動く。「🔄 最新にする」も、その連携が入るまでは
 * 出勤簿を読み直すところまでしか行わない(GAS版の「📅 カレンダーから取得」に当たる
 * カレンダーとの見くらべは、web側APIがまだ無い)。
 */
export function AttendanceCalendar({ staffId }: { staffId?: string } = {}) {
  const queryClient = useQueryClient();
  const { showSuccess, showError } = useFeedback();
  const [weekAnchor, setWeekAnchor] = useState(() => calGetWeekStart(new Date()));
  const [viewMode, setViewMode] = useState<'week' | 'day'>('week');
  /** 週の見せかた。既定は予定のある日だけのリスト。'grid'がGAS版と同じ7列の表。 */
  const [weekLayout, setWeekLayout] = useState<'list' | 'grid'>('list');
  const [selectedDate, setSelectedDate] = useState(() => calYmd(new Date()));
  const [openSlot, setOpenSlot] = useState<ScheduleEventSlot | null>(null);
  const [dayRowData, setDayRowData] = useState<AttendanceRowData>({});
  const [refreshing, setRefreshing] = useState(false);

  const weekEnd = (() => {
    const d = new Date(weekAnchor);
    d.setDate(d.getDate() + 6);
    return d;
  })();
  const weekStartStr = calYmd(weekAnchor);
  const weekEndStr = calYmd(weekEnd);

  const weekQuery = useQuery({
    queryKey: ['attendance-week', weekStartStr, weekEndStr, staffId],
    queryFn: () => fetchAttendanceWeekEvents(weekStartStr, weekEndStr, staffId),
  });

  const dayQuery = useQuery({
    queryKey: ['attendance-day', selectedDate, staffId],
    queryFn: async () => {
      const result = await fetchAttendanceDay(selectedDate, staffId);
      setDayRowData(result.rowData);
      return result;
    },
    enabled: viewMode === 'day',
  });

  const saveMutation = useMutation({
    mutationFn: (rowData: AttendanceRowData) => saveAttendanceDay(selectedDate, rowData, staffId),
    onSuccess: (result) => {
      setDayRowData(result.rowData);
      queryClient.invalidateQueries({ queryKey: ['attendance-day', selectedDate, staffId] });
      queryClient.invalidateQueries({ queryKey: ['attendance-week', weekStartStr, weekEndStr, staffId] });
      queryClient.invalidateQueries({ queryKey: ['attendance-month'] });
      showSuccess('保存しました');
    },
    onError: (e) => showError(toFriendlyMessage(e, '出勤簿の保存')),
  });

  const weekEvents = weekQuery.data ?? [];
  const todayStr = calYmd(new Date());

  const drillToDay = (dateStr: string) => {
    setSelectedDate(dateStr);
    setViewMode('day');
  };

  const handleSlotSave = (fields: { name: string; start: string; end: string } | null) => {
    if (!openSlot) return;
    const merged = applySlotEdit(dayRowData, openSlot, fields);
    setDayRowData(merged);
    saveMutation.mutate(merged);
    setOpenSlot(null);
  };

  /**
   * 「🔄 最新にする」。読むだけの操作なので確認ダイアログは出さない。
   *
   * GAS版はここが「📅 カレンダーから取得」「🔄 勤怠シートから読込」の2つに分かれていたが、
   * 違いはスタッフには判断できないため1つに統合した。web側にはまだカレンダーと見くらべる
   * APIが無いので、いまは出勤簿を読み直すところまで。連携が入ったら、この後ろに
   * 「カレンダーと見くらべる→違いがあれば取り込むか聞く」を足す。
   */
  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const week = await weekQuery.refetch();
      if (viewMode === 'day') await dayQuery.refetch();
      queryClient.invalidateQueries({ queryKey: ['attendance-month'] });
      if (week.isError) {
        showError(toFriendlyMessage(week.error, '出勤簿の読み直し'));
        return;
      }
      showSuccess('出勤簿を最新にしました');
    } catch (e) {
      showError(toFriendlyMessage(e, '出勤簿の読み直し'));
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="bg-white rounded-card border border-gray-200 p-4 mb-4">
      {/* 提案書の文面は「毎晩、自動で最新になります。今すぐ直したいときは、日にちを押してください。」
          だが、夜間の自動取り込み(Googleカレンダーとの同期)はこのアプリではまだ動いていない
          (packages/worker は outbox ミラーだけで、夜間同期は別Phase)。動いていないことを
          「自動で最新になります」と書くと嘘になるので、いまは事実だけを1行で書く。
          夜間同期が入ったら提案書どおりの文面に差しかえること。 */}
      <p className="text-sm leading-relaxed text-app-muted mb-3">
        ここに出るのは、保存した出勤簿の記録です。直したいときは、日にちを押してください。
      </p>

      {/* 週の見出しはボタンの上に1行で出す。ボタンの間に挟むと、狭い端末では
          「9月13日〜9月19日」が3行に折り返してしまう。 */}
      <p className="mb-2 text-center text-base font-bold text-app-text">
        {calFormatMonthDay(weekAnchor)}〜{calFormatMonthDay(weekEnd)}
      </p>

      {/* 週送り。細い記号(‹ ›)は押しにくいので、文字つきの44pxボタンにしている。 */}
      <ButtonRow className="mb-3">
        <Button
          variant="subtle"
          size="sub"
          className="flex-1 px-3"
          onClick={() =>
            setWeekAnchor((prev) => {
              const d = new Date(prev);
              d.setDate(d.getDate() - 7);
              return d;
            })
          }
        >
          ◀ 前の週
        </Button>
        <Button
          variant="subtle"
          size="sub"
          className="flex-1 px-3"
          onClick={() =>
            setWeekAnchor((prev) => {
              const d = new Date(prev);
              d.setDate(d.getDate() + 7);
              return d;
            })
          }
        >
          次の週 ▶
        </Button>
      </ButtonRow>

      <ButtonRow className="mb-3">
        <Button
          variant="subtle"
          size="sub"
          onClick={() => {
            setWeekAnchor(calGetWeekStart(new Date()));
            setSelectedDate(todayStr);
            setViewMode('week');
          }}
        >
          きょうの週
        </Button>
        {viewMode === 'week' ? (
          <Button
            variant="subtle"
            size="sub"
            onClick={() => setWeekLayout((prev) => (prev === 'list' ? 'grid' : 'list'))}
          >
            {weekLayout === 'list' ? '表で見る' : '一覧で見る'}
          </Button>
        ) : (
          <Button variant="subtle" size="sub" onClick={() => setViewMode('week')}>
            ← 週の一覧へ
          </Button>
        )}
      </ButtonRow>

      {/* 日付ボタンの行。どの見せかたでも、ここから日を選べるようにしている。 */}
      <div className="flex gap-1 mb-3">
        {Array.from({ length: 7 }, (_, i) => {
          const d = new Date(weekAnchor);
          d.setDate(d.getDate() + i);
          const dateStr = calYmd(d);
          const dayEvents = weekEvents.filter((e) => e.date === dateStr);
          const isSelected = viewMode === 'day' && dateStr === selectedDate;
          const isToday = dateStr === todayStr;
          const baseCls = isSelected
            ? 'bg-app-primary text-white border-app-primary'
            : isToday
              ? 'bg-app-primary-bg text-app-text border-app-primary'
              : 'text-app-text border-gray-200 active:bg-gray-100';
          const dotCls =
            dayEvents.length > 0 ? (isSelected ? 'bg-white' : 'bg-app-primary') : 'bg-transparent';
          return (
            <button
              key={dateStr}
              type="button"
              onClick={() => drillToDay(dateStr)}
              className={`flex-1 min-h-[52px] flex flex-col items-center justify-center rounded-btn border transition-colors ${baseCls}`}
            >
              <span className="text-sm leading-tight">{CAL_DOW[d.getDay()]}</span>
              <span className="text-base font-bold leading-tight">{d.getDate()}</span>
              <span className={`w-1.5 h-1.5 rounded-full ${dotCls} mt-0.5`} />
            </button>
          );
        })}
      </div>

      <div className="relative">
        {weekQuery.isPending && <LoadingBlock text="読み込んでいます…" />}
        {weekQuery.isError && (
          <ErrorNotice text={toFriendlyMessage(weekQuery.error, '出勤簿の週の読み込み')} />
        )}
        {weekQuery.data &&
          (viewMode === 'week' ? (
            weekLayout === 'list' ? (
              <WeekList weekAnchor={weekAnchor} events={weekEvents} onDayClick={drillToDay} />
            ) : (
              <WeekGrid weekAnchor={weekAnchor} events={weekEvents} onDayClick={drillToDay} />
            )
          ) : (
            <DayGrid date={selectedDate} events={weekEvents} onSlotClick={setOpenSlot} />
          ))}
      </div>

      <p className="text-sm text-app-muted mt-3">
        {viewMode === 'week'
          ? '日にちを押すと、その日の記録を直せます'
          : '予定を押すと、お客様の名前や時間を直せます'}
      </p>

      {viewMode === 'day' && dayQuery.isPending && <LoadingBlock text="この日の記録を読み込んでいます…" />}
      {viewMode === 'day' && dayQuery.isError && (
        <div className="mt-3">
          <ErrorNotice text={toFriendlyMessage(dayQuery.error, '出勤簿の1日の読み込み')} />
        </div>
      )}

      {viewMode === 'day' && dayQuery.data && (
        <div className="mt-4 space-y-2">
          <div className="text-base font-bold text-app-text mb-1">✏️ 記録を直す・足す</div>
          {ATTENDANCE_SLOT_DEFS.map((def) => {
            const { name, start, end } = readSlotFields(dayRowData, def.slot);
            const registered = !!(start && end);
            return (
              <button
                key={slotKeyString(def.slot)}
                type="button"
                onClick={() => setOpenSlot(def.slot)}
                className="w-full min-h-[48px] flex items-center justify-between gap-3 px-3 py-2 rounded-btn border border-gray-200 active:bg-gray-100 text-left text-base text-app-text"
              >
                <span>
                  {registered ? '✅' : '➕'} {def.label}
                  {registered && name ? `: ${name}` : ''}
                </span>
                {registered && (
                  <span className="shrink-0 text-sm text-app-muted">
                    {start}〜{end}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {viewMode === 'day' && dayQuery.data && (
        <div className="mt-4">
          {/* 日が変わるたびに再マウントする(MoveDistancePanel.tsx冒頭のコメント参照。
              入力中のローカル文字列状態を、日を切り替えたのにマウント時の値のまま
              残さないため)。 */}
          <MoveDistancePanel
            key={selectedDate}
            rowData={dayRowData}
            onChange={setDayRowData}
            onSave={() => saveMutation.mutate(dayRowData)}
            saving={saveMutation.isPending}
          />
        </div>
      )}

      {/* 更新は一番下に灰色で1つ。自動で読み込むので目立たせない(提案書「ホーム」と同じ扱い)。 */}
      <Button variant="subtle" size="sub" fullWidth disabled={refreshing} onClick={handleRefresh}>
        {refreshing ? '読み込んでいます…' : '🔄 最新にする'}
      </Button>

      {openSlot && (
        <SlotEditModal
          slot={openSlot}
          rowData={dayRowData}
          onSave={handleSlotSave}
          onClose={() => setOpenSlot(null)}
        />
      )}
    </div>
  );
}

/**
 * 週の既定の見せかた。予定のある日だけを1行ずつ並べる
 * (1行 = 日にち・曜日 / お客様名を「→」でつないだ1行 / 開始〜終了 / 合計時間)。
 */
function WeekList({
  weekAnchor,
  events,
  onDayClick,
}: {
  weekAnchor: Date;
  events: ScheduleEvent[];
  onDayClick: (dateStr: string) => void;
}) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekAnchor);
    d.setDate(d.getDate() + i);
    const dateStr = calYmd(d);
    return { date: d, dateStr, events: sortByStart(events.filter((e) => e.date === dateStr)) };
  }).filter((day) => day.events.length > 0);

  if (days.length === 0) {
    return (
      <EmptyState
        icon="📭"
        title="この週の記録はまだありません"
        nextStep="上の日にちを押すと、その日の記録を書けます。先週を見るときは「◀ 前の週」を押してください"
      />
    );
  }

  return (
    <ul className="space-y-2">
      {days.map((day) => {
        const titles = day.events.map((e) => e.title || '(名前なし)').join(' → ');
        // filterで予定のある日だけにしているので、先頭と末尾は必ず存在する。
        const start = day.events[0]?.start ?? '';
        const end = day.events[day.events.length - 1]?.end ?? '';
        return (
          <li key={day.dateStr}>
            <button
              type="button"
              onClick={() => onDayClick(day.dateStr)}
              className="w-full min-h-[48px] rounded-card border border-gray-200 p-3 text-left active:bg-gray-100"
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-base font-bold text-app-text">
                  {day.date.getDate()} {CAL_DOW[day.date.getDay()]}
                </span>
                <span className="shrink-0 text-base font-bold text-app-text">
                  {calFormatHours(calSumEventMinutes(day.events))}
                </span>
              </div>
              <div className="text-base text-app-text break-words">{titles}</div>
              <div className="text-sm text-app-muted">
                {start}〜{end}
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * 「表で見る」で切りかえるGoogleカレンダー風の7列グリッド(GAS版と同じ見せかた)。
 * 14px以上の文字で7列を並べるとスマホの幅には収まらないため、横スクロールで見せる。
 */
function WeekGrid({
  weekAnchor,
  events,
  onDayClick,
}: {
  weekAnchor: Date;
  events: ScheduleEvent[];
  onDayClick: (dateStr: string) => void;
}) {
  const { startHour, endHour } = calComputeHourRange(events);
  const totalHeight = (endHour - startHour) * CAL_WEEK_HOUR_HEIGHT;

  return (
    <div>
      <p className="text-sm text-app-muted mb-2">横にスクロールすると、右の曜日が見られます</p>
      <div className="overflow-x-auto">
        <div className="flex" style={{ height: totalHeight, minWidth: CAL_WEEK_GRID_MIN_WIDTH }}>
          <div className="relative flex-shrink-0" style={{ width: CAL_TIME_AXIS_WIDTH, height: totalHeight }}>
            {Array.from({ length: endHour - startHour + 1 }, (_, i) => startHour + i).map((h) => (
              <div
                key={h}
                className="absolute left-0 text-sm text-app-muted"
                style={{ top: (h - startHour) * CAL_WEEK_HOUR_HEIGHT - 8 }}
              >
                {h}
              </div>
            ))}
          </div>
          <div className="flex flex-grow relative gap-0.5">
            {Array.from({ length: 7 }, (_, i) => {
              const d = new Date(weekAnchor);
              d.setDate(d.getDate() + i);
              const dateStr = calYmd(d);
              const dayEvents = events.filter((e) => e.date === dateStr);
              return (
                <button
                  key={dateStr}
                  type="button"
                  onClick={() => onDayClick(dateStr)}
                  className="flex-1 relative border-l border-gray-200 cursor-pointer text-left"
                  style={{ height: totalHeight }}
                >
                  {Array.from({ length: endHour - startHour + 1 }, (_, i2) => startHour + i2).map((h) => (
                    <div
                      key={h}
                      className="absolute left-0 right-0 border-t border-gray-200"
                      style={{ top: (h - startHour) * CAL_WEEK_HOUR_HEIGHT }}
                    />
                  ))}
                  {dayEvents.map((e) => {
                    const startMin = calTimeToMinutes(e.start) ?? 0;
                    const endMin = calTimeToMinutes(e.end) ?? startMin;
                    const top = (startMin / 60 - startHour) * CAL_WEEK_HOUR_HEIGHT;
                    const height = Math.max(20, ((endMin - startMin) / 60) * CAL_WEEK_HOUR_HEIGHT);
                    const cls = CAL_TYPE_STYLE[e.eventType] ?? 'bg-gray-100 border-gray-300';
                    return (
                      <div
                        key={slotKeyString(e.slot)}
                        className={`absolute left-0 right-0 z-10 overflow-hidden rounded-btn border px-1 leading-tight ${cls}`}
                        style={{ top, minHeight: height }}
                        title={`${e.start}〜${e.end} ${e.title}`}
                      >
                        <div className="text-sm font-bold" style={{ wordBreak: 'break-word' }}>
                          {e.title || '(名前なし)'}
                        </div>
                        <div className="text-sm opacity-75">
                          {e.start}〜{e.end}
                        </div>
                      </div>
                    );
                  })}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/** 1日表示(ドリルダウン)。予定を押すとSlotEditModalが開く。 */
function DayGrid({
  date,
  events,
  onSlotClick,
}: {
  date: string;
  events: ScheduleEvent[];
  onSlotClick: (slot: ScheduleEventSlot) => void;
}) {
  const dayEvents = events.filter((e) => e.date === date);
  const { startHour, endHour } = calComputeHourRange(dayEvents);
  const totalHeight = (endHour - startHour) * CAL_DAY_HOUR_HEIGHT;

  return (
    <div className="relative" style={{ height: totalHeight }}>
      {Array.from({ length: endHour - startHour + 1 }, (_, i) => startHour + i).map((h) => (
        <div
          key={h}
          className="absolute left-0 right-0 border-t border-gray-200"
          style={{ top: (h - startHour) * CAL_DAY_HOUR_HEIGHT }}
        >
          <span className="text-sm text-app-muted pl-1">{String(h).padStart(2, '0')}:00</span>
        </div>
      ))}
      {dayEvents.map((e) => {
        const startMin = calTimeToMinutes(e.start) ?? 0;
        const endMin = calTimeToMinutes(e.end) ?? startMin;
        const top = (startMin / 60 - startHour) * CAL_DAY_HOUR_HEIGHT;
        const height = Math.max(44, ((endMin - startMin) / 60) * CAL_DAY_HOUR_HEIGHT);
        const cls = CAL_TYPE_STYLE[e.eventType] ?? 'bg-gray-100 text-app-text border-gray-300';
        return (
          <button
            key={slotKeyString(e.slot)}
            type="button"
            onClick={() => onSlotClick(e.slot)}
            className={`absolute left-16 right-1 rounded-btn border px-2 py-1 text-sm overflow-hidden text-left ${cls}`}
            style={{ top, height }}
            title={e.title}
          >
            <div className="font-bold truncate text-base">{e.title || '(名前なし)'}</div>
            <div className="truncate opacity-75">
              {e.start}〜{e.end}
            </div>
          </button>
        );
      })}
    </div>
  );
}
