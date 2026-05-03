export const PRESET_BACKGROUNDS = {
 gradient: 'bg-paper',
 solid_slate: 'bg-muted',
 simple_gray: 'bg-card',
};

export const TC_TEMPLATES = {
 default: {
 id: 'default',
 name: 'Default (MKTR Standard)',
 content: ''
 },
 generic: {
 id: 'generic',
 name: 'Generic Privacy Policy',
 content: `<p><strong>Privacy Policy</strong></p>
<p>By submitting this form, you consent to the collection and use of your personal data for the purpose of processing your application and contacting you regarding our services.</p>
<p>We respect your privacy and will not share your information with third parties without your consent, except as required by law.</p>`
 },
 detailed: {
 id: 'detailed',
 name: 'Detailed Marketing Consent',
 content: `<p><strong>Marketing Consent</strong></p>
<p>I hereby agree that my personal data may be collected, used, disclosed and processed by the Company for the following purposes:</p>
<ul class="list-disc pl-5">
 <li>To send me marketing and promotional information via email, SMS, and phone calls;</li>
 <li>To conduct market research and analysis;</li>
 <li>To better understand my preferences and improve services.</li>
</ul>
<p>I may withdraw my consent at any time by contacting the Data Protection Officer.</p>`
 }
};

export const PAGE_TEMPLATES = {
 vibrant: {
 id: 'vibrant',
 name: 'Vibrant Modern',
 tagline: 'Blue gradient, glassmorphism card, rounded corners',
 preview: { bg: '#DBEAFE', accent: '#3B82F6', card: 'rgba(255,255,255,0.85)' },
 config: {
 layoutTemplate: 'modern',
 backgroundType: 'custom',
 backgroundColor: '#EFF6FF',
 cardBackgroundColor: '',
 themeColor: '#3B82F6',
 textColor: '#1E293B',
 backgroundStyle: 'gradient',
 headlineSize: 24,
 alignment: 'center',
 spacing: 'normal',
 formWidth: 400,
 }
 },
 corporate: {
 id: 'corporate',
 name: 'Corporate',
 tagline: 'Dark slate background, white card, sharp edges',
 preview: { bg: '#1E293B', accent: '#0F172A', card: '#FFFFFF' },
 config: {
 layoutTemplate: 'corporate',
 backgroundType: 'custom',
 backgroundColor: '#1E293B',
 cardBackgroundColor: '#FFFFFF',
 themeColor: '#0F172A',
 textColor: '#0F172A',
 backgroundStyle: 'solid_slate',
 headlineSize: 22,
 alignment: 'left',
 spacing: 'normal',
 formWidth: 420,
 }
 },
 clean: {
 id: 'clean',
 name: 'Clean & Simple',
 tagline: 'Pure white, borderless, minimal and focused',
 preview: { bg: '#FFFFFF', accent: '#2563EB', card: '#FFFFFF' },
 config: {
 layoutTemplate: 'simple',
 backgroundType: 'preset',
 backgroundColor: '#ffffff',
 cardBackgroundColor: '',
 themeColor: '#2563EB',
 textColor: '#111827',
 backgroundStyle: 'simple_gray',
 headlineSize: 20,
 alignment: 'center',
 spacing: 'normal',
 formWidth: 400,
 }
 },
 bold: {
 id: 'bold',
 name: 'Bold Dark',
 tagline: 'Dark card, vibrant rose accent, high contrast',
 preview: { bg: '#0F172A', accent: '#F43F5E', card: '#1E293B' },
 config: {
 layoutTemplate: 'corporate',
 backgroundType: 'custom',
 backgroundColor: '#0F172A',
 cardBackgroundColor: '#1E293B',
 themeColor: '#F43F5E',
 textColor: '#F8FAFC',
 backgroundStyle: 'solid_slate',
 headlineSize: 28,
 alignment: 'left',
 spacing: 'normal',
 formWidth: 420,
 }
 },
 warm: {
 id: 'warm',
 name: 'Warm Sunset',
 tagline: 'Soft cream background, warm orange accent',
 preview: { bg: '#FFF7ED', accent: '#F97316', card: '#FFFFFF' },
 config: {
 layoutTemplate: 'modern',
 backgroundType: 'custom',
 backgroundColor: '#FFF7ED',
 cardBackgroundColor: '#FFFFFF',
 themeColor: '#F97316',
 textColor: '#1C1917',
 backgroundStyle: 'gradient',
 headlineSize: 24,
 alignment: 'center',
 spacing: 'normal',
 formWidth: 400,
 }
 }
};

export const COLOR_PRESETS = [
 { name:"Ocean Blue", color:"#3B82F6"},
 { name:"Emerald", color:"#10B981"},
 { name:"Purple", color:"#8B5CF6"},
 { name:"Rose", color:"#F43F5E"},
 { name:"Orange", color:"#F97316"},
 { name:"Indigo", color:"#6366F1"},
 { name:"Slate", color:"#64748B"},
 { name:"Red", color:"#EF4444"}
];

export const COMBINABLE_FIELDS = ['dob', 'postal_code', 'education_level', 'monthly_income'];

export const SG_PHONE_PREFIXES = ['9', '8', '6', '3'];

export const DEFAULT_FIELD_ORDER = [
 'name', 'phone', 'email', 'dob', 'postal_code', 'education_level', 'monthly_income'
];
