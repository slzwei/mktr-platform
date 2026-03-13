import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardHeader, CardTitle, CardContent, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Upload, File, Download, AlertCircle, CheckCircle2 } from "lucide-react";
import { apiClient } from "@/api/client";
import { useToast } from "@/components/ui/use-toast";

const AdminApkManager = () => {
    const qc = useQueryClient();
    const [isUploading, setIsUploading] = useState(false);
    const [selectedFile, setSelectedFile] = useState(null);
    const { toast } = useToast();

    const { data: currentApk, isLoading } = useQuery({
        queryKey: ['apk', 'info'],
        queryFn: async () => {
            const data = await apiClient.get('/apk/list');
            return data.success ? data.apk : null;
        },
    });

    const handleFileChange = (e) => {
        const file = e.target.files[0];
        if (file && file.name.endsWith('.apk')) {
            setSelectedFile(file);
        } else {
            toast({
                title: "Invalid File",
                description: "Please select a valid .apk file.",
                variant: "destructive"
            });
            e.target.value = null;
        }
    };

    const handleUpload = async () => {
        if (!selectedFile) return;

        setIsUploading(true);
        const formData = new FormData();
        formData.append('file', selectedFile);

        try {
            await apiClient.upload('/apk/upload', formData);

            toast({
                title: "Success",
                description: "APK uploaded successfully.",
            });

            setSelectedFile(null);
            // reset file input
            const fileInput = document.getElementById('apk-upload');
            if (fileInput) fileInput.value = '';

            // Refresh list
            qc.invalidateQueries({ queryKey: ['apk', 'info'] });

        } catch (error) {
            console.error('Upload error:', error);
            toast({
                title: "Upload Failed",
                description: error.message || "Failed to upload APK.",
                variant: "destructive"
            });
        } finally {
            setIsUploading(false);
        }
    };

    const formatBytes = (bytes, decimals = 2) => {
        if (!+bytes) return '0 Bytes';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
    };

    return (
        <div className="container mx-auto p-6 max-w-4xl">
            <div className="mb-8">
                <h1 className="text-3xl font-bold tracking-tight text-gray-900 dark:text-gray-100">App Versions</h1>
                <p className="text-gray-500 dark:text-gray-400 mt-2">Manage the Android application package (APK) for the fleet.</p>
            </div>

            <div className="grid gap-6">
                {/* Current Version Card */}
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <File className="w-5 h-5 text-blue-600" />
                            Current Latest Version
                        </CardTitle>
                        <CardDescription>
                            The version currently being served at <code className="bg-gray-100 dark:bg-gray-700 px-1 py-0.5 rounded text-xs font-mono">/api/apk/latest</code>
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        {isLoading ? (
                            <div className="flex items-center justify-center py-8">
                                <Loader2 className="w-8 h-8 animate-spin text-blue-600 dark:text-blue-400" />
                            </div>
                        ) : currentApk ? (
                            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 p-4 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-700">
                                <div className="space-y-1">
                                    <div className="flex items-center gap-2">
                                        <span className="font-semibold text-gray-900 dark:text-gray-100">{currentApk.filename}</span>
                                        <span className="text-xs bg-green-100 dark:bg-green-950/30 text-green-700 dark:text-green-400 px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
                                            <CheckCircle2 className="w-3 h-3" /> Active
                                        </span>
                                    </div>
                                    <div className="text-sm text-gray-500 dark:text-gray-400 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                                        <span>Size: {formatBytes(currentApk.size)}</span>
                                        <span className="hidden sm:inline text-gray-300 dark:text-gray-600">|</span>
                                        <span>Uploaded: {new Date(currentApk.uploadedAt).toLocaleString()}</span>
                                    </div>
                                </div>
                                <Button asChild variant="outline" className="shrink-0 gap-2">
                                    <a href={`${import.meta.env.VITE_API_URL || 'http://localhost:3001/api'}/apk/latest`} download>
                                        <Download className="w-4 h-4" />
                                        Download
                                    </a>
                                </Button>
                            </div>
                        ) : (
                            <div className="flex flex-col items-center justify-center py-8 text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 rounded-lg border border-dashed border-gray-200 dark:border-gray-700">
                                <AlertCircle className="w-10 h-10 mb-2 text-gray-400 dark:text-gray-500" />
                                <p>No APK version uploaded yet.</p>
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Upload New Version Card */}
                <Card className="border-blue-100 dark:border-blue-900 shadow-sm">
                    <CardHeader className="bg-blue-50/50 dark:bg-blue-950/20 border-b border-blue-100 dark:border-blue-900">
                        <CardTitle className="text-blue-900 dark:text-blue-300 flex items-center gap-2">
                            <Upload className="w-5 h-5" />
                            Upload New Version
                        </CardTitle>
                        <CardDescription className="text-blue-700/80 dark:text-blue-400/80">
                            Uploading a new APK will <strong>replace</strong> the existing version immediately.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="pt-6">
                        <div className="grid w-full max-w-sm items-center gap-1.5 mb-4">
                            <Label htmlFor="apk-upload">APK File</Label>
                            <Input
                                id="apk-upload"
                                type="file"
                                accept=".apk"
                                onChange={handleFileChange}
                                disabled={isUploading}
                            />
                            <p className="text-xs text-gray-500 dark:text-gray-400">Only .apk files are allowed. Max size 200MB.</p>
                        </div>

                        {selectedFile && (
                            <div className="mb-4 p-3 bg-gray-50 dark:bg-gray-800 rounded text-sm text-gray-700 dark:text-gray-300 flex items-center justify-between">
                                <span>Selected: <strong>{selectedFile.name}</strong> ({formatBytes(selectedFile.size)})</span>
                            </div>
                        )}

                        <Button
                            onClick={handleUpload}
                            disabled={!selectedFile || isUploading}
                            className="w-full sm:w-auto"
                        >
                            {isUploading ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Uploading...
                                </>
                            ) : (
                                <>
                                    <Upload className="mr-2 h-4 w-4" />
                                    Upload & Publish
                                </>
                            )}
                        </Button>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
};

export default AdminApkManager;
