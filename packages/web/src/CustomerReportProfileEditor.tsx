import { type CustomerReportProfileView, REPORT_LEVEL_MAX, REPORT_LEVEL_MIN } from '@katahimo/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { fetchReportAiConfig, parseJsonOrThrow } from './api';

/**
 * `PUT /api/customers/:id/report-profile`。管理者に限定しない一般エンドポイントなので、
 * 他のadmin向けAPI(settings/reportAiAdminApi.ts)とは別にここで直接呼ぶ。
 */
async function updateCustomerReportProfile(
  customerId: string,
  input: { educationLevel: number | null; note: string },
): Promise<CustomerReportProfileView> {
  const res = await fetch(`/api/customers/${encodeURIComponent(customerId)}/report-profile`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(input),
  });
  const body = await parseJsonOrThrow<{ reportProfile: CustomerReportProfileView }>(res);
  return body.reportProfile;
}

/**
 * 顧客詳細の「日報の書き方(教育関心度★)」。担当スタッフが家庭の様子から★を付け、日報AI生成が
 * その★に応じて教育キーワードの使い方を変える(doc/db/new-domains.md 第6章)。
 *
 * 管理者に限定しない(設計書「管理者・担当者が付ける」)。ラベル・説明は管理画面
 * (ReportAiAdminModal)で設定した教育関心度★の判定基準(`GET /api/reports/ai-config`)から取る。
 * 行が無いレベルは「★n」だけを表示する。
 */
export function CustomerReportProfileEditor({
  customerId,
  reportProfile,
}: {
  customerId: string;
  reportProfile: CustomerReportProfileView | null;
}) {
  const queryClient = useQueryClient();
  const configQuery = useQuery({ queryKey: ['report-ai-config'], queryFn: fetchReportAiConfig });

  const [editing, setEditing] = useState(false);
  const [level, setLevel] = useState<number | null>(reportProfile?.educationLevel ?? null);
  const [note, setNote] = useState(reportProfile?.note ?? '');

  // 保存後や顧客切り替えでreportProfileが差し替わったら、編集していない間は表示中の値へ追従させる。
  useEffect(() => {
    if (editing) return;
    setLevel(reportProfile?.educationLevel ?? null);
    setNote(reportProfile?.note ?? '');
  }, [editing, reportProfile]);

  const mutation = useMutation({
    mutationFn: () => updateCustomerReportProfile(customerId, { educationLevel: level, note: note.trim() }),
    onSuccess: () => {
      setEditing(false);
      queryClient.invalidateQueries({ queryKey: ['customer', customerId] });
    },
  });

  const levels = Array.from(
    { length: REPORT_LEVEL_MAX - REPORT_LEVEL_MIN + 1 },
    (_, i) => REPORT_LEVEL_MIN + i,
  );
  const levelLabel = (lv: number): string => {
    const info = configQuery.data?.educationLevels.find((e) => e.level === lv);
    return info ? `★${lv}(${info.label})` : `★${lv}`;
  };

  if (!editing) {
    return (
      <section>
        <h3 className="font-bold text-gray-700 text-sm mb-2">日報の書き方(教育関心度★)</h3>
        <div className="bg-gray-50 rounded-lg p-2 text-sm text-gray-800">
          <p>
            {reportProfile?.educationLevel != null ? (
              levelLabel(reportProfile.educationLevel)
            ) : (
              // DEFAULT_EDUCATION_LEVEL(@katahimo/core promptAssembly.ts)=2。未設定はこの値として生成される。
              <span className="text-gray-500">未設定(生成時は★2相当として扱われます)</span>
            )}
          </p>
          {reportProfile?.note && (
            <p className="text-xs text-gray-500 mt-1 break-words">{reportProfile.note}</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="mt-1 text-xs text-blue-600 underline"
        >
          編集
        </button>
      </section>
    );
  }

  return (
    <section>
      <h3 className="font-bold text-gray-700 text-sm mb-2">日報の書き方(教育関心度★)</h3>
      <div className="space-y-2 bg-white rounded-lg border border-gray-200 p-2">
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-600 shrink-0" htmlFor="customerReportProfileLevel">
            教育関心度★
          </label>
          <select
            id="customerReportProfileLevel"
            value={level === null ? '' : String(level)}
            onChange={(e) => setLevel(e.target.value === '' ? null : Number(e.target.value))}
            className="flex-1 min-w-0 text-sm border-gray-300 rounded p-1"
          >
            <option value="">未設定</option>
            {levels.map((lv) => (
              <option key={lv} value={lv}>
                {levelLabel(lv)}
              </option>
            ))}
          </select>
        </div>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="★を付けた根拠・家庭の意向など(任意)"
          aria-label="メモ"
          className="w-full text-sm border-gray-300 rounded p-2"
        />
        {mutation.error && (
          <p className="text-xs text-red-600">
            {mutation.error instanceof Error ? mutation.error.message : String(mutation.error)}
          </p>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate()}
            className="px-3 py-1 text-sm bg-blue-600 text-white rounded disabled:bg-gray-300"
          >
            {mutation.isPending ? '保存中…' : '保存'}
          </button>
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setLevel(reportProfile?.educationLevel ?? null);
              setNote(reportProfile?.note ?? '');
            }}
            className="px-3 py-1 text-sm text-gray-600"
          >
            やめる
          </button>
        </div>
      </div>
    </section>
  );
}
