export default function PreviewFormFooter({ currentDesign, onConsentOpen }) {
 return (
 <>
 {/* Submit Button */}
 <div className="pt-6">
 <div className="w-full h-12 flex items-center justify-center rounded-lg shadow-sm text-background font-medium text-base transition-colors transform active:scale-[0.98]" style={{ backgroundColor: currentDesign.themeColor || '#111827', cursor: 'pointer' }}>
 {currentDesign.ctaText || 'Submit Application'}
 </div>
 </div>

 {/* Terms Footer */}
 <div className="pt-4 text-center">
 <p className="text-[10px] text-muted-foreground leading-relaxed">
 By signing up, you agree to our{' '}
 <button type="button" onClick={onConsentOpen} className="text-primary hover:underline">Terms & Conditions</button>.
 </p>
 </div>
 </>
 );
}
