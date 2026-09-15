import type { ImportSheet, ReportAiImportPayload, ReportAiImportResult } from '@katahimo/shared';
import { parseReportAiImportSheets } from '@katahimo/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { read, utils } from 'xlsx';
import { importReportAiConfig } from '../reportAiAdminApi';
import { BUTTON_PRIMARY_CLASS, ErrorText, NoticeText } from './shared';

/** 反映件数を「年齢帯 3件」のように短く並べるための表示名。 */
const RESULT_LABELS: Record<keyof ReportAiImportResult, string> = {
  ageBands: '年齢帯',
  keywords: 'キーワード',
  educationLevels: '教育関心度★',
  stressLevels: 'ストレス度(PSI)',
  phrases: '温かみ・避ける表現',
  promptTemplates: 'AIプロンプト文面',
};

interface Preview {
  fileName: string;
  payload: ReportAiImportPayload;
  warnings: string[];
}

/** 取込データの件数(シートから読めた行数。プレビュー表示用)。 */
function countPayload(payload: ReportAiImportPayload): Record<keyof ReportAiImportResult, number> {
  return {
    ageBands: payload.ageBands.length,
    keywords: payload.keywords.length,
    educationLevels: payload.educationLevels.length,
    stressLevels: payload.stressLevels.length,
    phrases: payload.phrases.length,
    promptTemplates: payload.promptTemplates.length,
  };
}

/**
 * xlsx/xls/csvの取込。SheetJS(`xlsx`パッケージ)でブラウザ側から全シートを読み、
 * 変換(見出しの判定・行の検証)は`parseReportAiImportSheets`(@katahimo/shared、純関数)に任せる。
 * ここはファイル読み込み・プレビュー表示・確定送信(`POST /import`)だけを担う。
 */
export function ImportTab() {
  const queryClient = useQueryClient();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [result, setResult] = useState<ReportAiImportResult | null>(null);

  const importMutation = useMutation({
    mutationFn: (payload: ReportAiImportPayload) => importReportAiConfig(payload),
    onSuccess: (res) => {
      setResult(res);
      setPreview(null);
      queryClient.invalidateQueries({ queryKey: ['report-ai-admin'] });
    },
  });

  /** 選ばれたファイルを読み、シートの内容をプレビューに出す(この時点では送信しない)。 */
  const handleFile = async (file: File) => {
    setReadError(null);
    setResult(null);
    setPreview(null);
    try {
      const buffer = await file.arrayBuffer();
      const workbook = read(buffer, { type: 'array' });
      const sheets: ImportSheet[] = workbook.SheetNames.map((name) => {
        const worksheet = workbook.Sheets[name];
        return {
          name,
          rows: worksheet
            ? (utils.sheet_to_json(worksheet, {
                header: 1,
                raw: true,
                defval: null,
              }) as (string | number | boolean | null)[][])
            : [],
        };
      });
      const { payload, warnings } = parseReportAiImportSheets({ sheets });
      setPreview({ fileName: file.name, payload, warnings });
    } catch (e) {
      setReadError(e instanceof Error ? e.message : String(e));
    }
  };

  const counts = preview ? countPayload(preview.payload) : null;
  const totalRows = counts ? Object.values(counts).reduce((sum, n) => sum + n, 0) : 0;

  return (
    <div className="space-y-3">
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-2 text-xs text-amber-800 space-y-1">
        <p>
          法人の資料(xlsx・xls・csv)をそのまま読み込みます。見出し行(1行目)の列名でシートの種類を
          判定するので、シート名は自由です。
        </p>
        <p>
          GAS版「ＡＩプロンプト」シート(見出し <code>Key</code> / <code>Prompt Template</code>)も
          同じ経路で読み込めます。
        </p>
        <p className="font-bold">
          取込は「マージ」です。code・levelが同じ行は上書きし、この表に無い行(既に画面から
          追加していた行など)は消えません。
        </p>
      </div>

      <div>
        <label className="block text-xs font-bold text-gray-600 mb-1" htmlFor="reportAiImportFile">
          ファイルを選ぶ
        </label>
        <input
          id="reportAiImportFile"
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
            e.target.value = '';
          }}
          className="block w-full text-xs"
        />
      </div>

      <ErrorText>{readError}</ErrorText>

      {preview && counts && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-3 space-y-2">
          <p className="text-xs font-bold text-gray-600">
            プレビュー: {preview.fileName}(読み取れた行 {totalRows}件)
          </p>
          <ul className="text-xs text-gray-700 grid grid-cols-2 gap-x-4 gap-y-1">
            {(Object.keys(RESULT_LABELS) as (keyof ReportAiImportResult)[]).map((key) => (
              <li key={key}>
                {RESULT_LABELS[key]}: {counts[key]}件
              </li>
            ))}
          </ul>
          {preview.warnings.length > 0 && (
            <div>
              <p className="text-xs font-bold text-amber-700 mb-1">
                取り込めなかった行・シート({preview.warnings.length}件)
              </p>
              <ul className="text-xs text-amber-700 list-disc pl-4 space-y-0.5 max-h-40 overflow-y-auto">
                {preview.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          )}
          {totalRows === 0 && (
            <p className="text-xs text-red-500">
              取り込める行がありませんでした。見出し行の列名を別紙(取込の別名表)と見比べてください。
            </p>
          )}

          <ErrorText>{importMutation.error instanceof Error ? importMutation.error.message : null}</ErrorText>

          <button
            type="button"
            disabled={totalRows === 0 || importMutation.isPending}
            onClick={() => importMutation.mutate(preview.payload)}
            className={BUTTON_PRIMARY_CLASS}
          >
            {importMutation.isPending ? '取込中…' : '取り込む'}
          </button>
        </div>
      )}

      {result && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-xs text-green-800">
          <NoticeText>取り込みました。</NoticeText>
          <ul className="grid grid-cols-2 gap-x-4 gap-y-1 mt-1">
            {(Object.keys(RESULT_LABELS) as (keyof ReportAiImportResult)[]).map((key) => (
              <li key={key}>
                {RESULT_LABELS[key]}: {result[key]}件反映
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
