import { Zap, Route, Handshake } from"lucide-react";

const HowItWorks = () => (
 <section id="how-it-works" className="mktr-section mktr-section-alt">
 <div className="mktr-section-container">
 <p className="mktr-section-eyebrow mktr-reveal">How It Works</p>
 <h2 className="mktr-section-title mktr-reveal mktr-reveal-delay-1">
 From first capture to your phone
 </h2>
 <p className="mktr-section-subtitle mktr-reveal mktr-reveal-delay-2">
 We handle everything between the prospect and the close, so you spend your
 time on the conversations that matter.
 </p>

 <div className="mktr-steps">
 <div className="mktr-step mktr-reveal mktr-reveal-delay-1">
 <div className="mktr-step-number">
 <Zap className="w-6 h-6"/>
 </div>
 <h3 className="mktr-step-title">We capture the leads</h3>
 <p className="mktr-step-desc">
 QR codes and forms capture high-intent insurance prospects across
 Singapore — at roadshows, events, and online.
 </p>
 </div>

 <div className="mktr-step mktr-reveal mktr-reveal-delay-2">
 <div className="mktr-step-number">
 <Route className="w-6 h-6"/>
 </div>
 <h3 className="mktr-step-title">We route them to you</h3>
 <p className="mktr-step-desc">
 Every lead is matched and assigned to the right agent automatically —
 no scrambling, no double-handling.
 </p>
 </div>

 <div className="mktr-step mktr-reveal mktr-reveal-delay-3">
 <div className="mktr-step-number">
 <Handshake className="w-6 h-6"/>
 </div>
 <h3 className="mktr-step-title">You close</h3>
 <p className="mktr-step-desc">
 Leads land on your phone in seconds with full context — exclusive to
 you, ready to call.
 </p>
 </div>
 </div>
 </div>
 </section>
);

const LeadSourcesSection = () => <HowItWorks />;

export default LeadSourcesSection;
