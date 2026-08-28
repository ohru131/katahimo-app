import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useState } from 'react';
import type { AttendanceRowData } from './api';
import { fetchAttendanceDay, fetchAttendanceMonth, saveAttendanceDay } from './api';

function todayStr(): string {
  return new Date().toLocaleDateString('sv-SE'); // 'YYYY-MM-DD'
}

function currentYearMonth(): string {
  return todayStr().slice(0, 7);
}

function formatMinutes(min: number | ''): string {
  if (min === '') return '-';
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return `${h}時間${m}分`;
}

interface FieldProps {
  label: string;
  fieldKey: keyof AttendanceRowData;
  type?: string;
  value: AttendanceRowData;
  onChange: (key: keyof AttendanceRowData, value: string) => void;
}

function Field({ label, fieldKey, type = 'text', value, onChange }: FieldProps) {
  return (
    <label className="flex flex-col text-xs font-medium text-gray-600 gap-1">
      {label}
      <input
        type={type}
        value={value[fieldKey] ?? ''}
        onChange={(e) => onChange(fieldKey, e.target.value)}
        className="p-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:outline-none text-sm text-gray-800"
      />
    </label>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 mb-3">
      <h3 className="font-bold text-gray-700 text-sm mb-3">{title}</h3>
      {children}
    </div>
  );
}

/**
 * 「勤怠」タブ。GAS版のtabPastSchedule(月次集計モーダル等)と同じカード基調の見た目にしている
 * (移行時の混乱を減らすため)。出勤簿テンプレートの入力列のみを扱い、労働時間・残業・移動距離・
 * 基準距離超過回数などの派生値は packages/core/src/domain/attendance/attendanceCalc.ts
 * (GAS版と数値一致を検証済み)で都度計算した結果を表示する。カレンダー連携(Phase 5)がまだ無いため、
 * 現時点では手入力のみ。
 */
export function AttendanceTab() {
  const queryClient = useQueryClient();
  const [date, setDate] = useState(todayStr());
  const [yearMonth, setYearMonth] = useState(currentYearMonth());
  const [rowData, setRowData] = useState<AttendanceRowData>({});

  const dayQuery = useQuery({
    queryKey: ['attendance-day', date],
    queryFn: async () => {
      const result = await fetchAttendanceDay(date);
      setRowData(result.rowData);
      return result;
    },
  });

  const monthQuery = useQuery({
    queryKey: ['attendance-month', yearMonth],
    queryFn: () => fetchAttendanceMonth(yearMonth),
  });

  const saveMutation = useMutation({
    mutationFn: () => saveAttendanceDay(date, rowData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['attendance-day', date] });
      queryClient.invalidateQueries({ queryKey: ['attendance-month', yearMonth] });
    },
  });

  const handleChange = (key: keyof AttendanceRowData, value: string) => {
    setRowData((prev) => ({ ...prev, [key]: value }));
  };

  const derived = dayQuery.data?.derived;

  return (
    <div>
      <div className="mb-3">
        <label className="block text-xs font-bold text-gray-600 mb-1" htmlFor="attendanceDate">
          対象日
        </label>
        <input
          id="attendanceDate"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="w-full p-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:outline-none text-sm"
        />
      </div>

      {dayQuery.isPending && (
        <div className="flex justify-center py-8">
          <div className="w-8 h-8 rounded-full border-4 border-gray-200 loading-spinner" />
        </div>
      )}

      {dayQuery.data && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            saveMutation.mutate();
          }}
        >
          <Card title="訪問その1">
            <div className="grid grid-cols-2 gap-3">
              <Field label="訪問先等" fieldKey="C" value={rowData} onChange={handleChange} />
              <Field label="始業" fieldKey="D" type="time" value={rowData} onChange={handleChange} />
              <Field label="終業" fieldKey="E" type="time" value={rowData} onChange={handleChange} />
              <Field
                label="→#2移動時間(分)"
                fieldKey="H"
                type="number"
                value={rowData}
                onChange={handleChange}
              />
              <Field label="天候(雪で移動時間1.3倍)" fieldKey="I" value={rowData} onChange={handleChange} />
              <Field
                label="→#2移動距離(km)"
                fieldKey="AG"
                type="number"
                value={rowData}
                onChange={handleChange}
              />
              <Field
                label="出勤距離(km)"
                fieldKey="AI"
                type="number"
                value={rowData}
                onChange={handleChange}
              />
            </div>
          </Card>

          <Card title="訪問その2">
            <div className="grid grid-cols-2 gap-3">
              <Field label="訪問先等" fieldKey="L" value={rowData} onChange={handleChange} />
              <Field label="始業" fieldKey="M" type="time" value={rowData} onChange={handleChange} />
              <Field label="終業" fieldKey="N" type="time" value={rowData} onChange={handleChange} />
              <Field
                label="→#3移動時間(分)"
                fieldKey="Q"
                type="number"
                value={rowData}
                onChange={handleChange}
              />
              <Field label="天候" fieldKey="R" value={rowData} onChange={handleChange} />
              <Field
                label="→#3移動距離(km)"
                fieldKey="AH"
                type="number"
                value={rowData}
                onChange={handleChange}
              />
              <Field
                label="退勤距離(km)"
                fieldKey="AJ"
                type="number"
                value={rowData}
                onChange={handleChange}
              />
            </div>
          </Card>

          <Card title="訪問その3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="訪問先等" fieldKey="U" value={rowData} onChange={handleChange} />
              <Field label="始業" fieldKey="V" type="time" value={rowData} onChange={handleChange} />
              <Field label="終業" fieldKey="W" type="time" value={rowData} onChange={handleChange} />
            </div>
          </Card>

          <Card title="事務作業">
            <div className="grid grid-cols-2 gap-3">
              <Field label="作業1" fieldKey="X" value={rowData} onChange={handleChange} />
              <Field label="開始" fieldKey="Y" type="time" value={rowData} onChange={handleChange} />
              <Field label="終了" fieldKey="Z" type="time" value={rowData} onChange={handleChange} />
              <Field label="作業2" fieldKey="AA" value={rowData} onChange={handleChange} />
              <Field label="開始" fieldKey="AB" type="time" value={rowData} onChange={handleChange} />
              <Field label="終了" fieldKey="AC" type="time" value={rowData} onChange={handleChange} />
            </div>
            <p className="text-xs text-gray-400 mt-2">
              作業名に「mtg」を含めると、その時間帯は所定内(残業扱いにしない)特例になります。
            </p>
          </Card>

          <Card title="その他">
            <div className="grid grid-cols-2 gap-3">
              <Field
                label="買物代行(回数)"
                fieldKey="AN"
                type="number"
                value={rowData}
                onChange={handleChange}
              />
              <Field label="備考" fieldKey="AO" value={rowData} onChange={handleChange} />
            </div>
          </Card>

          <button
            type="submit"
            disabled={saveMutation.isPending}
            className="w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-bold rounded-xl transition-colors mb-4"
          >
            {saveMutation.isPending ? '保存中…' : '保存する'}
          </button>
          {saveMutation.isError && (
            <p className="text-red-500 text-sm text-center mb-3">{saveMutation.error.message}</p>
          )}
        </form>
      )}

      {derived && (
        <Card title="この日の計算結果">
          <ul className="text-sm text-gray-800 space-y-1">
            <li>労働時間: {formatMinutes(derived.laborMinutes)}</li>
            <li>残業時間: {formatMinutes(derived.overtimeMinutes)}</li>
            <li>移動時間合計: {formatMinutes(derived.totalMoveMin)}</li>
            <li>移動距離合計: {derived.totalDistanceKm}km</li>
            <li>基準距離超過回数: {derived.overThresholdCount}</li>
            <li>訪問等回数: {derived.visitCount}</li>
          </ul>
        </Card>
      )}

      <div className="mt-6 pt-4 border-t border-gray-200">
        <h2 className="font-bold text-gray-700 text-sm mb-2">📊 月次集計</h2>
        <input
          type="month"
          value={yearMonth}
          onChange={(e) => setYearMonth(e.target.value)}
          className="w-full mb-3 p-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:outline-none text-sm"
        />

        {monthQuery.isPending && (
          <div className="flex justify-center py-4">
            <div className="w-6 h-6 rounded-full border-4 border-gray-200 loading-spinner" />
          </div>
        )}
        {monthQuery.data && (
          <Card title={`${monthQuery.data.yearMonth} の集計`}>
            <ul className="text-sm text-gray-800 space-y-1">
              <li>入力済み日数: {monthQuery.data.days.length}</li>
              <li>労働時間合計: {formatMinutes(monthQuery.data.totals.laborMinutes)}</li>
              <li>残業時間合計: {formatMinutes(monthQuery.data.totals.overtimeMinutes)}</li>
              <li>移動距離合計: {monthQuery.data.totals.totalDistanceKm}km</li>
              <li>基準距離超過回数合計: {monthQuery.data.totals.overThresholdCount}</li>
              <li>買物代行合計: {monthQuery.data.totals.shoppingErrandTotal}</li>
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}
