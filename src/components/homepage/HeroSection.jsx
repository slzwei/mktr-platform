import { ArrowRight, ChevronDown } from"lucide-react";

const HeroSection = () => {
 return (
 <section
 className="mktr-hero"
 style={{
 background:
 'radial-gradient(1100px 560px at 50% -10%, rgba(201, 122, 90, 0.20), transparent 60%), var(--mktr-bg, #141310)',
 }}
 >
 <div className="mktr-hero-content">
 <div className="mktr-reveal">
 <p className="mktr-hero-eyebrow">Lead generation for Singapore insurance agents</p>
 </div>

 <h1 className="mktr-hero-title mktr-reveal mktr-reveal-delay-1">
 Qualified leads,<br />
 delivered to<br />
 <span className="accent">your phone.</span>
 </h1>

 <p className="mktr-hero-subtitle mktr-reveal mktr-reveal-delay-2">
 MKTR captures high-intent insurance prospects across Singapore and routes
 each one to the right agent — instantly. Exclusive leads, ready to close.
 </p>

 <div className="flex flex-wrap gap-4 justify-center mktr-reveal mktr-reveal-delay-3">
 <a href="#waitlist" className="mktr-hero-cta">
 Join the waitlist
 <ArrowRight className="w-4 h-4"/>
 </a>
 <a href="#how-it-works" className="mktr-hero-cta-secondary">
 See how it works
 </a>
 </div>
 </div>

 <div className="mktr-hero-scroll-indicator">
 <ChevronDown className="w-6 h-6" style={{ color: 'var(--mktr-text-dim)' }} />
 </div>
 </section>
 );
};

export default HeroSection;
