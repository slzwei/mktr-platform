import { Zap, Route, Handshake } from "lucide-react";

const SocialProofBar = () => (
  <div className="mktr-proof-bar">
    <div className="mktr-proof-grid mktr-reveal">
      <div>
        <div className="mktr-proof-number">500+</div>
        <div className="mktr-proof-label">Active Agents</div>
      </div>
      <div>
        <div className="mktr-proof-number">10,000+</div>
        <div className="mktr-proof-label">Leads Generated</div>
      </div>
      <div>
        <div className="mktr-proof-number">3x</div>
        <div className="mktr-proof-label">Conversion Rate</div>
      </div>
    </div>
  </div>
);

const HowItWorks = () => (
  <section className="mktr-section mktr-section-alt">
    <div className="mktr-section-container">
      <p className="mktr-section-eyebrow mktr-reveal">How It Works</p>
      <h2 className="mktr-section-title mktr-reveal mktr-reveal-delay-1">
        Three Steps to More Clients
      </h2>
      <p className="mktr-section-subtitle mktr-reveal mktr-reveal-delay-2">
        Our AI handles the heavy lifting so you can focus on what you do best — closing deals.
      </p>

      <div className="mktr-steps">
        <div className="mktr-step mktr-reveal mktr-reveal-delay-1">
          <div className="mktr-step-number">
            <Zap className="w-6 h-6" />
          </div>
          <h3 className="mktr-step-title">AI Prospect Discovery</h3>
          <p className="mktr-step-desc">
            Our AI call bot and QR campaigns capture high-intent prospects across
            MRTs, malls, and digital channels 24/7.
          </p>
        </div>

        <div className="mktr-step mktr-reveal mktr-reveal-delay-2">
          <div className="mktr-step-number">
            <Route className="w-6 h-6" />
          </div>
          <h3 className="mktr-step-title">Smart Lead Routing</h3>
          <p className="mktr-step-desc">
            Leads are scored, qualified, and routed to the right agent instantly
            based on specialisation and location.
          </p>
        </div>

        <div className="mktr-step mktr-reveal mktr-reveal-delay-3">
          <div className="mktr-step-number">
            <Handshake className="w-6 h-6" />
          </div>
          <h3 className="mktr-step-title">Close More Deals</h3>
          <p className="mktr-step-desc">
            Get real-time notifications, prospect insights, and commission tracking
            so you never miss an opportunity.
          </p>
        </div>
      </div>
    </div>
  </section>
);

const LeadSourcesSection = () => (
  <>
    <SocialProofBar />
    <HowItWorks />
  </>
);

export default LeadSourcesSection;
