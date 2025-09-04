import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { auth } from '@/api/client';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function AcceptInvite() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get('token') || '';
  const emailFromLink = searchParams.get('email') || '';

  const [email, setEmail] = useState(emailFromLink);
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (emailFromLink) setEmail(emailFromLink);
  }, [emailFromLink]);

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!token) {
      setError('Missing invitation token');
      return;
    }
    if (!email) {
      setError('Email is required');
      return;
    }
    if (!password || password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    try {
      const resp = await auth.acceptInvite({ token, email, password, full_name: fullName });
      if (resp.success) {
        const role = resp?.data?.user?.role;
        if (role === 'admin') navigate('/AdminDashboard');
        else if (role === 'agent') navigate('/AgentDashboard');
        else navigate('/');
      }
    } catch (err) {
      setError(err.message || 'Failed to accept invite');
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="p-6">
          <h1 className="text-xl font-semibold">Accept Invitation</h1>
          <p className="text-sm text-gray-600">Create your password to activate your account.</p>
        </CardHeader>
        <CardContent className="p-6 pt-0">
          <form onSubmit={onSubmit} className="space-y-4">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="fullName">Full Name</Label>
              <Input id="fullName" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Your full name" />
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="confirm">Confirm Password</Label>
              <Input id="confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
            </div>
            {error && <div className="text-red-600 text-sm bg-red-50 p-2 rounded">{error}</div>}
            <Button type="submit" className="w-full bg-blue-600 hover:bg-blue-700" disabled={loading}>
              {loading ? 'Submitting…' : 'Accept Invitation'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

