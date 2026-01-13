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
  const [phone, setPhone] = useState(''); // New phone state
  const [dateOfBirth, setDateOfBirth] = useState(''); // New DOB state
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(!!token); // Loading state for verification

  // Verify token and get user info on mount
  useEffect(() => {
    if (token) {
      const fetchInviteInfo = async () => {
        try {
          const info = await auth.getInviteInfo(token);
          if (info) {
            if (info.email) setEmail(info.email);
            if (info.fullName) setFullName(info.fullName);
            if (info.phone) setPhone(info.phone);
          }
        } catch (err) {
          console.error("Failed to verify invite token:", err);
          setError(err.message || "Invalid or expired invitation link.");
        } finally {
          setVerifying(false);
        }
      };
      fetchInviteInfo();
    } else {
      setVerifying(false);
    }
  }, [token]);

  useEffect(() => {
    if (emailFromLink && !email) setEmail(emailFromLink);
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
      const resp = await auth.acceptInvite({
        token,
        email,
        password,
        full_name: fullName,
        phone,
        dateOfBirth: dateOfBirth || undefined
      });
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

  if (verifying) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-pulse flex flex-col items-center">
          <div className="h-4 w-48 bg-gray-200 rounded mb-4"></div>
          <div className="h-2 w-32 bg-gray-200 rounded"></div>
        </div>
      </div>
    );
  }

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
              <Input
                id="email"
                type="email"
                value={email}
                className="bg-gray-100 text-gray-500 cursor-not-allowed"
                readOnly
                disabled
              />
            </div>
            <div>
              <Label htmlFor="fullName">Full Name</Label>
              <Input
                id="fullName"
                value={fullName}
                className="bg-gray-100 text-gray-500 cursor-not-allowed"
                readOnly
                disabled
              />
            </div>
            <div>
              <Label htmlFor="phone">Phone Number</Label>
              <Input
                id="phone"
                value={phone}
                className="bg-gray-100 text-gray-500 cursor-not-allowed"
                readOnly
                disabled
                placeholder="No phone number provided"
              />
            </div>

            <div>
              <Label htmlFor="dateOfBirth">Date of Birth <span className="text-gray-400 font-normal ml-1">(Optional)</span></Label>
              <Input
                id="dateOfBirth"
                type="date"
                value={dateOfBirth}
                onChange={(e) => setDateOfBirth(e.target.value)}
              />
            </div>

            <div className="pt-2 border-t border-gray-100 mt-4">
              <Label htmlFor="password">Create Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="confirm">Confirm Password</Label>
              <Input
                id="confirm"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                className="mt-1"
              />
            </div>

            {error && <div className="text-red-600 text-sm bg-red-50 p-2 rounded">{error}</div>}

            <Button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 mt-2" disabled={loading}>
              {loading ? 'Submitting…' : 'Accept Invitation'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

