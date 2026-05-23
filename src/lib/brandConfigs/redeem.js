// Redeem brand config — public face of redeem.sg.
// MKTR PTE. LTD. is retained as the legal entity per D3; consumer-facing
// surfaces use "Redeem".
export default {
  id: 'redeem',
  name: 'Redeem',
  wordmark: 'Redeem.',
  letters: ['R', 'E', 'D', 'E', 'E', 'M'],
  legalName: 'MKTR PTE. LTD.',
  uen: '202507548M',
  consumerLine: 'Redeem (a service of MKTR PTE. LTD.)',
  logoSrc: '/redeem-logo.svg',
  logoDarkSrc: '/redeem-logo-dark.svg',
  logoIconSrc: '/redeem-logo-icon.svg',
  faviconSrc: '/redeem-favicon.svg',
  pageTitle: 'Redeem — Lead Capture',
  pdpaUrl: '/personal-data-policy',
  publicHost: 'redeem.sg',
  // Hide MKTR-only marketing surfaces on redeem.sg (D2).
  showAbout: false,
  showFeatures: false,
  showPricing: false,
  showHomepage: false,
  defaultRegulatory:
    'Redeem (a service of MKTR PTE. LTD., UEN: 202507548M) operates this referral platform. Submitting this form does not establish any advisory relationship and is not a recommendation of any product. By submitting, you agree to be contacted using the particulars provided.',
  defaultPoweredBy: 'Powered by Redeem',
  partnersTerm: 'Redeem Partners',
  pdpaAbsoluteUrl: 'https://redeem.sg/personal-data-policy',
  consentEntityClause:
    'MKTR PTE. LTD. (UEN: 202507548M), operator of Redeem, and its authorised representatives ("Redeem Partners")',
};
