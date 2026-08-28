import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
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
    <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.85rem', gap: '0.2rem' }}>
      {label}
      <input
        type={type}
        value={value[fieldKey] ?? ''}
        onChange={(e) => onChange(fieldKey, e.target.value)}
        style={{ padding: '0.25rem' }}
      />
    </label>
  );
}

/**
 * 勤怠(出勤簿)の1日入力・月次集計画面。出勤簿テンプレートの入力列のみを扱い、
 * 労働時間・残業・移動距離・基準距離超過回数などの派生値は
 * packages/core/src/domain/attendance/attendanceCalc.ts(GAS版と数値一致を検証済み)で
 * 都度計算した結果を表示する。カレンダー連携(Phase 5)が無いため、現時点では手入力のみ。
 */
export function AttendancePage() {
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
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem', maxWidth: 640 }}>
      <p>
        <Link to="/">← 検索に戻る</Link>
      </p>
      <h1>勤怠(出勤簿)</h1>

      <section style={{ marginBottom: '1.5rem' }}>
        <label>
          対象日: <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
      </section>

      {dayQuery.isPending && <p>読み込み中…</p>}

      {dayQuery.data && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            saveMutation.mutate();
          }}
        >
          <fieldset style={{ marginBottom: '1rem' }}>
            <legend>訪問その1</legend>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem' }}>
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
              <Field label="天候(雪 で移動時間1.3倍)" fieldKey="I" value={rowData} onChange={handleChange} />
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
          </fieldset>

          <fieldset style={{ marginBottom: '1rem' }}>
            <legend>訪問その2</legend>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem' }}>
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
          </fieldset>

          <fieldset style={{ marginBottom: '1rem' }}>
            <legend>訪問その3</legend>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem' }}>
              <Field label="訪問先等" fieldKey="U" value={rowData} onChange={handleChange} />
              <Field label="始業" fieldKey="V" type="time" value={rowData} onChange={handleChange} />
              <Field label="終業" fieldKey="W" type="time" value={rowData} onChange={handleChange} />
            </div>
          </fieldset>

          <fieldset style={{ marginBottom: '1rem' }}>
            <legend>事務作業</legend>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.5rem' }}>
              <Field label="作業1" fieldKey="X" value={rowData} onChange={handleChange} />
              <Field label="開始" fieldKey="Y" type="time" value={rowData} onChange={handleChange} />
              <Field label="終了" fieldKey="Z" type="time" value={rowData} onChange={handleChange} />
              <Field label="作業2" fieldKey="AA" value={rowData} onChange={handleChange} />
              <Field label="開始" fieldKey="AB" type="time" value={rowData} onChange={handleChange} />
              <Field label="終了" fieldKey="AC" type="time" value={rowData} onChange={handleChange} />
            </div>
            <p style={{ fontSize: '0.8rem', color: '#666' }}>
              作業名に「mtg」を含めると、その時間帯は所定内(残業扱いにしない)特例になります。
            </p>
          </fieldset>

          <fieldset style={{ marginBottom: '1rem' }}>
            <legend>その他</legend>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '0.5rem' }}>
              <Field
                label="買物代行(回数)"
                fieldKey="AN"
                type="number"
                value={rowData}
                onChange={handleChange}
              />
              <Field label="備考" fieldKey="AO" value={rowData} onChange={handleChange} />
            </div>
          </fieldset>

          <button type="submit" disabled={saveMutation.isPending}>
            {saveMutation.isPending ? '保存中…' : '保存する'}
          </button>
          {saveMutation.isError && <p style={{ color: '#b91c1c' }}>{saveMutation.error.message}</p>}
        </form>
      )}

      {derived && (
        <section style={{ marginTop: '1.5rem' }}>
          <h2>この日の計算結果</h2>
          <ul>
            <li>労働時間: {formatMinutes(derived.laborMinutes)}</li>
            <li>残業時間: {formatMinutes(derived.overtimeMinutes)}</li>
            <li>移動時間合計: {formatMinutes(derived.totalMoveMin)}</li>
            <li>移動距離合計: {derived.totalDistanceKm}km</li>
            <li>基準距離超過回数: {derived.overThresholdCount}</li>
            <li>訪問等回数: {derived.visitCount}</li>
          </ul>
        </section>
      )}

      <section style={{ marginTop: '2rem', borderTop: '1px solid #ccc', paddingTop: '1rem' }}>
        <h2>月次集計</h2>
        <label>
          対象月: <input type="month" value={yearMonth} onChange={(e) => setYearMonth(e.target.value)} />
        </label>

        {monthQuery.isPending && <p>読み込み中…</p>}
        {monthQuery.data && (
          <ul>
            <li>入力済み日数: {monthQuery.data.days.length}</li>
            <li>労働時間合計: {formatMinutes(monthQuery.data.totals.laborMinutes)}</li>
            <li>残業時間合計: {formatMinutes(monthQuery.data.totals.overtimeMinutes)}</li>
            <li>移動距離合計: {monthQuery.data.totals.totalDistanceKm}km</li>
            <li>基準距離超過回数合計: {monthQuery.data.totals.overThresholdCount}</li>
            <li>買物代行合計: {monthQuery.data.totals.shoppingErrandTotal}</li>
          </ul>
        )}
      </section>
    </main>
  );
}
