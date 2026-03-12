import { PAGE_TEMPLATES } from './constants';

export default function TemplatesPanel({ onApplyTemplate }) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600 dark:text-gray-400">
        Choose a starting template. You can customise everything after applying.
      </p>
      <div className="grid grid-cols-1 gap-3">
        {Object.values(PAGE_TEMPLATES).map((template) => (
          <button
            key={template.id}
            type="button"
            onClick={() => onApplyTemplate(template.id)}
            className="relative p-4 rounded-xl border-2 border-gray-100 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-600 transition-all text-left group bg-white dark:bg-gray-800"
          >
            <div className="flex items-center gap-4">
              <div
                className="w-14 h-14 rounded-lg border border-gray-200 dark:border-gray-600 flex items-center justify-center shrink-0 overflow-hidden"
                style={{ backgroundColor: template.preview.bg }}
              >
                <div
                  className="w-8 h-10 rounded shadow-sm"
                  style={{ backgroundColor: template.preview.card, border: '1px solid rgba(0,0,0,0.1)' }}
                >
                  <div className="w-4 h-1 rounded-full mt-2 mx-auto" style={{ backgroundColor: template.preview.accent }} />
                  <div className="w-5 h-0.5 rounded-full mt-1 mx-auto bg-gray-300/50" />
                  <div className="w-5 h-0.5 rounded-full mt-0.5 mx-auto bg-gray-300/50" />
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="font-semibold text-gray-900 dark:text-gray-100">{template.name}</h4>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{template.tagline}</p>
              </div>
              <div className="text-xs text-blue-600 dark:text-blue-400 font-medium opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                Apply
              </div>
            </div>
          </button>
        ))}
      </div>
      <div className="pt-2 text-xs text-gray-400 dark:text-gray-500 text-center">
        Applying a template updates colours, layout, and typography. Your content and field settings are preserved.
      </div>
    </div>
  );
}
