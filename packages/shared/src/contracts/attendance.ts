import { z } from 'zod';

/**
 * 出勤簿(勤怠)1日分のrow_data(jsonb)の形。doc/14 §2「勤怠row_dataを意味のあるキー・
 * 数値にする」の段階1。スプレッドシートの列記号(C/D/E…)ではなく意味のあるキーにし、
 * 分・km・件数はnumberにする(時刻だけは"HH:mm"文字列のまま。business_dateと組み合わせれば
 * 日時が一意に決まり、日跨ぎ勤務もend<startで表現できるため timestamptz にする必要が無い)。
 *
 * ここがapi/webの両方から参照できる唯一の場所になることで、「どの形が正しいか」が
 * スキーマとして1か所に書かれる状態にする(doc/14 §2の狙い)。
 */

/**
 * 出勤簿の時刻文字列。packages/core/src/domain/attendance/attendanceCalc.ts の
 * parseTimeToMinutesが受け付ける形式(`^(\d{1,2}):(\d{2})$`、1桁時も許可・範囲外でも
 * 形式さえ合えば通す)にそのまま合わせている。
 *
 * shared/contracts/common.ts の timeOfDaySchema は "09:00" のような2桁固定・0-23時までの
 * 厳密な検証だが、ここでそれを使うと既存のGAS版実データ・attendanceCalc.test.tsの
 * 「不正な時刻文字列(範囲外)は形式チェックだけ通り、24時間モジュロで丸められる」ケースを
 * そのまま受け付けられなくなる(fromColumnRowで持ち上げた値がスキーマ検証に落ちてしまう)。
 * 勤怠計算側の実際の緩さに合わせて、あえて緩いスキーマにしている。
 */
export const attendanceTimeSchema = z
  .string()
  .regex(/^\d{1,2}:\d{2}$/, 'HH:mm形式で指定してください(1桁時も可)');

/** 分・距離等の非負数値。文字列だった頃は負数の検証すら無かった項目。 */
const nonNegativeNumberSchema = z.number().nonnegative('0以上の数値にしてください');
/** 件数(買物代行の回数)は非負の整数。 */
const nonNegativeIntSchema = z.number().int('整数にしてください').nonnegative('0以上の数値にしてください');

/**
 * 訪問1件。plannedMoveMin/distanceKm/weatherAfterは「この訪問のあとの移動」を指す
 * (元の列記号でいうH/AG/Iが#1→#2の移動を表していたのと同じ意味。したがって配列の最後の
 * 訪問には意味を持たない項目になる。この非対称性は勤怠計算attendanceCalc.tsが
 * #1→#2・#2→#3の2区間しか計算しない、というGAS版由来の制約をそのまま引き継いだもの)。
 */
export const attendanceVisitSchema = z
  .object({
    place: z.string().optional(),
    start: attendanceTimeSchema.optional(),
    end: attendanceTimeSchema.optional(),
    weatherAfter: z.string().optional(),
    plannedMoveMin: nonNegativeNumberSchema.optional(),
    distanceKm: nonNegativeNumberSchema.optional(),
  })
  // 宣言済みのフィールドしか送られない設計(row_dataは常にこのスキーマを通してから書き込む)
  // なので、未知のキーは黙って捨てずに拒否する。捨てると「送ったつもりの値が実は
  // 保存されていない」という気付きにくい不具合を生む。
  .strict();
export type AttendanceVisit = z.infer<typeof attendanceVisitSchema>;

/** 事務作業1件。 */
export const attendanceOfficeWorkSchema = z
  .object({
    name: z.string().optional(),
    start: attendanceTimeSchema.optional(),
    end: attendanceTimeSchema.optional(),
  })
  .strict();
export type AttendanceOfficeWork = z.infer<typeof attendanceOfficeWorkSchema>;

/**
 * 勤怠計算(packages/core/src/domain/attendance/attendanceCalc.ts)が対応できる上限
 * (訪問3件・事務作業2件)。GAS版との数値一致を19ケースで検証済みの計算ロジックを
 * 段階1では変更しない、というdoc/14 §2の判断に基づく。
 *
 * データ構造(このファイルのスキーマ・jsonbの中身・TypeScriptの型)自体には上限を
 * 持たせない――「スプレッドシートの列レイアウトがデータモデルの制約に化けている」状態を
 * 解消するのが配列化の目的そのものであるため。上限は代わりにアプリの入口(API、
 * packages/api/src/routes/attendance.ts)で明示的にチェックし、超える入力は400で拒否する。
 * 黙って4件目以降を捨てると、給与に直結する値が気付かれないまま失われるのでそれは避ける。
 * 4件以上を正しく扱えるようにするのは、attendance_segmentsへ正規化する段階2の仕事。
 */
export const MAX_VISITS = 3;
export const MAX_OFFICE_WORK = 2;

/**
 * 移動列(weatherAfter/plannedMoveMin/distanceKm)が存在する訪問の件数。GAS版のスプレッドシートは
 * #1→#2・#2→#3の2区間ぶんの移動列(H/I/AG、Q/R/AH相当)しか持たず、attendanceCalc.tsもこの
 * 2区間しか計算しない。3件目(index 2)以降の訪問には対応する移動列がそもそも存在しないため、
 * これらの項目を入力されてもtoColumnRow()が表現する場所を持たない。「対応する列が無い」を
 * データの形として先に拒否しておかないと、黙って捨てて給与に関わるdistanceKmが気付かれずに
 * 失われる(columnRow.tsのtoColumnRow参照)。
 */
export const MAX_MOVE_LEGS = 2;

/** 出勤簿1日分。 */
export const attendanceRowDataSchema = z
  .object({
    visits: z.array(attendanceVisitSchema).optional(),
    officeWork: z.array(attendanceOfficeWorkSchema).optional(),
    /** 出勤距離(自宅→#1、km)。 */
    commuteDistanceKm: nonNegativeNumberSchema.optional(),
    /** 退勤距離(最後の訪問→自宅、km)。 */
    returnDistanceKm: nonNegativeNumberSchema.optional(),
    shoppingErrandCount: nonNegativeIntSchema.optional(),
    note: z.string().optional(),
  })
  // 宣言済みのフィールドしか送られない設計なので、未知のキーは拒否する(理由はattendanceVisitSchema
  // 参照)。
  .strict()
  .superRefine((data, ctx) => {
    // MAX_MOVE_LEGS件目以降(index >= MAX_MOVE_LEGS)の訪問に「あとの移動」の項目が
    // 入っていたら、toColumnRowが表現する場所を持たず黙って捨ててしまう。どの添字の
    // どのフィールドが問題かクライアントに伝わるよう、pathを付けて個別にエラーにする。
    const moveFields = ['weatherAfter', 'plannedMoveMin', 'distanceKm'] as const;
    data.visits?.forEach((visit, index) => {
      if (index < MAX_MOVE_LEGS) return;
      for (const field of moveFields) {
        if (visit[field] !== undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['visits', index, field],
            message:
              `${index + 1}件目の訪問には対応する移動列が無いため${field}を指定できません` +
              `(移動列があるのは${MAX_MOVE_LEGS}件目までです)`,
          });
        }
      }
    });
  });
export type AttendanceRowData = z.infer<typeof attendanceRowDataSchema>;
