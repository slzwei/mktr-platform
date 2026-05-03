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
 form,
 showPassword,
 setShowPassword,
 loading,
 onSubmit,
 children,
}) {
 const { register, formState: { errors } } = form;

 return (
 <TabsContent value="login" className="space-y-4">
 <form onSubmit={onSubmit} className="auth-form">
 <div className="form-group">
 <Label htmlFor="login-email" className="form-label">Email</Label>
 <div className="form-input">
 <Mail className="form-input-icon"/>
 <Input
 id="login-email" type="email" autoComplete="username" placeholder="Enter your email" {...register('email')}
 />
 </div>
 {errors.email && <p className="form-error">{errors.email.message}</p>}
 </div>

 <div className="form-group">
 <Label htmlFor="login-password" className="form-label">Password</Label>
 <div className="form-input">
 <Lock className="form-input-icon"/>
 <Input
 id="login-password" type={showPassword ? 'text' : 'password'}
 autoComplete="current-password" placeholder="Enter your password" {...register('password')}
 />
 <button
 type="button" onClick={() => setShowPassword(!showPassword)}
 className="form-input-toggle" >
 {showPassword ? <EyeOff className="w-4 h-4"/> : <Eye className="w-4 h-4"/>}
 </button>
 </div>
 {errors.password && <p className="form-error">{errors.password.message}</p>}
 </div>

 <Button
 type="submit" className="auth-button auth-button-primary" disabled={loading}
 >
 {loading ? (
 <>
 <Loader2 className="w-4 h-4 animate-spin"/>
 Signing In...
 </>
 ) : (
 <>
 Sign In
 <ArrowRight className="w-4 h-4"/>
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
