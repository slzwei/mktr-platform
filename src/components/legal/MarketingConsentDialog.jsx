import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export default function MarketingConsentDialog({ open, onOpenChange }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Marketing Consent – MKTR PTE. LTD. (UEN: 202507548M)</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 text-sm text-gray-700 leading-6">
          <p>
            By submitting this form, you agree to receive updates on promotions, offers, customer rewards, and other marketing-related communications from MKTR PTE. LTD. and its authorised representatives ("MKTR Partners"). You also agree that your personal data may be collected, used, stored, and shared in accordance with this consent form and the MKTR Personal Data Policy (
            <a href="https://mktr.sg/personal-data-policy" target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">https://mktr.sg/personal-data-policy</a>
            ).
          </p>
          <p>
            Your details may also be disclosed to trusted third parties and their agents, for the purposes of carrying out marketing campaigns, customer engagement activities, and related services.
          </p>

          <div>
            <p className="font-semibold">1. Definition of MKTR Partners</p>
            <p>
              "MKTR Partners" include MKTR PTE. LTD., its affiliates, service providers, and appointed representatives, whether located in Singapore or overseas.
            </p>
          </div>

          <div>
            <p className="font-semibold">2. Non-Superseding Consent</p>
            <p>
              This consent is in addition to any prior consents you may have given. It does not cancel or override any earlier consent.
            </p>
          </div>

          <div>
            <p className="font-semibold">3. Withdrawing Consent</p>
            <p>You may withdraw or amend your consent at any time by:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Calling the MKTR Customer Support line at +65 XXXX XXXX,</li>
              <li>
                Logging into your My MKTR account (
                <a href="https://portal.mktr.sg/login" target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">https://portal.mktr.sg/login</a>
                ), or
              </li>
              <li>
                Submitting the withdrawal form found at {" "}
                <a href="https://mktr.sg/personal-data-policy" target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">https://mktr.sg/personal-data-policy</a>.
              </li>
            </ul>
          </div>

          <div>
            <p className="font-semibold">4. How We May Contact You</p>
            <p>We may reach out to you through the following methods:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Postal mail</li>
              <li>Email or social media platforms</li>
              <li>Phone calls</li>
              <li>Text or messaging apps (e.g. SMS/MMS, WhatsApp)</li>
            </ul>
          </div>

          <div>
            <p className="font-semibold">5. Campaign and Promotion Terms</p>
            <p>
              For selected campaigns, your contact information may be shared with authorised MKTR representatives or partner companies for the purpose of arranging a consultation, product trial, or service session. This may be a requirement to redeem any rewards or gifts tied to the campaign.
            </p>
            <p>
              Eligibility criteria (such as residency, age range, or one redemption per household) will apply and will be clearly stated in the campaign terms.
            </p>
          </div>

          <div>
            <p className="font-semibold">6. Referral Partners</p>
            <p>
              MKTR may collaborate with introducers or referral partners who are compensated for connecting interested individuals with MKTR. Such introducers are not allowed to provide you with product advice, recommendations, or ongoing service. Their role is limited to making the introduction.
            </p>
            <p>
              By submitting your details, you acknowledge and agree that MKTR PTE. LTD. (UEN: 202507548M) and its partners may use your personal data to send you marketing, promotional, and product information, and that MKTR may reward referral partners for successful introductions.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}


