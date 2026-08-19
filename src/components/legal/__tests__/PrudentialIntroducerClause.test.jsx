import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';

import PrudentialIntroducerClause from '../PrudentialIntroducerClause';

/**
 * VERBATIM pin for the Prudential introducer & consent disclosure (template
 * Shawn supplied 2026-08-20, [Partner] = MKTR PTE. LTD.). The block is
 * compliance wording: any drift — a word, a quote glyph, a "fixed" typo — is
 * a regression. The template's own quirks are deliberately preserved and
 * asserted here: curly “ ” quotes, the mixed straight-open/curly-close pair
 * on ("PFA”), and the "and/ or" spacing. A genuine Prudential wording update
 * means changing the component AND this fixture together.
 */

const PARA_1 =
  'MKTR PTE. LTD. is an introducer, carrying out introducing activities for Prudential Assurance Company Singapore (Pte) Limited (“Prudential”) and Prudential Financial Advisers Singapore Pte Ltd ("PFA”). MKTR PTE. LTD. is not allowed to give advice or provide recommendations on any investment product, market any collective investment scheme or arrange any contract of insurance in respect of life policies, other than to the extent of carrying out introducing activities. MKTR PTE. LTD. receives a fee for carrying out introducing activities and will disclose the fee, if requested by you. You may contact MKTR PTE. LTD. on how you may access and correct your personal data or withdraw consent to the collection, use or disclosure of your personal data.';

const PARA_2 =
  'Prudential Assurance Company Singapore (Pte) Limited (or “Prudential”) is a life insurance company that provides life and health insurance. You may refer to www.prudential.com.sg for the list of Prudential products and services. Product(s) and/ or service(s) mentioned which are not listed in the Prudential website are not offered by Prudential. By signing up, you also confirm that you have read, understood and given your consent for Prudential Assurance Company Singapore and its related corporations, respective representatives, agents, third party service providers, contractors and/or appointed distribution/business partners (collectively referred to as “Prudential and its authorised representatives”) to collect, use, disclose and/or process your personal data for the purpose of contacting you about products and services distributed, marketed and/or introduced by Prudential and its authorised representatives through marketing activities via all channels including but not limited to SMS, Social Media, In-app Push Notification, Phone Call etc and perusing your contact details which Prudential and its authorised representatives has in its records from time to time and in accordance to the Prudential Data Privacy Notice, which is available at http://www.prudential.com.sg/Privacy-Notice. You hereby expressly understand and agree that your given consent(s) herein do not supersede or replace any other consents and/or previous consents which you may have previously given to Prudential and its authorised representatives in respect of your personal data and is without prejudice to any legal rights available to Prudential and its authorised representatives to collect, use or disclose your personal data. You understand that you can refer to Prudential Data Privacy, which is available at https://www.prudential.com.sg/Privacy-Notice for more information.';

/** JSX collapses source-formatting whitespace; normalize runs of spaces the
 * same way before comparing so the pin is about CHARACTERS, not indentation. */
const textOf = (el) => el.textContent.replace(/\s+/g, ' ').trim();

describe('PrudentialIntroducerClause — verbatim compliance template', () => {
  it('renders the two template paragraphs byte-for-byte (quotes and quirks included)', () => {
    const { container } = render(<PrudentialIntroducerClause fbName="Redeem SG" />);
    const paras = [...container.querySelectorAll('p')].map(textOf);
    expect(paras).toHaveLength(3);
    expect(paras[0]).toBe('Redeem SG belongs to MKTR PTE. LTD.');
    expect(paras[1]).toBe(PARA_1);
    expect(paras[2]).toBe(PARA_2);
  });

  it('omits the attribution line when no Facebook Business Name is set — never guesses one', () => {
    const { container } = render(<PrudentialIntroducerClause />);
    const paras = [...container.querySelectorAll('p')].map(textOf);
    expect(paras).toHaveLength(2);
    expect(paras[0]).toBe(PARA_1);
  });

  it('links both Privacy-Notice URLs and the products page', () => {
    const { container } = render(<PrudentialIntroducerClause fbName="Redeem SG" />);
    const hrefs = [...container.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual([
      'https://www.prudential.com.sg',
      'http://www.prudential.com.sg/Privacy-Notice',
      'https://www.prudential.com.sg/Privacy-Notice',
    ]);
    for (const a of container.querySelectorAll('a')) {
      expect(a.getAttribute('rel')).toBe('noopener noreferrer');
      expect(a.getAttribute('target')).toBe('_blank');
    }
  });
});
