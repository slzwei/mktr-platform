import { QrCode, Smartphone, Route, ShieldCheck, BarChart3 } from"lucide-react";

const features = [
 {
 icon: QrCode,
 title:"Exclusive, qualified leads",
 desc:"Prospects captured from QR codes and forms across Singapore — and every lead is yours alone, never resold to another agent.",
 },
 {
 icon: Smartphone,
 title:"Delivered to your phone",
 desc:"New leads arrive in seconds via push notification, with the source, campaign, and details you need to follow up fast.",
 },
 {
 icon: Route,
 title:"Matched to the right agent",
 desc:"Smart routing assigns each lead automatically, so the right person reaches out first — no manual sorting.",
 },
 {
 icon: ShieldCheck,
 title:"Consent-first & PDPA-compliant",
 desc:"Every capture is permission-based and compliant, so you can follow up with confidence.",
 },
 {
 icon: BarChart3,
 title:"Clear lead insights",
 desc:"See where your leads come from and how each campaign performs — no guesswork.",
 },
];

const FeaturesSection = () => {
 return (
 <section id="features" className="mktr-section">
 <div className="mktr-section-container">
 <p className="mktr-section-eyebrow mktr-reveal">What You Get</p>
 <h2 className="mktr-section-title mktr-reveal mktr-reveal-delay-1">
 Built for agents who'd<br />rather be closing
 </h2>
 <p className="mktr-section-subtitle mktr-reveal mktr-reveal-delay-2">
 Everything an insurance agent needs from a lead source — and nothing they don't.
 </p>

 <div className="mktr-features-grid">
 {features.map((f, i) => (
 <div
 key={f.title}
 className={`mktr-feature-card mktr-reveal mktr-reveal-delay-${i + 1}`}
 >
 <div className="mktr-feature-icon">
 <f.icon className="w-5 h-5"/>
 </div>
 <h3 className="mktr-feature-title">{f.title}</h3>
 <p className="mktr-feature-desc">{f.desc}</p>
 </div>
 ))}
 </div>
 </div>
 </section>
 );
};

export default FeaturesSection;
