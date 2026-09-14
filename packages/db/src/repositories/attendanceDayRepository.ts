import type { AttendanceRowData } from '@katahimo/core/domain';
import type {
  AttendanceDayRecord,
  AttendanceDayRepositoryPort,
  TransactionScope,
} from '@katahimo/core/ports';
import { and, eq, gte, lt, lte, sql } from 'drizzle-orm';
import { attendanceDays } from '../schema';
import type { Database, DatabaseTransaction } from '../tenantScope';
import { withTenant } from '../tenantScope';

type AttendanceDayRow = typeof attendanceDays.$inferSelect;

/**
 * (テナント・スタッフ・営業日)ごとのトランザクション内 advisory lock を取る。
 *
 * row_dataは「丸ごと置き換え」なので、カレンダー反映は「読んで → 突き合わせて → 書き戻す」の
 * 形になる。行ロック(`SELECT ... FOR UPDATE`)だけでは**まだ行が無い日**を直列化できない
 * ――返る行が無ければロックする対象も無く、その隙に手入力の保存が同じ日を新規作成すると、
 * こちらの upsert が `ON CONFLICT DO UPDATE` に落ちて、空行を土台に作ったマージ結果で
 * その手入力を上書きしてしまう(非破壊マージは相手の内容を見ていないので守りにならない)。
 * 過去1か月を一括反映するときは「行がまだ無い日」の方が多いので、これは稀な経路ではない。
 *
 * そこで行の有無に関わらず効くキー(テナント・スタッフ・営業日)でadvisory lockを取る。
 * 勤怠の書き込み経路(このリポジトリの upsert と findByStaffAndDateForUpdate)は全て同じキーで
 * 先にこれを取るので、同じ日への書き込みは必ず直列になる。トランザクション終了で自動的に
 * 解放されるため、明示的な解放は要らない。
 *
 * ハッシュが衝突すると無関係な日どうしが直列化されるが、待たされるだけで結果は変わらない。
 */
async function lockAttendanceDay(
  tx: DatabaseTransaction,
  tenantId: string,
  staffId: string,
  businessDate: string,
): Promise<void> {
  const key = `attendance_day:${tenantId}:${staffId}:${businessDate}`;
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
}

/** DrizzleのattendanceDaysテーブルのSELECT結果行を、ポート層のAttendanceDayRecordに変換する。 */
function toRecord(row: AttendanceDayRow): AttendanceDayRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    staffId: row.staffId,
    businessDate: row.businessDate,
    rowData: row.rowData,
    updatedAt: row.updatedAt,
  };
}

/** 'YYYY-MM' から、その月の [開始日, 翌月開始日) の範囲を返す(月末日数を気にせず済むように)。 */
function monthRange(yearMonth: string): { start: string; nextMonthStart: string } {
  const [yearStr, monthStr] = yearMonth.split('-');
  const year = Number(yearStr);
  const month = Number(monthStr);
  const start = `${yearMonth}-01`;
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonthStart = `${nextYear}-${String(nextMonth).padStart(2, '0')}-01`;
  return { start, nextMonthStart };
}

export class DrizzleAttendanceDayRepository implements AttendanceDayRepositoryPort {
  constructor(private readonly db: Database) {}

  async findByStaffAndDate(
    tenantId: string,
    staffId: string,
    businessDate: string,
  ): Promise<AttendanceDayRecord | null> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(attendanceDays)
        .where(and(eq(attendanceDays.staffId, staffId), eq(attendanceDays.businessDate, businessDate)))
        .limit(1);
      const row = rows[0];
      return row ? toRecord(row) : null;
    });
  }

  async findByStaffAndDateForUpdate(
    tenantId: string,
    staffId: string,
    businessDate: string,
    scope: TransactionScope,
  ): Promise<AttendanceDayRecord | null> {
    return withTenant(
      this.db,
      tenantId,
      async (tx) => {
        // 行がまだ無い日も直列化するため、行ロックより先にadvisory lockを取る
        // (lockAttendanceDayのコメント参照)。
        await lockAttendanceDay(tx, tenantId, staffId, businessDate);
        const rows = await tx
          .select()
          .from(attendanceDays)
          .where(and(eq(attendanceDays.staffId, staffId), eq(attendanceDays.businessDate, businessDate)))
          .limit(1)
          // 既にある行はこちらでも押さえておく(advisory lockを取らない経路が将来増えても、
          // 行があるケースだけは守られる)。
          .for('update');
        const row = rows[0];
        return row ? toRecord(row) : null;
      },
      scope,
    );
  }

  async findById(tenantId: string, id: string): Promise<AttendanceDayRecord | null> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx.select().from(attendanceDays).where(eq(attendanceDays.id, id)).limit(1);
      const row = rows[0];
      return row ? toRecord(row) : null;
    });
  }

  async upsert(
    tenantId: string,
    staffId: string,
    businessDate: string,
    rowData: AttendanceRowData,
    scope?: TransactionScope,
  ): Promise<AttendanceDayRecord> {
    return withTenant(
      this.db,
      tenantId,
      async (tx) => {
        // 読み直してから書き戻す経路(カレンダー反映)と同じキーで直列化する。
        // 手入力の保存はこの行を読まずに丸ごと置き換えるので、こちらが先にロックを取れば
        // カレンダー反映は「手入力が入ったあとの内容」を読んでから突き合わせることになる。
        await lockAttendanceDay(tx, tenantId, staffId, businessDate);
        const rows = await tx
          .insert(attendanceDays)
          .values({
            tenantId,
            staffId,
            businessDate,
            rowData,
          })
          .onConflictDoUpdate({
            target: [attendanceDays.tenantId, attendanceDays.staffId, attendanceDays.businessDate],
            set: {
              rowData,
              updatedAt: new Date(),
            },
          })
          .returning();
        const row = rows[0];
        if (!row) throw new Error('勤怠データの保存に失敗しました');
        return toRecord(row);
      },
      scope,
    );
  }

  async listByStaffAndMonth(
    tenantId: string,
    staffId: string,
    yearMonth: string,
  ): Promise<AttendanceDayRecord[]> {
    const { start, nextMonthStart } = monthRange(yearMonth);
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(attendanceDays)
        .where(
          and(
            eq(attendanceDays.staffId, staffId),
            gte(attendanceDays.businessDate, start),
            lt(attendanceDays.businessDate, nextMonthStart),
          ),
        );
      return rows.map(toRecord);
    });
  }

  async listByStaffAndDateRange(
    tenantId: string,
    staffId: string,
    startDate: string,
    endDate: string,
  ): Promise<AttendanceDayRecord[]> {
    return withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(attendanceDays)
        .where(
          and(
            eq(attendanceDays.staffId, staffId),
            gte(attendanceDays.businessDate, startDate),
            lte(attendanceDays.businessDate, endDate),
          ),
        );
      return rows.map(toRecord);
    });
  }
}
