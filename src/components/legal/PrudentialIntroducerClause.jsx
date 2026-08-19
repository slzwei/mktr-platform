import { useCampaignTheme } from '@/components/campaignPage/themeContext';

/**
 * Prudential introducer & consent disclosure — appended to the campaign
 * T&Cs section of ConsentAgreementDialog when design_config.prudentialAd is
 * on (Studio Form panel → "Prudential Ad" toggle). It is deliberately NOT a
 * separate consent checkbox and NOT stored in form.terms.html: the wording is
 * Prudential's compliance template, so it lives in exactly one place and every
 * toggled campaign renders the same bytes.
 *
 * `fbName` = the Facebook Business Name the ad runs under (Studio companion
 * field). Absent ⇒ the attribution line is omitted rather than guessed — never
 * invent a business identity in a regulatory disclosure.
 *
 * Text is verbatim from the template (2026-08-19). Do not editorialize it.
 */
export default function PrudentialIntroducerClause({ fbName }) {
  const { tokens: TOKENS } = useCampaignTheme();

  const linkStyle = {
    color: TOKENS.body,
    fontWeight: 600,
    textDecoration: 'underline',
    textUnderlineOffset: 3,
    overflowWrap: 'anywhere',
  };
  const pStyle = { margin: '0 0 12px' };

  return (
    <div style={{ marginTop: 16, fontSize: 13, color: TOKENS.muted }}>
      {fbName ? (
        <p style={pStyle}>
          <strong style={{ color: TOKENS.ink }}>{fbName}</strong> belongs to MKTR PTE. LTD.
        </p>
      ) : null}
      <p style={pStyle}>
        MKTR PTE. LTD. is an introducer, carrying out introducing activities for Prudential
        Assurance Company Singapore (Pte) Limited (&quot;Prudential&quot;) and Prudential Financial
        Advisers Singapore Pte Ltd (&quot;PFA&quot;). MKTR PTE. LTD. is not allowed to give advice or
        provide recommendations on any investment product, market any collective investment scheme
        or arrange any contract of insurance in respect of life policies, other than to the extent
        of carrying out introducing activities. MKTR PTE. LTD. receives a fee for carrying out
        introducing activities and will disclose the fee, if requested by you. You may contact
        MKTR PTE. LTD. on how you may access and correct your personal data or withdraw consent to
        the collection, use or disclosure of your personal data.
      </p>
      <p style={{ ...pStyle, marginBottom: 0 }}>
        Prudential Assurance Company Singapore (Pte) Limited (or &quot;Prudential&quot;) is a life
        insurance company that provides life and health insurance. You may refer to{' '}
        <a href="https://www.prudential.com.sg" target="_blank" rel="noopener noreferrer" style={linkStyle}>
          www.prudential.com.sg
        </a>{' '}
        for the list of Prudential products and services. Product(s) and/ or service(s) mentioned
        which are not listed in the Prudential website are not offered by Prudential. By signing
        up, you also confirm that you have read, understood and given your consent for Prudential
        Assurance Company Singapore and its related corporations, respective representatives,
        agents, third party service providers, contractors and/or appointed distribution/business
        partners (collectively referred to as &quot;Prudential and its authorised
        representatives&quot;) to collect, use, disclose and/or process your personal data for the
        purpose of contacting you about products and services distributed, marketed and/or
        introduced by Prudential and its authorised representatives through marketing activities
        via all channels including but not limited to SMS, Social Media, In-app Push Notification,
        Phone Call etc and perusing your contact details which Prudential and its authorised
        representatives has in its records from time to time and in accordance to the Prudential
        Data Privacy Notice, which is available at{' '}
        <a href="http://www.prudential.com.sg/Privacy-Notice" target="_blank" rel="noopener noreferrer" style={linkStyle}>
          http://www.prudential.com.sg/Privacy-Notice
        </a>
        . You hereby expressly understand and agree that your given consent(s) herein do not
        supersede or replace any other consents and/or previous consents which you may have
        previously given to Prudential and its authorised representatives in respect of your
        personal data and is without prejudice to any legal rights available to Prudential and its
        authorised representatives to collect, use or disclose your personal data. You understand
        that you can refer to Prudential Data Privacy, which is available at{' '}
        <a href="https://www.prudential.com.sg/Privacy-Notice" target="_blank" rel="noopener noreferrer" style={linkStyle}>
          https://www.prudential.com.sg/Privacy-Notice
        </a>{' '}
        for more information.
      </p>
    </div>
  );
}
