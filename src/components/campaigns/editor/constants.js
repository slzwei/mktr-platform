export const PRESET_BACKGROUNDS = {
  gradient: 'bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-blue-50 via-white to-gray-50',
  solid_slate: 'bg-slate-50',
  simple_gray: 'bg-white',
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

export const LAYOUT_TEMPLATES = {
  modern: {
    id: 'modern',
    name: 'Vibrant Modern',
    description: 'Gradient background, glassmorphism card, rounded corners.',
    backgroundStyle: 'gradient',
    themeColor: '#3B82F6',
    cardStyle: 'glass',
    config: {
      backgroundType: 'custom',
      backgroundColor: '#EFF6FF',
      themeColor: '#3B82F6',
      textColor: '#1E293B',
      cardBackgroundColor: '',
      headlineSize: 24,
      alignment: 'center',
    }
  },
  corporate: {
    id: 'corporate',
    name: 'Corporate Clean',
    description: 'Dark slate background, sharp edges, professional contrast.',
    backgroundStyle: 'solid_slate',
    themeColor: '#0F172A',
    cardStyle: 'solid',
    config: {
      backgroundType: 'custom',
      backgroundColor: '#1E293B',
      themeColor: '#0F172A',
      textColor: '#F8FAFC',
      cardBackgroundColor: '#FFFFFF',
      headlineSize: 22,
      alignment: 'left',
    }
  },
  simple: {
    id: 'simple',
    name: 'Clean & Simple',
    description: 'Pure white, no card border, minimal and focused.',
    backgroundStyle: 'simple_gray',
    themeColor: '#2563EB',
    cardStyle: 'flat',
    config: {
      backgroundType: 'preset',
      backgroundColor: '#ffffff',
      themeColor: '#2563EB',
      textColor: '#111827',
      cardBackgroundColor: '',
      headlineSize: 20,
      alignment: 'center',
    }
  }
};

export const PAGE_TEMPLATES = {
  bold: {
    id: 'bold',
    name: 'Bold',
    tagline: 'Dark background, vibrant accent, high contrast',
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
  clean: {
    id: 'clean',
    name: 'Clean',
    tagline: 'White, minimal, professional',
    preview: { bg: '#FFFFFF', accent: '#0F172A', card: '#FFFFFF' },
    config: {
      layoutTemplate: 'simple',
      backgroundType: 'preset',
      backgroundColor: '#ffffff',
      cardBackgroundColor: '',
      themeColor: '#0F172A',
      textColor: '#111827',
      backgroundStyle: 'simple_gray',
      headlineSize: 22,
      alignment: 'center',
      spacing: 'normal',
      formWidth: 400,
    }
  },
  vibrant: {
    id: 'vibrant',
    name: 'Vibrant',
    tagline: 'Gradient background, colorful, energetic',
    preview: { bg: '#3B82F6', accent: '#3B82F6', card: 'rgba(255,255,255,0.8)' },
    config: {
      layoutTemplate: 'modern',
      backgroundType: 'preset',
      backgroundColor: '#ffffff',
      cardBackgroundColor: '',
      themeColor: '#3B82F6',
      textColor: '#111827',
      backgroundStyle: 'gradient',
      headlineSize: 24,
      alignment: 'center',
      spacing: 'normal',
      formWidth: 400,
    }
  }
};

export const COLOR_PRESETS = [
  { name: "Ocean Blue", color: "#3B82F6" },
  { name: "Emerald", color: "#10B981" },
  { name: "Purple", color: "#8B5CF6" },
  { name: "Rose", color: "#F43F5E" },
  { name: "Orange", color: "#F97316" },
  { name: "Indigo", color: "#6366F1" },
  { name: "Slate", color: "#64748B" },
  { name: "Red", color: "#EF4444" }
];

export const COMBINABLE_FIELDS = ['dob', 'postal_code', 'education_level', 'monthly_income'];

export const SG_PHONE_PREFIXES = ['9', '8', '6', '3'];

export const DEFAULT_FIELD_ORDER = [
  'name', 'phone', 'email', 'dob', 'postal_code', 'education_level', 'monthly_income'
];
