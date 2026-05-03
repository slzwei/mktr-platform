import { Link } from"react-router-dom";
import { ArrowRight, Target, Users, Zap, Globe } from"lucide-react";
import MarketingLayout from"@/components/layout/MarketingLayout";
import"../pages/Homepage.css";

const values = [
 {
 icon: Target,
 title:"Agent-First",
 desc:"Everything we build starts with one question: does this help an agent close more deals? If not, we don't build it.",
 },
 {
 icon: Zap,
 title:"Speed to Lead",
 desc:"In sales, the first responder wins. Our systems are designed to put leads in agents' hands within seconds, not hours.",
 },
 {
 icon: Users,
 title:"Built for Teams",
 desc:"Whether you're a solo agent or a 500-person agency, MKTR scales with you. Team tools aren't an afterthought — they're core.",
 },
 {
 icon: Globe,
 title:"Singapore DNA",
 desc:"We're built in Singapore, for Singapore. Every feature respects local norms — from NRIC validation to PDPA compliance to multilingual support.",
 },
];

const milestones = [
 { year:"2024", event:"MKTR founded in Singapore"},
 { year:"2024", event:"First insurance agency onboarded"},
 { year:"2025", event:"AI Call Bot (Retell) launched"},
 { year:"2025", event:"QR vehicle network live across Singapore"},
 { year:"2025", event:"500+ active agents on platform"},
 { year:"2026", event:"Expanding to property agents"},
];

export default function About() {
 return (
 <MarketingLayout>
 {/* Hero */}
 <section className="mktr-section" style={{ paddingTop:"5rem"}}>
 <div className="mktr-section-container" style={{ textAlign:"center"}}>
 <p className="mktr-section-eyebrow mktr-reveal">About MKTR</p>
 <h1 className="mktr-hero-title mktr-reveal mktr-reveal-delay-1" style={{ marginBottom:"1.5rem"}}>
 We Help Sales Pros<br />
 <span className="accent">Win More Clients.</span>
 </h1>
 <p className="mktr-hero-subtitle mktr-reveal mktr-reveal-delay-2" style={{ maxWidth: 650 }}>
 MKTR is Singapore's AI-powered lead generation platform built exclusively for
 insurance agents, financial advisors, and property agents.
 </p>
 </div>
 </section>

 {/* Story */}
 <section className="mktr-section mktr-section-alt">
 <div className="mktr-section-container">
 <div
 style={{
 display:"grid",
 gridTemplateColumns:"1fr 1fr",
 gap:"4rem",
 alignItems:"center",
 }}
 >
 <div className="mktr-reveal">
 <p className="mktr-section-eyebrow" style={{ textAlign:"left"}}>
 Our Story
 </p>
 <h2
 style={{
 fontFamily:"var(--heading-font)",
 fontSize:"clamp(1.75rem, 3vw, 2.5rem)",
 fontWeight: 700,
 color:"var(--mktr-text)",
 lineHeight: 1.2,
 marginBottom:"1.5rem",
 }}
 >
 Born from the streets of Singapore
 </h2>
 <p
 style={{
 fontFamily:"var(--body-font)",
 fontSize:"1.05rem",
 color:"var(--mktr-text-muted)",
 lineHeight: 1.8,
 fontWeight: 300,
 marginBottom:"1.25rem",
 }}
 >
 We started MKTR because we saw a gap: Singapore's best sales professionals were
 still relying on cold calls and referrals. Meanwhile, leads were everywhere — at
 MRT stations, in shopping malls, on the roads — but there was no system to
 capture them.
 </p>
 <p
 style={{
 fontFamily:"var(--body-font)",
 fontSize:"1.05rem",
 color:"var(--mktr-text-muted)",
 lineHeight: 1.8,
 fontWeight: 300,
 marginBottom:"1.25rem",
 }}
 >
 We built MKTR to bridge that gap — combining physical QR lead capture,
 AI-powered voice bots, and digital campaigns into one platform that actually
 works for the way agents sell in Singapore.
 </p>
 <p
 style={{
 fontFamily:"var(--body-font)",
 fontSize:"1.05rem",
 color:"var(--mktr-text-muted)",
 lineHeight: 1.8,
 fontWeight: 300,
 }}
 >
 Today, hundreds of agents across insurance, financial advisory, and soon property
 use MKTR daily to fill their pipelines and close more deals.
 </p>
 </div>

 {/* Visual */}
 <div className="mktr-reveal mktr-reveal-delay-2">
 <div
 style={{
 background:"var(--mktr-bg-card)",
 border:"1px solid var(--mktr-border)",
 borderRadius: 20,
 padding:"3rem 2.5rem",
 position:"relative",
 overflow:" hidden",
 }}
 >
 <div
 style={{
 position:"absolute",
 inset: 0,
 background:
"radial-gradient(circle at 70% 30%, rgba(0,194,255,0.06), transparent 60%)",
 }}
 />
 <h3
 style={{
 fontFamily:"var(--mono-font)",
 fontSize:"0.7rem",
 letterSpacing:"3px",
 textTransform:"uppercase",
 color:"var(--mktr-accent)",
 marginBottom:"2rem",
 position:"relative",
 }}
 >
 Milestones
 </h3>
 {milestones.map((m, i) => (
 <div
 key={i}
 style={{
 display:"flex",
 gap:"1.5rem",
 alignItems:"baseline",
 padding:"0.75rem 0",
 borderBottom:
 i < milestones.length - 1
 ?"1px solid var(--mktr-border)" :"none",
 position:"relative",
 }}
 >
 <span
 style={{
 fontFamily:"var(--mono-font)",
 fontSize:"0.8rem",
 color:"var(--mktr-accent)",
 flexShrink: 0,
 fontWeight: 500,
 }}
 >
 {m.year}
 </span>
 <span
 style={{
 fontFamily:"var(--body-font)",
 fontSize:"0.95rem",
 color:"var(--mktr-text-muted)",
 fontWeight: 300,
 }}
 >
 {m.event}
 </span>
 </div>
 ))}
 </div>
 </div>
 </div>

 {/* Responsive override */}
 <style>{`
 @media (max-width: 768px) {
 .mktr-section-container > div[style*="grid-template-columns: 1fr 1fr"] {
 grid-template-columns: 1fr !important;
 gap: 2rem !important;
 }
 }
 `}</style>
 </div>
 </section>

 {/* Values */}
 <section className="mktr-section">
 <div className="mktr-section-container">
 <p className="mktr-section-eyebrow mktr-reveal">Our Values</p>
 <h2 className="mktr-section-title mktr-reveal mktr-reveal-delay-1">
 What We Stand For
 </h2>
 <p className="mktr-section-subtitle mktr-reveal mktr-reveal-delay-2">
 These aren't aspirations — they're the filters we run every decision through.
 </p>

 <div className="mktr-features-grid" style={{ gridTemplateColumns:"repeat(2, 1fr)"}}>
 {values.map((v, i) => (
 <div
 key={v.title}
 className={`mktr-feature-card mktr-reveal mktr-reveal-delay-${i + 1}`}
 >
 <div className="mktr-feature-icon">
 <v.icon className="w-5 h-5"/>
 </div>
 <h3 className="mktr-feature-title">{v.title}</h3>
 <p className="mktr-feature-desc">{v.desc}</p>
 </div>
 ))}
 </div>

 <style>{`
 @media (max-width: 768px) {
 .mktr-features-grid[style*="repeat(2, 1fr)"] {
 grid-template-columns: 1fr !important;
 }
 }
 `}</style>
 </div>
 </section>

 {/* Stats */}
 <section className="mktr-section mktr-section-alt">
 <div className="mktr-section-container">
 <div
 className="mktr-reveal" style={{
 display:"grid",
 gridTemplateColumns:"repeat(4, 1fr)",
 gap:"2rem",
 textAlign:"center",
 }}
 >
 {[
 { num:"500+", label:"Active Agents"},
 { num:"10,000+", label:"Leads Generated"},
 { num:"3x", label:"Avg Conversion Lift"},
 { num:"24/7", label:"AI Availability"},
 ].map((s) => (
 <div key={s.label}>
 <div className="mktr-proof-number">{s.num}</div>
 <div className="mktr-proof-label">{s.label}</div>
 </div>
 ))}
 </div>
 <style>{`
 @media (max-width: 768px) {
 .mktr-section-container > div[style*="repeat(4, 1fr)"] {
 grid-template-columns: repeat(2, 1fr) !important;
 }
 }
 `}</style>
 </div>
 </section>

 {/* CTA */}
 <section className="mktr-cta-section">
 <div className="mktr-cta-glow"/>
 <div className="mktr-cta-content">
 <h2 className="mktr-section-title mktr-reveal">
 Ready to Join Us?
 </h2>
 <p className="mktr-section-subtitle mktr-reveal mktr-reveal-delay-1" style={{ marginBottom:"2rem"}}>
 Start generating leads today — it's free to get started.
 </p>
 <div className="flex flex-wrap gap-4 justify-center mktr-reveal mktr-reveal-delay-2">
 <Link to="/AdminDashboard" className="mktr-hero-cta">
 Get Started Free
 <ArrowRight className="w-4 h-4"/>
 </Link>
 <Link to="/Contact" className="mktr-hero-cta-secondary">
 Contact Us
 </Link>
 </div>
 </div>
 </section>
 </MarketingLayout>
 );
}
