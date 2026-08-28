import type { Database } from '@katahimo/db';
import {
  DrizzleAttendanceDayRepository,
  DrizzleCustomerRepository,
  DrizzleFamilyMemberRepository,
  DrizzleSessionRepository,
  DrizzleStaffRepository,
  DrizzleTenantRepository,
} from '@katahimo/db/repositories';
import { LocalBlindIndexPort, LocalCryptoPort } from '@katahimo/integrations';
import { argon2PasswordHasher } from './authAdapters';
import type { Env } from './env';

/** ルートハンドラに配る依存一式。usecases(@katahimo/core)にそのまま渡す形。 */
export interface Container {
  tenants: DrizzleTenantRepository;
  staff: DrizzleStaffRepository;
  sessions: DrizzleSessionRepository;
  customers: DrizzleCustomerRepository;
  familyMembers: DrizzleFamilyMemberRepository;
  attendanceDays: DrizzleAttendanceDayRepository;
  crypto: LocalCryptoPort;
  blindIndex: LocalBlindIndexPort;
  passwordHasher: typeof argon2PasswordHasher;
}

export function createContainer(env: Env, db: Database): Container {
  return {
    tenants: new DrizzleTenantRepository(db),
    staff: new DrizzleStaffRepository(db),
    sessions: new DrizzleSessionRepository(db),
    customers: new DrizzleCustomerRepository(db),
    familyMembers: new DrizzleFamilyMemberRepository(db),
    attendanceDays: new DrizzleAttendanceDayRepository(db),
    crypto: new LocalCryptoPort(env.LOCAL_DEV_MASTER_KEY),
    blindIndex: new LocalBlindIndexPort(env.LOCAL_DEV_MASTER_KEY),
    passwordHasher: argon2PasswordHasher,
  };
}
