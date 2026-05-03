
import MarketingConsentDialog from"@/components/legal/MarketingConsentDialog";

export default function ConsentSection({ consentOpen, setConsentOpen, termsContent }) {
 return (
 <>
 <p className="text-[11px] text-muted-foreground text-center mt-3 mb-1">
 By signing up, you agree to our{' '}
 <button
 type="button" onClick={() => setConsentOpen(true)}
 className="text-muted-foreground font-medium hover:underline hover:text-foreground transition-colors" >
 Terms & Conditions
 </button>
 </p>

 <MarketingConsentDialog open={consentOpen} onOpenChange={setConsentOpen} content={termsContent} />
 </>
 );
}
