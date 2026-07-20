import { useCampaignTheme } from '@/components/campaignPage/themeContext';
import { brand } from '@/lib/brand';

/**
 * The DEFAULT campaign terms & conditions — the "Terms & conditions" section of
 * ConsentAgreementDialog whenever a campaign supplies no custom termsContent.
 *
 * These describe the ACTUAL business model (reworked 2026-07-21). Three parties,
 * kept deliberately distinct because the superseded copy conflated them:
 *  - MKTR/{brand}: runs the platform. Paid BY sponsors and businesses to run
 *    campaigns. NOBODY is paid to refer consumers TO the platform — the old
 *    copy described an introducer/referral-agent model that does not exist.
 *  - Reward partner (OPTIONAL, third party): the business providing the reward
 *    or trial — e.g. a pilates studio or an enrichment centre. Many campaigns
 *    have one; some have none.
 *  - Sponsor: funds the campaign; often a financial advisory firm or licensed
 *    representative. Sponsored campaigns require a short (~20 min) financial
 *    review session, and where there is NO reward partner the sponsoring
 *    consultant provides the reward directly at that session.
 *
 * Consistency rules when editing:
 *  - contact channels here must match CONTACT_CONSENT_CHANNELS and the hashed
 *    clause in src/lib/consentCopy.js (phone, SMS/WhatsApp, email) — never
 *    claim broader channels than the person actually consented to;
 *  - the ledger's latest-act-wins semantics (consentService) mean these terms
 *    must NOT claim a consent is non-superseding;
 *  - contact details must match Personal Data Policy §11 (single source).
 *
 * This copy is NOT part of the hashed consent evidence (that is
 * CONSENT_COPY.clause* only — see consentCopy.js), so editing it does not
 * require a consent-era bump.
 */
export default function DefaultTermsCopy() {
  const { tokens: TOKENS } = useCampaignTheme();
  const pdpaUrl = brand.pdpaAbsoluteUrl;
  const linkStyle = { color: TOKENS.body, textDecoration: 'underline' };

  return (
    <>
      <p style={{ margin: 0 }}>
        These terms apply when you submit a form on {brand.name} to claim a reward, trial or
        experience. Please read them together with the {brand.name}{' '}
        <a href={pdpaUrl} target="_blank" rel="noreferrer" style={linkStyle}>
          Personal Data Policy
        </a>
        .
      </p>

      <Section title="1. Who we are">
        <p style={{ margin: 0 }}>
          {brand.legalName} (UEN: {brand.uen}) operates {brand.name}, a Singapore platform where
          businesses and sponsors offer rewards, trials and experiences to consumers.{' '}
          {brand.name} is not a financial adviser, insurer or product provider, and nothing on this
          platform constitutes financial advice or a recommendation to purchase any product.
        </p>
      </Section>

      <Section title="2. How campaigns are funded">
        <p style={{ margin: 0 }}>
          The businesses and sponsors behind each campaign pay {brand.name} to run it. That is why
          the reward is provided to you at no charge — you pay {brand.name} nothing. {brand.name}{' '}
          does not engage introducers or referral agents, and no third party is compensated for
          referring you to {brand.name}. We do advertise on platforms such as Facebook, Instagram
          and TikTok; section 10 of our Personal Data Policy sets out what those platforms receive.
        </p>
      </Section>

      <Section title="3. Who provides the reward">
        <p style={{ margin: 0 }}>
          Rewards are provided in one of two ways, and the campaign page states which applies
          before you sign up:
        </p>
        <ul style={{ margin: '8px 0 0', paddingLeft: 20, display: 'grid', gap: 6 }}>
          <li>
            <strong style={{ color: TOKENS.ink }}>By a partner business</strong> — an independent
            third party, such as a studio, enrichment centre, clinic or retailer, which provides
            the trial, session or product described. That business is responsible for the reward
            it provides and for the conduct of its own services; {brand.name} is not the provider.
          </li>
          <li>
            <strong style={{ color: TOKENS.ink }}>By the sponsoring consultant</strong> — where a
            campaign has no partner business, the sponsoring consultant provides the reward
            directly (for example, a supermarket voucher) when you attend the session described in
            section 5.
          </li>
        </ul>
      </Section>

      <Section title="4. Sponsored campaigns">
        <p style={{ margin: 0 }}>
          Some campaigns are sponsored by a financial advisory firm or a licensed financial
          advisory representative. Where a campaign is sponsored, the sponsor is named on the
          campaign page before you sign up.
        </p>
      </Section>

      <Section title="5. What a sponsored campaign requires">
        <p style={{ margin: 0 }}>
          To receive the reward on a sponsored campaign, you must complete a short financial review
          session with the sponsoring consultant — typically around 20 minutes, in person or
          online. The exact requirement, and any deadline for completing it, is stated on the
          campaign page before you sign up. The session is a discussion of your financial situation
          and the options available to you; you are under no obligation to purchase anything,
          during the session or afterwards. If the required session is not completed, the reward
          may not be issued.
        </p>
      </Section>

      <Section title="6. The sponsoring consultant">
        <p style={{ margin: 0 }}>
          The consultant is licensed and acts for their own firm, not for {brand.name}. Any advice
          or recommendation given is theirs, and any product you decide to take up is a matter
          between you and their firm. {brand.name} is paid by the sponsor for running the campaign
          and is not a party to any product you purchase.
        </p>
      </Section>

      <Section title="7. Who receives your details">
        <p style={{ margin: 0 }}>
          We use the details you submit to verify your entry, issue your reward and contact you as
          set out in the agreement you accept at signup. Your details are also disclosed to:
        </p>
        <ul style={{ margin: '8px 0 0', paddingLeft: 20, display: 'grid', gap: 6 }}>
          <li>
            the sponsor named on the campaign page, on sponsored campaigns — so that they may
            arrange the session and contact you about your reward and relevant products and
            services;
          </li>
          <li>
            the partner business providing the reward, where the campaign has one — limited to what
            that business requires in order to provide or schedule it; and
          </li>
          <li>
            our service providers and appointed representatives (for example messaging, email and
            hosting providers), who handle your data on our instructions.
          </li>
        </ul>
        <p style={{ margin: '8px 0 0' }}>We do not sell your personal data.</p>
      </Section>

      <Section title={`8. Marketing from ${brand.name}`}>
        <p style={{ margin: 0 }}>
          As set out in the agreement you accept at signup, {brand.consentEntityClause} may contact
          you about your signup and reward, and about other {brand.name} offers, rewards and lucky
          draws, by phone call, text message (SMS or WhatsApp) and email. You may opt out of
          marketing at any time — every marketing email includes an unsubscribe link, or you may
          use the contact details in section 11. Opting out does not affect a reward you have
          already claimed, and we may still send you the messages needed to deliver it.
        </p>
      </Section>

      <Section title="9. Eligibility, rewards and fair use">
        <p style={{ margin: 0 }}>
          Eligibility conditions — such as age, residency, or one redemption per person or
          household — are stated on the campaign page. Rewards are subject to availability and to
          your meeting the stated conditions. We may verify the details you submit, and may
          withhold or cancel a reward where entries are duplicated or false, or where the platform
          is misused.
        </p>
      </Section>

      <Section title="10. Withdrawing your consent">
        <p style={{ margin: 0 }}>
          You may withdraw or amend your consent at any time using the contact details below, or
          those in our Personal Data Policy. Withdrawal takes effect going forward: it does not
          reverse what has already been done, and it may affect our ability to issue a reward that
          has not yet been fulfilled.
        </p>
      </Section>

      <Section title="11. Contact">
        <p style={{ margin: 0, whiteSpace: 'pre-line' }}>
          {`${brand.legalName}\n71 Ayer Rajah Crescent, #06-14\nSingapore 139951\n\nWhatsApp: +65 8079 0542`}
        </p>
      </Section>

      <Section title="12. Changes to these terms">
        <p style={{ margin: 0 }}>
          We may update these terms from time to time. The version shown to you when you submit a
          form is the version that applies to that submission.
        </p>
      </Section>
    </>
  );
}

function Section({ title, children }) {
  const { tokens: TOKENS } = useCampaignTheme();
  return (
    <div style={{ marginTop: 20 }}>
      <p style={{ fontWeight: 700, color: TOKENS.ink, margin: 0, marginBottom: 6 }}>{title}</p>
      {children}
    </div>
  );
}
