import { Link } from"react-router-dom";
import {
 QrCode, Phone, BarChart3, Target, DollarSign, Users,
 Smartphone, Bell, Globe, Shield, Zap, ArrowRight,
 CheckCircle, Car
} from"lucide-react";
import MarketingLayout from"@/components/layout/MarketingLayout";
import { brand } from"@/lib/brand";
import"../pages/Homepage.css";

const heroFeatures = [
 {
 icon: QrCode,
 title:"QR Lead Capture",
 desc:"Generate trackable QR codes for flyers, vehicles, events, and retail locations. Every scan becomes an attributed lead — with GPS, timestamp, and campaign source automatically captured.",
 highlights: ["Unlimited QR codes","GPS tracking per scan","Campaign attribution","Branded short links"],
 },
 {
 icon: Phone,
 title:"AI Call Bot",
 desc:"Retell-powered voice AI qualifies prospects 24/7. Natural conversations are transcribed, scored, and converted into leads — before your agents even pick up the phone.",
 highlights: ["24/7 automated calling","Natural voice AI","Full transcription","Auto lead creation"],
 },
 {
 icon: Target,
 title:"Campaign Management",
 desc:"Launch multi-channel campaigns that span social media, physical flyers, vehicle wraps, and digital ads. Design custom landing pages and track every touchpoint from one dashboard.",
 highlights: ["Multi-channel campaigns","Custom landing pages","A/B testing","ROI tracking"],
 },
 {
 icon: BarChart3,
 title:"Real-time Analytics",
 desc:"Live dashboards show conversion funnels, lead sources, agent performance, and campaign ROI. Know exactly what's working and where to double down — in real time.",
 highlights: ["Live dashboards","Conversion funnels","Agent leaderboards","Source attribution"],
 },
 {
 icon: DollarSign,
 title:"Commission Tracking",
 desc:"Automated commission calculations with transparent payout history. Agents see exactly what they've earned, admins approve with one click, and everyone stays aligned.",
 highlights: ["Auto-calculated payouts","Approval workflows","Payout history","Custom commission rules"],
 },
 {
 icon: Users,
 title:"Fleet & Team Management",
 desc:"Manage agent teams, assign territories, track vehicle deployments with GPS, and monitor field operations. Built for agencies running 10 to 500+ agents across Singapore.",
 highlights: ["Agent territories","Vehicle GPS tracking","Team hierarchies","Performance monitoring"],
 },
];

const additionalFeatures = [
 { icon: Smartphone, title:"Mobile-First", desc:"Every feature works flawlessly on mobile. Agents capture leads in the field without ever touching a laptop."},
 { icon: Bell, title:"Instant Notifications", desc:"Push and email alerts the moment a new lead comes in. Never miss a hot prospect."},
 { icon: Globe, title:"Multi-Language", desc:"Support for English, Mandarin, and Malay — matching Singapore's multilingual market."},
 { icon: Shield, title:"PDPA Compliant", desc:"Built-in consent management and data handling aligned with Singapore's Personal Data Protection Act."},
 { icon: Car, title:"Vehicle QR Network", desc:"Deploy QR codes on Grab cars, taxis, and private hire vehicles. Passive lead gen at scale."},
 { icon: Zap, title:"Webhook Integrations", desc:`Connect ${brand.name} to your CRM, email tools, or custom systems via real-time webhook events.`},
];

export default function Features() {
 return (
 <MarketingLayout>
 {/* Hero */}
 <section className="mktr-section" style={{ paddingTop:"5rem"}}>
 <div className="mktr-section-container" style={{ textAlign:"center"}}>
 <p className="mktr-section-eyebrow mktr-reveal">Platform Features</p>
 <h1 className="mktr-hero-title mktr-reveal mktr-reveal-delay-1" style={{ marginBottom:"1.5rem"}}>
 Built for Agents<br />
 Who <span className="accent">Close Deals.</span>
 </h1>
 <p className="mktr-hero-subtitle mktr-reveal mktr-reveal-delay-2">
 Every feature is purpose-built for Singapore's insurance and property agents.
 From first scan to signed policy — {brand.name} has you covered.
 </p>
 </div>
 </section>

 {/* Main Features — alternating layout */}
 <section className="mktr-section mktr-section-alt" style={{ paddingTop:"2rem"}}>
 <div className="mktr-section-container">
 {heroFeatures.map((f, i) => (
 <div
 key={f.title}
 className="mktr-reveal" style={{
 display:"grid",
 gridTemplateColumns:"1fr 1fr",
 gap:"4rem",
 alignItems:"center",
 marginBottom: i < heroFeatures.length - 1 ?"6rem": 0,
 direction: i % 2 === 1 ?"rtl":"ltr",
 }}
 >
 {/* Text side */}
 <div style={{ direction:"ltr"}}>
 <div
 className="mktr-feature-icon" style={{ marginBottom:"1.5rem"}}
 >
 <f.icon className="w-5 h-5"/>
 </div>
 <h3
 style={{
 fontFamily:"var(--heading-font)",
 fontSize:"1.75rem",
 fontWeight: 700,
 color:"var(--mktr-text)",
 marginBottom:"1rem",
 letterSpacing:"-0.01em",
 }}
 >
 {f.title}
 </h3>
 <p
 style={{
 fontFamily:"var(--body-font)",
 fontSize:"1.05rem",
 color:"var(--mktr-text-muted)",
 lineHeight: 1.7,
 fontWeight: 300,
 marginBottom:"1.5rem",
 }}
 >
 {f.desc}
 </p>
 <ul style={{ listStyle:"none", padding: 0, margin: 0 }}>
 {f.highlights.map((h) => (
 <li
 key={h}
 style={{
 display:"flex",
 alignItems:"center",
 gap:"0.6rem",
 padding:"0.4rem 0",
 fontFamily:"var(--body-font)",
 fontSize:"0.9rem",
 color:"var(--mktr-text-muted)",
 fontWeight: 300,
 }}
 >
 <CheckCircle
 className="w-4 h-4" style={{ color:"var(--mktr-accent)", flexShrink: 0 }}
 />
 {h}
 </li>
 ))}
 </ul>
 </div>

 {/* Visual side — gradient card */}
 <div style={{ direction:"ltr"}}>
 <div
 style={{
 background:"var(--mktr-bg-card)",
 border:"1px solid var(--mktr-border)",
 borderRadius: 20,
 padding:"4rem 3rem",
 display:"flex",
 alignItems:"center",
 justifyContent:"center",
 minHeight: 280,
 position:"relative",
 overflow:" hidden",
 }}
 >
 <div
 style={{
 position:"absolute",
 inset: 0,
 background:
"radial-gradient(circle at 30% 40%, rgba(0,194,255,0.08), transparent 60%)",
 }}
 />
 <f.icon
 className="w-20 h-20" style={{
 color:"var(--mktr-accent)",
 opacity: 0.2,
 position:"relative",
 }}
 />
 </div>
 </div>
 </div>
 ))}
 </div>
 </section>

 {/* Additional Features Grid */}
 <section className="mktr-section">
 <div className="mktr-section-container">
 <p className="mktr-section-eyebrow mktr-reveal">And More</p>
 <h2 className="mktr-section-title mktr-reveal mktr-reveal-delay-1">
 Everything Else You Need
 </h2>
 <p className="mktr-section-subtitle mktr-reveal mktr-reveal-delay-2">
 The details that make {brand.name} the complete platform for modern sales professionals.
 </p>

 <div className="mktr-features-grid">
 {additionalFeatures.map((f, i) => (
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

 {/* CTA */}
 <section className="mktr-cta-section">
 <div className="mktr-cta-glow"/>
 <div className="mktr-cta-content">
 <h2 className="mktr-section-title mktr-reveal">
 Ready to See It in Action?
 </h2>
 <p className="mktr-section-subtitle mktr-reveal mktr-reveal-delay-1" style={{ marginBottom:"2rem"}}>
 Start free — no credit card required.
 </p>
 <div className="flex flex-wrap gap-4 justify-center mktr-reveal mktr-reveal-delay-2">
 <Link to="/AdminDashboard" className="mktr-hero-cta">
 Get Started Free
 <ArrowRight className="w-4 h-4"/>
 </Link>
 <Link to="/Contact" className="mktr-hero-cta-secondary">
 Talk to Sales
 </Link>
 </div>
 </div>
 </section>

 {/* Responsive override for alternating grid */}
 <style>{`
 @media (max-width: 768px) {
 .mktr-section-container > div[style*="grid-template-columns"] {
 grid-template-columns: 1fr !important;
 direction: ltr !important;
 gap: 2rem !important;
 margin-bottom: 4rem !important;
 }
 }
 `}</style>
 </MarketingLayout>
 );
}
