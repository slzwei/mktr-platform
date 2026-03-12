import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TabsContent } from '@/components/ui/tabs';
import Mail from 'lucide-react/icons/mail';
import Lock from 'lucide-react/icons/lock';
import Eye from 'lucide-react/icons/eye';
import EyeOff from 'lucide-react/icons/eye-off';
import Loader2 from 'lucide-react/icons/loader-2';
import ArrowRight from 'lucide-react/icons/arrow-right';

export default function LoginTab({
  loginData,
  handleInputChange,
  showPassword,
  setShowPassword,
  loading,
  handleLogin,
  children,
}) {
  return (
    <TabsContent value="login" className="space-y-4">
      <form onSubmit={handleLogin} className="auth-form">
        <div className="form-group">
          <Label htmlFor="login-email" className="form-label">Email</Label>
          <div className="form-input">
            <Mail className="form-input-icon" />
            <Input
              id="login-email"
              type="email"
              autoComplete="username"
              placeholder="Enter your email"
              value={loginData.email}
              onChange={(e) => handleInputChange('login', 'email', e.target.value)}
              required
            />
          </div>
        </div>

        <div className="form-group">
          <Label htmlFor="login-password" className="form-label">Password</Label>
          <div className="form-input">
            <Lock className="form-input-icon" />
            <Input
              id="login-password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              placeholder="Enter your password"
              value={loginData.password}
              onChange={(e) => handleInputChange('login', 'password', e.target.value)}
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="form-input-toggle"
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        <Button
          type="submit"
          className="auth-button auth-button-primary"
          disabled={loading}
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Signing In...
            </>
          ) : (
            <>
              Sign In
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </Button>
      </form>

      <div className="auth-divider">
        <span>OR</span>
      </div>

      {/* Google Sign-in Button Container - passed from parent */}
      {children}
    </TabsContent>
  );
}
