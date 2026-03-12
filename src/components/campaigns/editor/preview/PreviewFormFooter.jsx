export default function PreviewFormFooter({ currentDesign, onConsentOpen }) {
  return (
    <>
      {/* Submit Button */}
      <div className="pt-6">
        <div className="w-full h-12 flex items-center justify-center rounded-lg shadow-sm text-white font-medium text-base transition-all transform active:scale-[0.98]"
          style={{ backgroundColor: currentDesign.themeColor || '#111827', cursor: 'pointer' }}>
          {currentDesign.ctaText || 'Submit Application'}
        </div>
      </div>

      {/* Terms Footer */}
      <div className="pt-4 text-center">
        <p className="text-[10px] text-gray-400 leading-relaxed">
          By signing up, you agree to our{' '}
          <button type="button" onClick={onConsentOpen} className="text-blue-600 hover:underline">Terms & Conditions</button>.
        </p>
      </div>
    </>
  );
}
