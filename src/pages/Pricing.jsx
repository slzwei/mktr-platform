import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, ChevronDown } from "lucide-react";
import MarketingLayout from "@/components/layout/MarketingLayout";
import "../pages/Homepage.css";

const plans = [
  {
    name: "Starter",
    price: "Free",
    period: "Forever",
    desc: "Perfect for individual agents just getting started with lead generation.",
    featured: false,
    features: [
      "Up to 50 leads/month",
      "1 active campaign",
      "QR code generation",
      "Basic analytics dashboard",
      "Mobile-friendly interface",
      "Email support",
    ],
    cta: "Get Started",
    ctaStyle: "mktr-pricing-cta mktr-pricing-cta-outline",
  },
  {
    name: "Pro",
    price: "$49",
    period: "/month per agent",
    desc: "For serious agents who want AI-powered lead gen and full pipeline visibility.",
    featured: true,
    badge: "Most Popular",
    features: [
      "Unlimited leads",
      "Unlimited campaigns",
      "AI Call Bot (Retell)",
      "Smart lead routing",
      "Commission tracking",
      "Real-time analytics",
      "QR vehicle network access",
      "Webhook integrations",
      "Priority support",
    ],
    cta: "Start 14-Day Trial",
    ctaStyle: "mktr-pricing-cta mktr-pricing-cta-primary",
  },
  {
    name: "Enterprise",
    price: "Custom",
    period: "For agencies of 10+",
    desc: "For agencies and teams that need full control, white-labelling, and dedicated support.",
    featured: false,
    features: [
      "Everything in Pro",
      "Fleet & vehicle management",
      "Custom integrations & API",
      "Dedicated account manager",
      "SLA guarantee (99.9%)",
      "White-label options",
      "Custom reporting",
      "Team hierarchy & roles",
      "Onboarding & training",
    ],
    cta: "Contact Sales",
    ctaStyle: "mktr-pricing-cta mktr-pricing-cta-outline",
  },
];

const faqs = [
  {
    q: "Can I switch plans later?",
    a: "Absolutely. You can upgrade or downgrade anytime. If you upgrade mid-cycle, we'll prorate the difference. Downgrades take effect at the next billing date.",
  },
  {
    q: "Is there a contract or lock-in?",
    a: "No contracts, no lock-in. All plans are month-to-month. Cancel anytime from your dashboard settings.",
  },
  {
    q: "What happens when I hit my lead limit on Starter?",
    a: "You'll get a notification when you're close. Once you hit 50 leads, new leads are queued until the next month or you upgrade to Pro for unlimited leads.",
  },
  {
    q: "Do you offer discounts for annual billing?",
    a: "Yes — annual billing on Pro is $39/month per agent (20% savings). Contact us for annual Enterprise pricing.",
  },
  {
    q: "Is my data secure and PDPA compliant?",
    a: "Yes. All data is encrypted at rest and in transit. We are fully compliant with Singapore's Personal Data Protection Act. See our Privacy Policy for details.",
  },
  {
    q: "Can I try Pro features before committing?",
    a: "Yes. Pro comes with a 14-day free trial — no credit card required. You get full access to every Pro feature during the trial.",
  },
];

function FAQ() {
  const [open, setOpen] = useState(null);

  return (
    <div style={{ maxWidth: 700, margin: "0 auto" }}>
      {faqs.map((faq, i) => (
        <div
          key={i}
          className="mktr-reveal"
          style={{
            borderBottom: "1px solid var(--mktr-border)",
          }}
        >
          <button
            onClick={() => setOpen(open === i ? null : i)}
            style={{
              width: "100%",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "1.25rem 0",
              background: "none",
              border: "none",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <span
              style={{
                fontFamily: "var(--heading-font)",
                fontSize: "1.05rem",
                fontWeight: 500,
                color: "var(--mktr-text)",
              }}
            >
              {faq.q}
            </span>
            <ChevronDown
              className="w-5 h-5 flex-shrink-0 ml-4 transition-transform duration-200"
              style={{
                color: "var(--mktr-text-dim)",
                transform: open === i ? "rotate(180deg)" : "rotate(0deg)",
              }}
            />
          </button>
          <div
            style={{
              maxHeight: open === i ? 200 : 0,
              overflow: "hidden",
              transition: "max-height 0.3s ease",
            }}
          >
            <p
              style={{
                fontFamily: "var(--body-font)",
                fontSize: "0.95rem",
                color: "var(--mktr-text-muted)",
                lineHeight: 1.7,
                fontWeight: 300,
                paddingBottom: "1.25rem",
              }}
            >
              {faq.a}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function Pricing() {
  return (
    <MarketingLayout>
      {/* Hero */}
      <section className="mktr-section" style={{ paddingTop: "5rem" }}>
        <div className="mktr-section-container" style={{ textAlign: "center" }}>
          <p className="mktr-section-eyebrow mktr-reveal">Pricing</p>
          <h1 className="mktr-hero-title mktr-reveal mktr-reveal-delay-1" style={{ marginBottom: "1.5rem" }}>
            Simple, <span className="accent">Transparent</span><br />
            Pricing
          </h1>
          <p className="mktr-hero-subtitle mktr-reveal mktr-reveal-delay-2">
            Start free. Scale as you grow. No hidden fees, no surprises.
          </p>
        </div>
      </section>

      {/* Pricing Cards */}
      <section className="mktr-section mktr-section-alt" style={{ paddingTop: "2rem" }}>
        <div className="mktr-section-container">
          <div className="mktr-pricing-grid">
            {plans.map((plan, i) => (
              <div
                key={plan.name}
                className={`mktr-pricing-card mktr-reveal mktr-reveal-delay-${i + 1} ${plan.featured ? "featured" : ""}`}
              >
                {plan.badge && (
                  <div className="mktr-pricing-badge">{plan.badge}</div>
                )}
                <h3 className="mktr-pricing-name">{plan.name}</h3>
                <div className="mktr-pricing-price">{plan.price}</div>
                <div className="mktr-pricing-period">{plan.period}</div>
                <p
                  style={{
                    fontFamily: "var(--body-font)",
                    fontSize: "0.9rem",
                    color: "var(--mktr-text-muted)",
                    lineHeight: 1.6,
                    fontWeight: 300,
                    marginBottom: "2rem",
                    textAlign: "center",
                  }}
                >
                  {plan.desc}
                </p>
                <ul className="mktr-pricing-features">
                  {plan.features.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
                <Link to={plan.name === "Enterprise" ? "/Contact" : "/AdminDashboard"} className={plan.ctaStyle}>
                  {plan.cta}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="mktr-section">
        <div className="mktr-section-container">
          <p className="mktr-section-eyebrow mktr-reveal">FAQ</p>
          <h2 className="mktr-section-title mktr-reveal mktr-reveal-delay-1">
            Frequently Asked Questions
          </h2>
          <p className="mktr-section-subtitle mktr-reveal mktr-reveal-delay-2">
            Everything you need to know about MKTR pricing.
          </p>
          <FAQ />
        </div>
      </section>

      {/* CTA */}
      <section className="mktr-cta-section">
        <div className="mktr-cta-glow" />
        <div className="mktr-cta-content">
          <h2 className="mktr-section-title mktr-reveal">
            Still Have Questions?
          </h2>
          <p className="mktr-section-subtitle mktr-reveal mktr-reveal-delay-1" style={{ marginBottom: "2rem" }}>
            Our team is here to help you find the right plan.
          </p>
          <div className="flex flex-wrap gap-4 justify-center mktr-reveal mktr-reveal-delay-2">
            <Link to="/Contact" className="mktr-hero-cta">
              Talk to Sales
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>
    </MarketingLayout>
  );
}
