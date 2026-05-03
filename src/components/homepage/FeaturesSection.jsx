import { QrCode, Phone, BarChart3, Target, DollarSign, Users } from"lucide-react";

const features = [
 {
 icon: QrCode,
 title:"QR Lead Capture",
 desc:"Generate trackable QR codes for flyers, vehicles, and events. Every scan becomes a lead with full attribution.",
 },
 {
 icon: Phone,
 title:"AI Call Bot",
 desc:"Retell-powered voice AI qualifies prospects around the clock. Conversations are transcribed and leads auto-created.",
 },
 {
 icon: Target,
 title:"Campaign Management",
 desc:"Launch multi-channel campaigns across social, physical, and digital. Track ROI from a single dashboard.",
 },
 {
 icon: BarChart3,
 title:"Real-time Analytics",
 desc:"Live dashboards show conversion rates, lead sources, and agent performance so you can double down on what works.",
 },
 {
 icon: DollarSign,
 title:"Commission Tracking",
 desc:"Automated commission calculations, payout history, and transparent reporting for every deal closed.",
 },
 {
 icon: Users,
 title:"Fleet Management",
 desc:"Manage agent teams, assign territories, track vehicle deployments, and monitor field performance in real time.",
 },
];

const FeaturesSection = () => {
 return (
 <section id="features" className="mktr-section">
 <div className="mktr-section-container">
 <p className="mktr-section-eyebrow mktr-reveal">Platform Features</p>
 <h2 className="mktr-section-title mktr-reveal mktr-reveal-delay-1">
 Everything You Need to<br />Scale Your Pipeline
 </h2>
 <p className="mktr-section-subtitle mktr-reveal mktr-reveal-delay-2">
 Purpose-built tools for Singapore's insurance agents — from first touch to closed deal.
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
