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
