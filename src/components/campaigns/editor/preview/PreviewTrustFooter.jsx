export default function PreviewTrustFooter() {
  return (
    <div className="mt-8 text-center w-full max-w-[375px]">
      <div className="flex items-center justify-center gap-4 opacity-60 grayscale">
        <div className="flex items-center gap-1.5 text-[10px] text-gray-600 font-medium bg-white/50 backdrop-blur-sm px-2 py-1 rounded-full border border-gray-200/50">
          <svg className="w-3 h-3 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
          SSL Secure Connection
        </div>
      </div>
      <p className="text-[10px] text-gray-400 mt-4">
        &copy; {new Date().getFullYear()} MKTR Platform. All rights reserved.
      </p>
    </div>
  );
}
