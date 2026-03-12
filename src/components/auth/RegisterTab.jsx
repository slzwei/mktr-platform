import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { TabsContent } from '@/components/ui/tabs';
import Mail from 'lucide-react/icons/mail';
import Lock from 'lucide-react/icons/lock';
import User from 'lucide-react/icons/user';
import Phone from 'lucide-react/icons/phone';
import Building from 'lucide-react/icons/building';
import Eye from 'lucide-react/icons/eye';
import EyeOff from 'lucide-react/icons/eye-off';
import Loader2 from 'lucide-react/icons/loader-2';
import ArrowRight from 'lucide-react/icons/arrow-right';

export default function RegisterTab({
  registerData,
  handleInputChange,
  showPassword,
  setShowPassword,
  showConfirmPassword,
  setShowConfirmPassword,
  loading,
  handleRegister,
}) {
  return (
    <TabsContent value="register" className="space-y-4">
      <form onSubmit={handleRegister} className="auth-form">
        <div className="form-group">
          <Label htmlFor="register-name" className="form-label">Full Name</Label>
          <div className="form-input">
            <User className="form-input-icon" />
            <Input
              id="register-name"
              type="text"
              placeholder="Enter your full name"
              value={registerData.full_name}
              onChange={(e) => handleInputChange('register', 'full_name', e.target.value)}
              required
            />
          </div>
        </div>

        <div className="form-group">
          <Label htmlFor="register-email" className="form-label">Email</Label>
          <div className="form-input">
            <Mail className="form-input-icon" />
            <Input
              id="register-email"
              type="email"
              autoComplete="email"
              placeholder="Enter your email"
              value={registerData.email}
              onChange={(e) => handleInputChange('register', 'email', e.target.value)}
              required
            />
          </div>
        </div>

        <div className="form-group">
          <Label htmlFor="register-phone" className="form-label">Phone Number</Label>
          <div className="form-input">
            <Phone className="form-input-icon" />
            <Input
              id="register-phone"
              type="tel"
              placeholder="Enter your phone number"
              value={registerData.phone}
              onChange={(e) => handleInputChange('register', 'phone', e.target.value)}
            />
          </div>
        </div>

        <div className="form-group">
          <Label htmlFor="register-company" className="form-label">Company Name (Optional)</Label>
          <div className="form-input">
            <Building className="form-input-icon" />
            <Input
              id="register-company"
              type="text"
              placeholder="Enter company name"
              value={registerData.company_name}
              onChange={(e) => handleInputChange('register', 'company_name', e.target.value)}
            />
          </div>
        </div>

        <div className="form-group">
          <Label htmlFor="register-role" className="form-label">Account Type</Label>
          <select
            id="register-role"
            value={registerData.role}
            onChange={(e) => handleInputChange('register', 'role', e.target.value)}
            className="form-select"
            required
          >
            <option value="customer">Customer</option>
            <option value="agent">Sales Agent</option>
            <option value="fleet_owner">Fleet Owner</option>
          </select>
        </div>

        <div className="form-group">
          <Label htmlFor="register-password" className="form-label">Password</Label>
          <div className="form-input">
            <Lock className="form-input-icon" />
            <Input
              id="register-password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="new-password"
              placeholder="Create a password"
              value={registerData.password}
              onChange={(e) => handleInputChange('register', 'password', e.target.value)}
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

        <div className="form-group">
          <Label htmlFor="register-confirm-password" className="form-label">Confirm Password</Label>
          <div className="form-input">
            <Lock className="form-input-icon" />
            <Input
              id="register-confirm-password"
              type={showConfirmPassword ? 'text' : 'password'}
              autoComplete="new-password"
              placeholder="Confirm your password"
              value={registerData.confirm_password}
              onChange={(e) => handleInputChange('register', 'confirm_password', e.target.value)}
              required
            />
            <button
              type="button"
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              className="form-input-toggle"
            >
              {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
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
              Creating Account...
            </>
          ) : (
            <>
              Create Account
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </Button>
      </form>
    </TabsContent>
  );
}
