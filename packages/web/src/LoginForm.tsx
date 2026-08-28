import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import type { StaffView } from './api';
import { login } from './api';

export function LoginForm({ onLoggedIn }: { onLoggedIn: (staff: StaffView) => void }) {
  const [tenantSlug, setTenantSlug] = useState('demo');
  const [email, setEmail] = useState('admin@example.com');
  const [password, setPassword] = useState('');

  const mutation = useMutation({
    mutationFn: () => login(tenantSlug, email, password),
    onSuccess: onLoggedIn,
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate();
      }}
      style={{ display: 'grid', gap: '0.75rem', maxWidth: 320 }}
    >
      <label>
        法人ID(tenantSlug)
        <input value={tenantSlug} onChange={(e) => setTenantSlug(e.target.value)} required />
      </label>
      <label>
        メールアドレス
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <label>
        パスワード
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </label>
      <button type="submit" disabled={mutation.isPending}>
        {mutation.isPending ? 'ログイン中…' : 'ログイン'}
      </button>
      {mutation.isError && <p style={{ color: '#b91c1c' }}>{mutation.error.message}</p>}
    </form>
  );
}
