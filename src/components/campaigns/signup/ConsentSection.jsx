
import MarketingConsentDialog from "@/components/legal/MarketingConsentDialog";

export default function ConsentSection({ consentOpen, setConsentOpen, termsContent }) {
    return (
        <>
            <p className="text-[11px] text-gray-400 text-center mt-3 mb-1">
                By signing up, you agree to our{' '}
                <button
                    type="button"
                    onClick={() => setConsentOpen(true)}
                    className="text-gray-600 font-medium hover:underline hover:text-gray-900 transition-colors"
                >
                    Terms & Conditions
                </button>
            </p>

            <MarketingConsentDialog open={consentOpen} onOpenChange={setConsentOpen} content={termsContent} />
        </>
    );
}
