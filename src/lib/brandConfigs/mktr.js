// MKTR brand config — public face of mktr.sg.
// Reach this file only through `@/lib/brand` (aliased at build time).
export default {
  id: 'mktr',
  name: 'MKTR',
  wordmark: 'MKTR.',
  letters: ['M', 'K', 'T', 'R'],
  legalName: 'MKTR PTE. LTD.',
  uen: '202507548M',
  consumerLine: 'MKTR PTE. LTD.',
  logoSrc: '/mktr-logo.svg',
  logoDarkSrc: '/mktr-logo-dark.svg',
  logoIconSrc: '/mktr-logo-icon.svg',
  faviconSrc: '/favicon.svg',
  pageTitle: 'MKTR — Lead Generation for Singapore Insurance Agents',
  pdpaUrl: '/personal-data-policy',
  publicHost: 'mktr.sg',
  // Public marketing surfaces visible on this build.
  // Features/Pricing/About pages are hidden pending a rewrite — they still carry
  // discontinued PHV / commission / AI-voice content. Only the homepage is live.
  showAbout: false,
  showFeatures: false,
  showPricing: false,
  showHomepage: true,
  // Public contact channels surfaced in the marketing footer (the Contact page is
  // hidden from the marketing nav/footer; these replace it).
  // TODO(shawn): confirm hello@mktr.sg actually receives mail; set contactWhatsapp
  // to a real business number to render the WhatsApp link (empty = hidden).
  contactEmail: 'hello@mktr.sg',
  contactWhatsapp: '',
  // Lead-capture defaults used by LeadCapture.jsx / LeadCaptureDemo.jsx.
  defaultRegulatory:
    'MKTR Pte. Ltd. (UEN: 202507548M) operates this referral platform. Submitting this form does not establish any advisory relationship and is not a recommendation of any product. By submitting, you agree to be contacted using the particulars provided.',
  defaultPoweredBy: 'Powered by MKTR',
  // Marketing consent dialog references.
  partnersTerm: 'MKTR Partners',
  pdpaAbsoluteUrl: 'https://mktr.sg/personal-data-policy',
  consentEntityClause: 'MKTR PTE. LTD. (UEN: 202507548M) and its authorised representatives ("MKTR Partners")',
};
