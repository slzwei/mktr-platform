export default function PreviewHeadline({ currentDesign }) {
  return (
    <div className={`mb-6 text-${currentDesign.alignment || 'center'}`} style={{ color: currentDesign.textColor }}>
      {currentDesign.formHeadline ? (
        <h1
          className="font-bold text-gray-900 mb-2 leading-tight tracking-tight"
          style={{ fontSize: `${currentDesign.headlineSize || 24}px`, color: currentDesign.textColor }}
        >
          {currentDesign.formHeadline}
        </h1>
      ) : (
        <div className="border border-dashed border-gray-300 rounded p-2 mb-2 text-gray-400 text-xs text-center">Write a headline...</div>
      )}
      {currentDesign.formSubheadline ? (
        <p className="text-gray-500 text-sm" style={{ color: currentDesign.textColor, opacity: 0.8 }}>{currentDesign.formSubheadline}</p>
      ) : (
        <div className="border border-dashed border-gray-300 rounded p-2 text-gray-400 text-xs text-center">Write a subheadline...</div>
      )}
    </div>
  );
}
