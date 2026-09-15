import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearReportDraft,
  loadReportDraft,
  type ReportDraft,
  type ReportDraftOwner,
  saveReportDraft,
} from './reportDraft';

/** node環境にはlocalStorageが無いので、最低限の実装を用意する。 */
function installLocalStorage(): Map<string, string> {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => {
      store.set(k, v);
    },
    removeItem: (k: string) => {
      store.delete(k);
    },
  });
  return store;
}

const OWNER: ReportDraftOwner = { tenantId: 'tenant-1', staffId: 'staff-1' };

function draftOf(patch: Partial<ReportDraft> = {}): ReportDraft {
  return {
    owner: OWNER,
    customerId: 'customer-1',
    customerName: '佐藤 花子',
    mode: 'daily',
    visitDate: '2026-09-14',
    startHour: '09',
    startMinute: '00',
    endHour: '11',
    endMinute: '00',
    memoText: '',
    accidentMemo: '',
    internalText: '',
    customerText: '',
    stressLevel: null,
    esRating: null,
    targetFamilyMemberId: null,
    aiGenerationId: null,
    accident: {
      reportType: '事故報告',
      targetName: '',
      targetDob: '',
      occurrenceTime: '',
      location: '',
      accidentContent: '',
      situation: '',
      immediateResponse: '',
      parentCorrespondence: '',
      diagnosisTreatment: '',
      prevention: '',
    },
    savedAt: Date.now(),
    ...patch,
  };
}

describe('日報・事故報告の書きかけの控え', () => {
  beforeEach(() => {
    installLocalStorage();
  });

  it('入力があれば控えを残し、そのまま読み戻せる', () => {
    saveReportDraft(draftOf({ memoText: '公園で30分あそびました' }));
    expect(loadReportDraft(OWNER)?.memoText).toBe('公園で30分あそびました');
  });

  it('1文字も入力が無い状態は控えを残さない(「書きかけがあります」と誤って出さないため)', () => {
    saveReportDraft(draftOf());
    expect(loadReportDraft(OWNER)).toBeNull();
  });

  it('入力を消して保存し直すと、残っていた控えも消える', () => {
    saveReportDraft(draftOf({ memoText: 'あ' }));
    saveReportDraft(draftOf({ memoText: '' }));
    expect(loadReportDraft(OWNER)).toBeNull();
  });

  it('事故報告側だけに入力があっても控えを残す', () => {
    saveReportDraft(draftOf({ mode: 'accident', accident: { ...draftOf().accident, location: '玄関' } }));
    expect(loadReportDraft(OWNER)?.accident.location).toBe('玄関');
  });

  it('評価だけを付けた状態も「入力あり」として扱う', () => {
    saveReportDraft(draftOf({ stressLevel: 3 }));
    expect(loadReportDraft(OWNER)?.stressLevel).toBe(3);
  });

  it('対象児を選んだだけの状態も「入力あり」として扱う', () => {
    saveReportDraft(draftOf({ targetFamilyMemberId: 'member-1' }));
    expect(loadReportDraft(OWNER)?.targetFamilyMemberId).toBe('member-1');
  });

  it('AI生成のgenerationIdを含めて控え、そのまま読み戻せる', () => {
    saveReportDraft(draftOf({ memoText: 'あ', aiGenerationId: 'gen-1' }));
    expect(loadReportDraft(OWNER)?.aiGenerationId).toBe('gen-1');
  });

  it('3軸対応前(targetFamilyMemberId/aiGenerationIdが無い)の古い控えも読める', () => {
    const key = `katahimo_report_draft_v1:${OWNER.tenantId}:${OWNER.staffId}`;
    const legacy = draftOf({ memoText: 'あ' }) as Partial<ReportDraft>;
    legacy.targetFamilyMemberId = undefined;
    legacy.aiGenerationId = undefined;
    localStorage.setItem(key, JSON.stringify(legacy));
    const loaded = loadReportDraft(OWNER);
    expect(loaded?.memoText).toBe('あ');
    expect(loaded?.targetFamilyMemberId).toBeNull();
    expect(loaded?.aiGenerationId).toBeNull();
  });

  it('3日より古い控えは、別の訪問の書きかけとみなして捨てる', () => {
    const old = Date.now() - 3 * 24 * 60 * 60 * 1000 - 1000;
    saveReportDraft(draftOf({ memoText: 'あ', savedAt: old }));
    expect(loadReportDraft(OWNER)).toBeNull();
  });

  it('壊れた控え(JSONでない・顧客IDが無い)は捨てる', () => {
    const key = `katahimo_report_draft_v1:${OWNER.tenantId}:${OWNER.staffId}`;
    localStorage.setItem(key, '{壊れている');
    expect(loadReportDraft(OWNER)).toBeNull();
    localStorage.setItem(key, JSON.stringify({ memoText: 'あ' }));
    expect(loadReportDraft(OWNER)).toBeNull();
  });

  it('別のスタッフがログインしている間は、前の利用者の控えを読まない', () => {
    saveReportDraft(draftOf({ memoText: '前の人の入力' }));
    const other: ReportDraftOwner = { tenantId: 'tenant-1', staffId: 'staff-2' };
    expect(loadReportDraft(other)).toBeNull();
    // 本人が戻れば読める(消したわけではない)。
    expect(loadReportDraft(OWNER)?.memoText).toBe('前の人の入力');
  });

  it('別のテナントの控えも読まない', () => {
    saveReportDraft(draftOf({ memoText: '別法人の入力' }));
    const other: ReportDraftOwner = { tenantId: 'tenant-2', staffId: 'staff-1' };
    expect(loadReportDraft(other)).toBeNull();
  });

  it('キーを書き換えて別人の控えを置いても、中身の持ち主が違えば読まない', () => {
    const other: ReportDraftOwner = { tenantId: 'tenant-2', staffId: 'staff-9' };
    const key = `katahimo_report_draft_v1:${other.tenantId}:${other.staffId}`;
    localStorage.setItem(key, JSON.stringify(draftOf({ memoText: 'なりすまし' })));
    expect(loadReportDraft(other)).toBeNull();
  });

  it('clearReportDraftで消える', () => {
    saveReportDraft(draftOf({ memoText: 'あ' }));
    clearReportDraft(OWNER);
    expect(loadReportDraft(OWNER)).toBeNull();
  });
});
