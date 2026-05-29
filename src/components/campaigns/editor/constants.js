import { brand } from "@/lib/brand";

// Single source for short, throwaway row/element IDs used by the field-order
// editor. Prefers crypto.randomUUID() where available, with a Math.random
// fallback for non-secure contexts. Replaces the scattered, deprecated
// `Math.random().toString(36).substr(2, 9)` copies.
export function genId() {
 try {
 if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
 return crypto.randomUUID().slice(0, 8);
 }
 } catch {
 /* fall through to Math.random */
 }
 return Math.random().toString(36).slice(2, 11);
}

export const TC_TEMPLATES = {
 default: {
 id: 'default',
 name: `Default (${brand.name} Standard)`,
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
