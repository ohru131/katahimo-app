import type { CreateCustomerInput } from '@katahimo/core/usecases';
import type { ReservaCsvRow } from './types';

export const RESERVA_EXTERNAL_SOURCE = 'reserva';

function orUndefined(value: string): string | undefined {
  return value ? value : undefined;
}

/**
 * RESERVA CSVの1行を、顧客登録/更新ユースケースの入力に変換する。
 * 姓・名はCSVで既に分割済みの値をそのまま使う(氏名文字列からの再分割よりも確実なため、
 * packages/core/src/usecases/customers.ts のfamilyName/givenName優先の仕組みを使う)。
 * 世帯構成員(子ども等)もそのまま渡し、一切省略しない。
 */
export function mapReservaRowToCustomerInput(tenantId: string, row: ReservaCsvRow): CreateCustomerInput {
  return {
    tenantId,
    name: `${row.familyName} ${row.givenName}`.trim(),
    familyName: row.familyName,
    givenName: row.givenName,
    externalSource: RESERVA_EXTERNAL_SOURCE,
    externalId: row.customerId,
    familyNameKana: orUndefined(row.familyNameKana),
    givenNameKana: orUndefined(row.givenNameKana),
    email: orUndefined(row.email),
    phone: orUndefined(row.phone),
    addressDetail: orUndefined(row.address),
    // city(市区町村)は住所文字列からの自動抽出をしない(信頼できるパーサーが無いため対象外。
    // 必要なら別途アドレス管理者が手動で設定する運用とする)。
    parkingArea: orUndefined(row.parkingArea),
    parkingDetail: orUndefined(row.parkingDetail),
    emergencyContact: orUndefined(row.emergencyContact),
    emergencyContactRelation: orUndefined(row.emergencyContactRelation),
    evacuationSite: orUndefined(row.evacuationSite),
    memo: orUndefined(row.memo),
    benefitMemberId: orUndefined(row.benefitMemberId),
    address2: orUndefined(row.address2),
    address2StartDate: orUndefined(row.address2StartDate),
    address2EndDate: orUndefined(row.address2EndDate),
    latLng: orUndefined(row.latLng),
    memberType: orUndefined(row.memberType),
    memberStatus: orUndefined(row.memberStatus),
    paymentMethod: orUndefined(row.paymentMethod),
    paymentStatus: orUndefined(row.paymentStatus),
    gender: orUndefined(row.gender),
    ageBracket: orUndefined(row.ageBracket),
    registeredAt: row.registeredAt ? new Date(row.registeredAt) : undefined,
    externalLastUpdatedAt: row.externalLastUpdatedAt ? new Date(row.externalLastUpdatedAt) : undefined,
    familyMembers: row.familyMembers.map((m) => ({
      name: m.name,
      dob: orUndefined(m.dob),
      info: orUndefined(m.info),
    })),
  };
}
