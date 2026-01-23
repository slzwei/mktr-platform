import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import DashboardLayout from '@/components/layout/DashboardLayout';

import { apiClient as api } from '@/api/client';


export default function ProvisionDevice() {
    const { code } = useParams();
    const navigate = useNavigate();


    // State
    const [status, setStatus] = useState('checking'); // checking, valid, expired, fulfilled, not_found
    const [deviceKey, setDeviceKey] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState(null);
    const [success, setSuccess] = useState(false);

    // 1. Validate Session on Mount
    useEffect(() => {
        const checkSession = async () => {
            try {
                // We reuse the polling endpoint to check status
                // Since this is admin-side, creating a specific admin check endpoint might be cleaner,
                // but for now, reusing the polling endpoint is fine as it returns status.
                // However, the poll endpoint is unauthenticated. Ideally we should have an admin endpoint.
                // But typically admins just submit. If it fails, it fails.
                // Let's just assume valid if UUID format is correct for now, or fetch checks.

                // Let's try to "peek" at the session.
                // Actually, let's just show the form. If invalid, the POST will fail.
                setStatus('valid');
            } catch (err) {
                console.error(err);
                setStatus('error');
            }
        };
        checkSession();
    }, [code]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError(null);
        setSubmitting(true);

        try {
            await api.post('/provision/fulfill', {
                sessionCode: code,
                deviceKey
            });
            setSuccess(true);
            setTimeout(() => {
                navigate('/admin/fleet');
            }, 3000);
        } catch (err) {
            console.error(err);
            setError(err.response?.data?.message || 'Failed to provision device.');
        } finally {
            setSubmitting(false);
        }
    };

    if (success) {
        return (
            <DashboardLayout>
                <div className="flex items-center justify-center min-h-[60vh]">
                    <Card className="w-full max-w-md border-green-200 bg-green-50">
                        <CardContent className="pt-6 text-center">
                            <CheckCircle2 className="mx-auto h-12 w-12 text-green-600 mb-4" />
                            <h2 className="text-2xl font-bold text-green-800 mb-2">Provisioning Successful!</h2>
                            <p className="text-green-700">The tablet should automatically log in now.</p>
                        </CardContent>
                    </Card>
                </div>
            </DashboardLayout>
        );
    }

    return (
        <DashboardLayout>
            <div className="flex flex-col items-center justify-center min-h-[60vh] p-4">
                <Card className="w-full max-w-md">
                    <CardHeader>
                        <CardTitle>Provision Tablet</CardTitle>
                        <CardDescription>Enter the Device Key for the tablet you scanned.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="mb-6 p-4 bg-muted/50 rounded-lg text-sm font-mono text-center break-all">
                            Session: {code}
                        </div>

                        {error && (
                            <Alert variant="destructive" className="mb-6">
                                <AlertCircle className="h-4 w-4" />
                                <AlertTitle>Error</AlertTitle>
                                <AlertDescription>{error}</AlertDescription>
                            </Alert>
                        )}

                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div className="space-y-2">
                                <label className="text-sm font-medium">Device Key</label>
                                <Input
                                    placeholder="e.g. tablet-123-sec-key"
                                    value={deviceKey}
                                    onChange={(e) => setDeviceKey(e.target.value)}
                                    required
                                    autoFocus
                                />
                                <p className="text-xs text-muted-foreground">
                                    You can find this key in the admin dashboard under Device details.
                                </p>
                            </div>

                            <Button
                                type="submit"
                                className="w-full"
                                disabled={submitting || !deviceKey.trim()}
                            >
                                {submitting ? (
                                    <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        Provisioning...
                                    </>
                                ) : 'Link Device'}
                            </Button>
                        </form>
                    </CardContent>
                </Card>
            </div>
        </DashboardLayout>
    );
}
