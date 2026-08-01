import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import Loader2 from 'lucide-react/icons/loader-2';
import LogOut from 'lucide-react/icons/log-out';

// P0-2 (2026-07-30) closed self-serve onboarding (the wizard let any customer
// self-promote to 'agent'; agents now join via emailed invitations). P2-7
// deleted the wizard itself along with the retired driver/fleet programmes.
// The route stays because role='customer' accounts still land here.
export default function Onboarding() {
 const navigate = useNavigate();
 const refreshUser = useAuthStore((s) => s.refreshUser);
 const logout = useAuthStore((s) => s.logout);
 const [user, setUser] = useState(null);

 useEffect(() => {
 refreshUser().then(setUser).catch(() => setUser(null));
 }, []);

 if (!user) {
 return (
 <div className="min-h-screen flex items-center justify-center bg-foreground text-background">
 <Loader2 className="h-6 w-6 animate-spin mr-2"/> Loading...
 </div>
 );
 }

 return (
 <div data-testid="onboarding-closed" className="min-h-screen flex items-center justify-center bg-foreground text-background p-6">
 <Card className="w-full max-w-md">
 <CardHeader>
 <CardTitle>Onboarding is invitation-only</CardTitle>
 </CardHeader>
 <CardContent className="space-y-4">
 <p className="text-sm text-muted-foreground">
 Self-serve onboarding has closed. MKTR agents join through a personal
 invitation — if you are expecting one, use the link in your invitation
 email. Signed up out of interest? We&apos;ll be in touch.
 </p>
 <div className="flex gap-2">
 <Button asChild variant="outline">
 <Link to="/">Back to home</Link>
 </Button>
 <Button variant="ghost" onClick={() => { logout(); navigate('/'); }}>
 <LogOut className="h-4 w-4 mr-2"/> Sign out
 </Button>
 </div>
 </CardContent>
 </Card>
 </div>
 );
}
