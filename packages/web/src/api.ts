export interface StaffView {
  staffId?: string;
  id?: string;
  tenantId: string;
  name: string;
  email: string;
  isAdmin: boolean;
}

export interface CustomerView {
  id: string;
  name: string;
  phone: string | null;
  city: string | null;
}

export interface FamilyMemberView {
  id: string;
  name: string;
  dob: string | null;
  info: string | null;
}

export interface CustomerDetailView {
  id: string;
  externalSource: string | null;
  externalId: string | null;
  name: string;
  familyNameKana: string | null;
  givenNameKana: string | null;
  email: string | null;
  phone: string | null;
  addressDetail: string | null;
  city: string | null;
  parkingArea: string | null;
  parkingDetail: string | null;
  emergencyContact: string | null;
  emergencyContactRelation: string | null;
  evacuationSite: string | null;
  memo: string | null;
  benefitMemberId: string | null;
  address2: string | null;
  address2StartDate: string | null;
  address2EndDate: string | null;
  latLng: string | null;
  memberType: string | null;
  memberStatus: string | null;
  paymentMethod: string | null;
  paymentStatus: string | null;
  gender: string | null;
  ageBracket: string | null;
  registeredAt: string | null;
  externalLastUpdatedAt: string | null;
  deactivatedAt: string | null;
  familyMembers: FamilyMemberView[];
}

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message = body && typeof body.message === 'string' ? body.message : `APIエラー: ${res.status}`;
    throw new Error(message);
  }
  return body as T;
}

export async function login(tenantSlug: string, email: string, password: string): Promise<StaffView> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ tenantSlug, email, password }),
  });
  const body = await parseJsonOrThrow<{ staff: StaffView }>(res);
  return body.staff;
}

export async function fetchMe(): Promise<StaffView | null> {
  const res = await fetch('/api/auth/me', { credentials: 'include' });
  if (res.status === 401) return null;
  const body = await parseJsonOrThrow<{ staff: StaffView }>(res);
  return body.staff;
}

export async function logout(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
}

export async function searchCustomersByFamilyName(familyName: string): Promise<CustomerView[]> {
  const res = await fetch(`/api/customers?familyName=${encodeURIComponent(familyName)}`, {
    credentials: 'include',
  });
  const body = await parseJsonOrThrow<{ customers: CustomerView[] }>(res);
  return body.customers;
}

export async function fetchCustomerDetail(customerId: string): Promise<CustomerDetailView> {
  const res = await fetch(`/api/customers/${encodeURIComponent(customerId)}`, { credentials: 'include' });
  const body = await parseJsonOrThrow<{ customer: CustomerDetailView }>(res);
  return body.customer;
}

/** 出勤簿テンプレートの入力列(PastSchedule.jsのPAST_SCHEDULE_INPUT_COLUMNSと同じ列記号)。 */
export interface AttendanceRowData {
  C?: string;
  D?: string;
  E?: string;
  H?: string;
  I?: string;
  L?: string;
  M?: string;
  N?: string;
  Q?: string;
  R?: string;
  U?: string;
  V?: string;
  W?: string;
  X?: string;
  Y?: string;
  Z?: string;
  AA?: string;
  AB?: string;
  AC?: string;
  AG?: string;
  AH?: string;
  AI?: string;
  AJ?: string;
  AN?: string;
  AO?: string;
}

export interface AttendanceDayDerived {
  leg1MoveStart: string;
  leg1MoveEnd: string;
  leg1WeatherAdjustedMoveMin: number | '';
  leg1WaitMin: number | '';
  leg2MoveStart: string;
  leg2MoveEnd: string;
  leg2WeatherAdjustedMoveMin: number | '';
  leg2WaitMin: number | '';
  laborMinutes: number;
  overtimeMinutes: number;
  totalMoveMin: number;
  totalDistanceKm: number;
  overThresholdCount: number;
  visitCount: number;
}

export interface AttendanceDayView {
  businessDate: string;
  rowData: AttendanceRowData;
  derived: AttendanceDayDerived;
}

export interface AttendanceMonthlyTotals {
  laborMinutes: number;
  overtimeMinutes: number;
  totalMoveMin: number;
  leg1DistanceKmTotal: number;
  leg2DistanceKmTotal: number;
  attendanceDistanceKmTotal: number;
  leavingDistanceKmTotal: number;
  totalDistanceKm: number;
  overThresholdCount: number;
  visitCountTotal: number;
  shoppingErrandTotal: number;
}

export interface AttendanceMonthView {
  yearMonth: string;
  days: AttendanceDayView[];
  totals: AttendanceMonthlyTotals;
}

export async function fetchAttendanceDay(date: string): Promise<AttendanceDayView> {
  const res = await fetch(`/api/attendance/day?date=${encodeURIComponent(date)}`, { credentials: 'include' });
  const body = await parseJsonOrThrow<{ attendance: AttendanceDayView }>(res);
  return body.attendance;
}

export async function saveAttendanceDay(
  date: string,
  rowData: AttendanceRowData,
): Promise<AttendanceDayView> {
  const res = await fetch('/api/attendance/day', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ date, rowData }),
  });
  const body = await parseJsonOrThrow<{ attendance: AttendanceDayView }>(res);
  return body.attendance;
}

export async function fetchAttendanceMonth(yearMonth: string): Promise<AttendanceMonthView> {
  const res = await fetch(`/api/attendance/month?month=${encodeURIComponent(yearMonth)}`, {
    credentials: 'include',
  });
  const body = await parseJsonOrThrow<{ month: AttendanceMonthView }>(res);
  return body.month;
}
