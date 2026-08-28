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
