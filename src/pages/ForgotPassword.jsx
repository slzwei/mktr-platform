import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { apiClient } from "@/api/client";
import { ArrowLeft, AlertCircle, CheckCircle } from "lucide-react";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");

    try {
      if (!email) {
        setError("Please enter your email");
        return;
      }

      const response = await apiClient.post("/auth/forgot-password", { email });
      if (response?.success) {
        setMessage("If the email exists, a reset link has been sent.");
      } else {
        setMessage("If the email exists, a reset link has been sent.");
      }
    } catch (err) {
      setMessage("If the email exists, a reset link has been sent.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="absolute top-6 left-6 z-10">
        <Link to={createPageUrl("CustomerLogin")}>
          <Button variant="outline" className="gap-2 border-zinc-700 text-zinc-200 hover:bg-zinc-900">
            <ArrowLeft className="w-4 h-4" />
            Back to Login
          </Button>
        </Link>
      </div>

      <div className="flex items-center justify-center min-h-screen py-12 px-4">
        <div className="w-full max-w-md">
          <Card className="bg-zinc-900 border-zinc-800 text-white shadow-2xl">
            <CardHeader className="text-center pb-2">
              <CardTitle className="text-2xl font-bold">Forgot password</CardTitle>
              <p className="text-sm text-zinc-400 mt-1">Enter your email to receive a reset link</p>
            </CardHeader>
            <CardContent className="space-y-4">
              {error && (
                <div className="flex items-center gap-2 p-3 bg-red-500/10 text-red-400 rounded-lg border border-red-900">
                  <AlertCircle className="w-4 h-4" />
                  <span className="text-sm">{error}</span>
                </div>
              )}

              {message && (
                <div className="flex items-center gap-2 p-3 bg-emerald-500/10 text-emerald-400 rounded-lg border border-emerald-900">
                  <CheckCircle className="w-4 h-4" />
                  <span className="text-sm">{message}</span>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <label htmlFor="email" className="text-sm font-medium text-zinc-300">Email</label>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="username"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    required
                    className="bg-zinc-800 border-zinc-700 text-white placeholder:text-zinc-400"
                  />
                </div>

                <Button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-white text-black hover:bg-zinc-200"
                  size="lg"
                >
                  {loading ? "Sending..." : "Send Reset Link"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}


