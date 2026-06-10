import MarketingLayout from '@/components/layout/MarketingLayout';
import '../pages/Homepage.css';

// Privacy policy for the MKTR Leads mobile app (agent-facing). Linked from the
// App Store listing (store.config.json -> privacyPolicyUrl = mktr.sg/leads/privacy)
// and from the app. Distinct from /personal-data-policy, which covers the
// public lead-capture/marketing site.
const sections = [
  {
    title: '1. Who this policy is for',
    content: 'This policy applies to two groups of people:',
    list: [
      'Agents — people who sign in to MKTR Leads to receive and follow up on sales leads.',
      'Leads (prospects) — individuals whose contact details are delivered to an agent after they engaged with a MKTR campaign (web form, QR code, or voice call).',
    ],
  },
  {
    title: '2. What we collect',
    content: 'From agents who use the app, we collect:',
    list: [
      'Mobile number — used to sign in.',
      'Name, email address, and agency — your profile.',
      'Device push token — so we can notify you when a lead is assigned to you.',
      'Activity you log against a lead — call and WhatsApp outcomes, notes, and follow-up tasks.',
    ],
    after:
      'About leads, we hold the lead’s name, mobile number, the product or campaign they responded to, and any notes or outcomes an agent records. This data is collected upstream — when the individual engages with a MKTR campaign — and is disclosed to the assigned agent inside the app. The app contains no third-party analytics, advertising, or tracking technology, and we do not track you across other apps or websites.',
  },
  {
    title: '3. Why we use it',
    content: 'We use personal data to:',
    list: [
      'Authenticate agents and secure access (one-time passcode sign-in).',
      'Route each lead to the assigned agent and send a notification.',
      'Let agents contact and follow up with leads, and track each lead’s status.',
      'Operate, maintain, and improve the service, and meet legal and record-keeping obligations.',
    ],
  },
  {
    title: '4. Consent and legal basis (PDPA)',
    content:
      'We collect, use, and disclose personal data with consent, or where otherwise permitted or required by law. Leads are informed at the point of capture that their details will be shared with a licensed insurance agent who will contact them, and they consent to that contact.',
  },
  {
    title: '5. Disclosure to third parties',
    content: 'We may share personal data with:',
    list: [
      'The assigned agent, who receives the lead’s contact details to follow up. Agents accept terms in the app that restrict use to that follow-up only — no resale or onward sharing.',
      'Service providers that host or process data on our behalf — including Supabase (database and notifications), Expo (push notification delivery), and the SMS/WhatsApp providers used to deliver sign-in codes.',
    ],
    after: 'We do not sell personal data, and we do not share it with advertising networks or data brokers.',
  },
  {
    title: '6. Retention and deletion',
    content:
      'We keep personal data only as long as needed for the purposes above or as required by law, then delete or anonymise it. Agents can permanently delete their account and associated data at any time from within the app (Profile → Delete account). Leads may request deletion at any time using the contact details below.',
  },
  {
    title: '7. Security',
    content:
      'We protect personal data with encryption in transit, access controls and row-level security so an agent can only see their own leads, and device-level protections such as biometric sign-in and secure token storage. No method of transmission or storage is completely secure.',
  },
  {
    title: '8. Your rights (PDPA)',
    content:
      'You may request access to or correction of your personal data, withdraw consent, or request deletion or erasure, by contacting us using the details below. We will respond within the timeframe required by the PDPA. Withdrawing consent may mean we can no longer provide the service or contact a lead.',
  },
  {
    title: '9. Overseas transfer',
    content:
      'Where data is processed outside Singapore by our service providers, we take steps to ensure a standard of protection comparable to that required under the PDPA.',
  },
  {
    title: '10. Changes to this policy',
    content:
      'We may update this policy from time to time. The "Last updated" date will change, and material updates will be notified where appropriate.',
  },
  {
    title: '11. Contact us',
    content: 'If you have any questions about this policy or wish to exercise your rights, please contact us:',
    after:
      'MKTR PTE. LTD. (UEN 202507548M)\n71 Ayer Rajah Crescent, #06-14\nSingapore 139951\n\nWhatsApp: +65 8079 0542',
  },
];

export default function LeadsPrivacy() {
  return (
    <MarketingLayout>
      <section className="mktr-section" style={{ paddingTop: '5rem' }}>
        <div className="mktr-section-container" style={{ maxWidth: 800 }}>
          <p className="mktr-section-eyebrow mktr-reveal">MKTR Leads</p>
          <h1
            className="mktr-section-title mktr-reveal mktr-reveal-delay-1"
            style={{ textAlign: 'left', marginBottom: '0.5rem' }}
          >
            Privacy Policy
          </h1>
          <p
            className="mktr-reveal mktr-reveal-delay-2"
            style={{
              fontFamily: 'var(--mono-font)',
              fontSize: '0.75rem',
              color: 'var(--mktr-text-dim)',
              letterSpacing: '1px',
              marginBottom: '3rem',
            }}
          >
            Last Updated: 10 June 2026
          </p>

          <div className="mktr-reveal mktr-reveal-delay-2" style={{ marginBottom: '2rem' }}>
            <p
              style={{
                fontFamily: 'var(--body-font)',
                fontSize: '1.05rem',
                color: 'var(--mktr-text-muted)',
                lineHeight: 1.8,
                fontWeight: 300,
              }}
            >
              MKTR Leads is a mobile app from MKTR PTE. LTD. (&ldquo;MKTR&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;, or
              &ldquo;our&rdquo;) that lets insurance agents receive and follow up on sales leads supplied by MKTR. This
              policy explains what personal data we handle and how, in accordance with Singapore&rsquo;s Personal Data
              Protection Act 2012 (&ldquo;PDPA&rdquo;).
            </p>
          </div>

          {sections.map((s, i) => (
            <div key={i} className="mktr-reveal" style={{ marginBottom: '2.5rem' }}>
              <h2
                style={{
                  fontFamily: 'var(--heading-font)',
                  fontSize: '1.25rem',
                  fontWeight: 600,
                  color: 'var(--mktr-text)',
                  marginBottom: '1rem',
                  paddingBottom: '0.75rem',
                  borderBottom: '1px solid var(--mktr-border)',
                }}
              >
                {s.title}
              </h2>
              <p
                style={{
                  fontFamily: 'var(--body-font)',
                  fontSize: '0.95rem',
                  color: 'var(--mktr-text-muted)',
                  lineHeight: 1.8,
                  fontWeight: 300,
                  marginBottom: s.list ? '1rem' : 0,
                }}
              >
                {s.content}
              </p>
              {s.list && (
                <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 1rem' }}>
                  {s.list.map((item, j) => (
                    <li
                      key={j}
                      style={{
                        fontFamily: 'var(--body-font)',
                        fontSize: '0.95rem',
                        color: 'var(--mktr-text-muted)',
                        lineHeight: 1.8,
                        fontWeight: 300,
                        paddingLeft: '1.5rem',
                        position: 'relative',
                        marginBottom: '0.25rem',
                      }}
                    >
                      <span style={{ position: 'absolute', left: 0, color: 'var(--mktr-accent)' }}>&bull;</span>
                      {item}
                    </li>
                  ))}
                </ul>
              )}
              {s.after && (
                <p
                  style={{
                    fontFamily: 'var(--body-font)',
                    fontSize: '0.95rem',
                    color: 'var(--mktr-text-muted)',
                    lineHeight: 1.8,
                    fontWeight: 300,
                    whiteSpace: 'pre-line',
                  }}
                >
                  {s.after}
                </p>
              )}
            </div>
          ))}
        </div>
      </section>
    </MarketingLayout>
  );
}
