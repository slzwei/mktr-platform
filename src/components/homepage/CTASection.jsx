import { useState } from "react";
import { ArrowRight } from "lucide-react";

const CTASection = () => {
  const [email, setEmail] = useState("");

  const handleSubmit = (e) => {
    e.preventDefault();
    if (email) {
      window.location.href = `/AdminDashboard?email=${encodeURIComponent(email)}`;
    }
  };

  return (
    <section className="mktr-cta-section">
      <div className="mktr-cta-glow" />

      <div className="mktr-cta-content">
        <p className="mktr-section-eyebrow mktr-reveal">Get Started Today</p>
        <h2 className="mktr-section-title mktr-reveal mktr-reveal-delay-1">
          Ready to 3x<br />Your Pipeline?
        </h2>
        <p className="mktr-section-subtitle mktr-reveal mktr-reveal-delay-2" style={{ marginBottom: '1rem' }}>
          Join hundreds of Singapore's top insurance agents already using MKTR to close more deals.
        </p>

        <form
          className="mktr-email-form mktr-reveal mktr-reveal-delay-3"
          onSubmit={handleSubmit}
        >
          <input
            type="email"
            className="mktr-email-input"
            placeholder="Enter your email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <button type="submit" className="mktr-email-submit">
            Start Free
            <ArrowRight className="w-4 h-4 inline ml-2" />
          </button>
        </form>

        <p
          className="mktr-reveal mktr-reveal-delay-4"
          style={{
            fontFamily: 'var(--body-font)',
            fontSize: '0.8rem',
            color: 'var(--mktr-text-dim)',
            marginTop: '1rem',
          }}
        >
          No credit card required. Free plan available.
        </p>
      </div>
    </section>
  );
};

export default CTASection;
