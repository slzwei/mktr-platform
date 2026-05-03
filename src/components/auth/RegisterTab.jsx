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
 form,
 showPassword,
 setShowPassword,
 showConfirmPassword,
 setShowConfirmPassword,
 loading,
 onSubmit,
}) {
 const { register, formState: { errors } } = form;

 return (
 <TabsContent value="register" className="space-y-4">
 <form onSubmit={onSubmit} className="auth-form">
 <div className="form-group">
 <Label htmlFor="register-name" className="form-label">Full Name</Label>
 <div className="form-input">
 <User className="form-input-icon"/>
 <Input
 id="register-name" type="text" placeholder="Enter your full name" {...register('full_name')}
 />
 </div>
 {errors.full_name && <p className="form-error">{errors.full_name.message}</p>}
 </div>

 <div className="form-group">
 <Label htmlFor="register-email" className="form-label">Email</Label>
 <div className="form-input">
 <Mail className="form-input-icon"/>
 <Input
 id="register-email" type="email" autoComplete="email" placeholder="Enter your email" {...register('email')}
 />
 </div>
 {errors.email && <p className="form-error">{errors.email.message}</p>}
 </div>

 <div className="form-group">
 <Label htmlFor="register-phone" className="form-label">Phone Number</Label>
 <div className="form-input">
 <Phone className="form-input-icon"/>
 <Input
 id="register-phone" type="tel" placeholder="Enter your phone number" {...register('phone')}
 />
 </div>
 {errors.phone && <p className="form-error">{errors.phone.message}</p>}
 </div>

 <div className="form-group">
 <Label htmlFor="register-company" className="form-label">Company Name (Optional)</Label>
 <div className="form-input">
 <Building className="form-input-icon"/>
 <Input
 id="register-company" type="text" placeholder="Enter company name" {...register('company_name')}
 />
 </div>
 {errors.company_name && <p className="form-error">{errors.company_name.message}</p>}
 </div>

 <div className="form-group">
 <Label htmlFor="register-role" className="form-label">Account Type</Label>
 <select
 id="register-role" {...register('role')}
 className="form-select" >
 <option value="customer">Customer</option>
 <option value="agent">Sales Agent</option>
 <option value="fleet_owner">Fleet Owner</option>
 </select>
 {errors.role && <p className="form-error">{errors.role.message}</p>}
 </div>

 <div className="form-group">
 <Label htmlFor="register-password" className="form-label">Password</Label>
 <div className="form-input">
 <Lock className="form-input-icon"/>
 <Input
 id="register-password" type={showPassword ? 'text' : 'password'}
 autoComplete="new-password" placeholder="Create a password" {...register('password')}
 />
 <button
 type="button" onClick={() => setShowPassword(!showPassword)}
 className="form-input-toggle" >
 {showPassword ? <EyeOff className="w-4 h-4"/> : <Eye className="w-4 h-4"/>}
 </button>
 </div>
 {errors.password && <p className="form-error">{errors.password.message}</p>}
 </div>

 <div className="form-group">
 <Label htmlFor="register-confirm-password" className="form-label">Confirm Password</Label>
 <div className="form-input">
 <Lock className="form-input-icon"/>
 <Input
 id="register-confirm-password" type={showConfirmPassword ? 'text' : 'password'}
 autoComplete="new-password" placeholder="Confirm your password" {...register('confirm_password')}
 />
 <button
 type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)}
 className="form-input-toggle" >
 {showConfirmPassword ? <EyeOff className="w-4 h-4"/> : <Eye className="w-4 h-4"/>}
 </button>
 </div>
 {errors.confirm_password && <p className="form-error">{errors.confirm_password.message}</p>}
 </div>

 <Button
 type="submit" className="auth-button auth-button-primary" disabled={loading}
 >
 {loading ? (
 <>
 <Loader2 className="w-4 h-4 animate-spin"/>
 Creating Account...
 </>
 ) : (
 <>
 Create Account
 <ArrowRight className="w-4 h-4"/>
 </>
 )}
 </Button>
 </form>
 </TabsContent>
 );
}
