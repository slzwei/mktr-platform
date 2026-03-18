import { Link } from "react-router-dom";

const plans = [
  {
    name: "Starter",
    price: "Free",
    period: "Forever",
    featured: false,
    features: [
      "Up to 50 leads/month",
      "1 active campaign",
      "QR code generation",
      "Basic analytics",
      "Mobile dashboard",
    ],
    cta: "Get Started",
    ctaStyle: "mktr-pricing-cta mktr-pricing-cta-outline",
  },
  {
    name: "Pro",
    price: "$49",
    period: "/month per agent",
    featured: true,
    badge: "Most Popular",
    features: [
      "Unlimited leads",
      "Unlimited campaigns",
      "AI Call Bot (Retell)",
      "Smart lead routing",
      "Commission tracking",
      "Real-time analytics",
      "Priority support",
    ],
    cta: "Start Pro Trial",
    ctaStyle: "mktr-pricing-cta mktr-pricing-cta-primary",
  },
  {
    name: "Enterprise",
    price: "Custom",
    period: "For teams of 10+",
    featured: false,
    features: [
      "Everything in Pro",
      "Fleet management",
      "Custom integrations",
      "Dedicated account manager",
      "SLA guarantee",
      "White-label options",
    ],
    cta: "Contact Sales",
    ctaStyle: "mktr-pricing-cta mktr-pricing-cta-outline",
  },
];

const PricingSection = () => {
  return (
    <section className="mktr-section mktr-section-alt">
      <div className="mktr-section-container">
        <p className="mktr-section-eyebrow mktr-reveal">Pricing</p>
        <h2 className="mktr-section-title mktr-reveal mktr-reveal-delay-1">
          Simple, Transparent Pricing
        </h2>
        <p className="mktr-section-subtitle mktr-reveal mktr-reveal-delay-2">
          Start free. Scale as you grow. No hidden fees.
        </p>

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
              <ul className="mktr-pricing-features">
                {plan.features.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
              <Link to="/AdminDashboard" className={plan.ctaStyle}>
                {plan.cta}
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default PricingSection;
