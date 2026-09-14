import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearReportDraft, loadReportDraft, type ReportDraft, saveReportDraft } from './reportDraft';

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

function draftOf(patch: Partial<ReportDraft> = {}): ReportDraft {
  return {
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
    riskRating: null,
    esRating: null,
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
    expect(loadReportDraft()?.memoText).toBe('公園で30分あそびました');
  });

  it('1文字も入力が無い状態は控えを残さない(「書きかけがあります」と誤って出さないため)', () => {
    saveReportDraft(draftOf());
    expect(loadReportDraft()).toBeNull();
  });

  it('入力を消して保存し直すと、残っていた控えも消える', () => {
    saveReportDraft(draftOf({ memoText: 'あ' }));
    saveReportDraft(draftOf({ memoText: '' }));
    expect(loadReportDraft()).toBeNull();
  });

  it('事故報告側だけに入力があっても控えを残す', () => {
    saveReportDraft(draftOf({ mode: 'accident', accident: { ...draftOf().accident, location: '玄関' } }));
    expect(loadReportDraft()?.accident.location).toBe('玄関');
  });

  it('評価だけを付けた状態も「入力あり」として扱う', () => {
    saveReportDraft(draftOf({ riskRating: 3 }));
    expect(loadReportDraft()?.riskRating).toBe(3);
  });

  it('3日より古い控えは、別の訪問の書きかけとみなして捨てる', () => {
    const old = Date.now() - 3 * 24 * 60 * 60 * 1000 - 1000;
    saveReportDraft(draftOf({ memoText: 'あ', savedAt: old }));
    expect(loadReportDraft()).toBeNull();
  });

  it('壊れた控え(JSONでない・顧客IDが無い)は捨てる', () => {
    localStorage.setItem('katahimo_report_draft_v1', '{壊れている');
    expect(loadReportDraft()).toBeNull();
    localStorage.setItem('katahimo_report_draft_v1', JSON.stringify({ memoText: 'あ' }));
    expect(loadReportDraft()).toBeNull();
  });

  it('clearReportDraftで消える', () => {
    saveReportDraft(draftOf({ memoText: 'あ' }));
    clearReportDraft();
    expect(loadReportDraft()).toBeNull();
  });
});
