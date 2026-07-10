import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { auth as authApi } from '@/api/client';
import { useAuthStore } from '@/stores/authStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RoPageHeader, RoAvatar, RoTag, roRoleLabel } from '@/components/redeemops/ui';

export default function ProfilePage() {
  const user = useAuthStore((s) => s.user);
  const refreshUser = useAuthStore((s) => s.refreshUser);

  const [form, setForm] = useState({
    firstName: user?.firstName || '',
    lastName: user?.lastName || '',
    phone: user?.phone || '',
  });
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });

  const displayName = [form.firstName, form.lastName].filter(Boolean).join(' ') || user?.email || 'Me';

  const profileMutation = useMutation({
    mutationFn: () => authApi.updateProfile({
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      ...(form.phone.trim() ? { phone: form.phone.trim() } : {}),
    }),
    onSuccess: async () => {
      toast.success('Profile updated');
      await refreshUser();
    },
    onError: (err) => toast.error('Could not update profile', { description: err.message }),
  });

  const passwordMutation = useMutation({
    mutationFn: () => authApi.changePassword(pw.current, pw.next),
    onSuccess: () => {
      toast.success('Password changed');
      setPw({ current: '', next: '', confirm: '' });
    },
    onError: (err) => toast.error('Could not change password', { description: err.message }),
  });

  const pwMismatch = pw.next.length > 0 && pw.confirm.length > 0 && pw.next !== pw.confirm;

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto space-y-6">
      <RoPageHeader title="Your profile" sub="How your name appears to the team, and your sign-in password." />

      <div className="rounded-2xl border border-border bg-white p-6">
        <div className="flex items-center gap-4 mb-6">
          <RoAvatar name={displayName} size={56} />
          <div className="min-w-0">
            <p className="text-lg font-bold m-0 truncate">{displayName}</p>
            <p className="text-[13px] m-0 truncate" style={{ color: 'var(--ro-text-2)' }}>{user?.email}</p>
          </div>
          <RoTag tone="primary" className="ml-auto shrink-0">{roRoleLabel(user)}</RoTag>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>First name</Label>
            <Input value={form.firstName} onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label>Last name</Label>
            <Input value={form.lastName} onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Phone</Label>
            <Input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder="+65 9123 4567" />
          </div>
        </div>
        <div className="mt-5">
          <Button
            disabled={!form.firstName.trim() || profileMutation.isPending}
            onClick={() => profileMutation.mutate()}
          >
            {profileMutation.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-white p-6">
        <p className="text-[15px] font-bold m-0 mb-1">Change password</p>
        <p className="text-[13px] m-0 mb-5" style={{ color: 'var(--ro-text-2)' }}>
          You'll stay signed in on this device.
        </p>
        <div className="grid sm:grid-cols-3 gap-4">
          <div className="space-y-1.5">
            <Label>Current password</Label>
            <Input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw((p) => ({ ...p, current: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label>New password</Label>
            <Input type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw((p) => ({ ...p, next: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label>Confirm new password</Label>
            <Input type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw((p) => ({ ...p, confirm: e.target.value }))} />
          </div>
        </div>
        {pwMismatch && (
          <p className="text-xs mt-2 m-0" style={{ color: 'var(--ro-tag-red-fg)' }}>Passwords don't match.</p>
        )}
        <div className="mt-5">
          <Button
            variant="outline"
            disabled={!pw.current || pw.next.length < 8 || pw.next !== pw.confirm || passwordMutation.isPending}
            onClick={() => passwordMutation.mutate()}
          >
            {passwordMutation.isPending ? 'Updating…' : 'Update password'}
          </Button>
          {pw.next.length > 0 && pw.next.length < 8 && (
            <span className="text-xs ml-3" style={{ color: 'var(--ro-text-3)' }}>At least 8 characters.</span>
          )}
        </div>
      </div>
    </div>
  );
}
