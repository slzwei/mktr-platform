import { useState } from"react";
import { Link } from"react-router-dom";
import { ArrowRight, Check } from"lucide-react";
import { brand } from"@/lib/brand";
import { apiClient } from"@/api/client";
import { initPixel, trackSubscribe } from"@/lib/metaPixel";

const CTASection = () => {
 const [email, setEmail] = useState("");
 const [status, setStatus] = useState("idle"); // idle | loading | success | error
 const [error, setError] = useState("");

 const handleSubmit = async (e) => {
 e.preventDefault();
 if (!email || status === "loading") return;

 setStatus("loading");
 setError("");

 try {
 // Success is driven by the backend persisting the signup (a 2xx) — not by
 // whether a notification email was sent.
 await apiClient.post("/waitlist", { email: email.trim(), source:"homepage"});
 setStatus("success");

 // Fire a dedicated Subscribe event (prod + pixel configured only), distinct
 // from the lead-capture Lead event so waitlist signups don't skew conversions.
 const pixelId = import.meta.env.VITE_META_PIXEL_ID;
 if (pixelId && import.meta.env.PROD) {
 initPixel(pixelId);
 trackSubscribe();
 }
 } catch (err) {
 setStatus("error");
 setError(err?.message ||"Something went wrong. Please try again.");
 }
 };

 return (
 <section id="waitlist" className="mktr-cta-section">
 <div className="mktr-cta-glow"/>

 <div className="mktr-cta-content">
 <p className="mktr-section-eyebrow mktr-reveal">Join the Waitlist</p>
 <h2 className="mktr-section-title mktr-reveal mktr-reveal-delay-1">
 Be first in line
 </h2>
 <p className="mktr-section-subtitle mktr-reveal mktr-reveal-delay-2" style={{ marginBottom: '1.5rem' }}>
 We're rolling out to a limited number of {brand.name} agents. Join the
 waitlist and we'll reach out when a spot opens.
 </p>

 {status === "success" ? (
 <div
 className="mktr-reveal mktr-reveal-delay-3"
 role="status"
 aria-live="polite"
 style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', color: 'var(--mktr-text)', fontFamily: 'var(--body-font)' }}
 >
 <Check className="w-5 h-5" aria-hidden="true" />
 <span>You're on the list — we'll be in touch.</span>
 </div>
 ) : (
 <>
 <form
 className="mktr-email-form mktr-reveal mktr-reveal-delay-3" onSubmit={handleSubmit}
 noValidate
 >
 <label htmlFor="waitlist-email" className="sr-only">Email address</label>
 <input
 id="waitlist-email" type="email" name="email" autoComplete="email" className="mktr-email-input" placeholder="Enter your email" value={email}
 onChange={(e) => setEmail(e.target.value)}
 required
 disabled={status === "loading"}
 aria-invalid={status === "error"}
 aria-describedby="waitlist-help"
 />
 <button type="submit" className="mktr-email-submit" disabled={status === "loading"}>
 {status === "loading" ?"Joining…":"Join Waitlist"}
 {status !== "loading" && <ArrowRight className="w-4 h-4 inline ml-2" aria-hidden="true"/>}
 </button>
 </form>

 <p
 id="waitlist-error" role="alert" aria-live="assertive" style={{
 minHeight: '1.1rem',
 fontFamily: 'var(--body-font)',
 fontSize: '0.8rem',
 color: '#e57373',
 marginTop: '0.5rem',
 }}
 >
 {status === "error" ? error :""}
 </p>

 <p
 id="waitlist-help" className="mktr-reveal mktr-reveal-delay-4" style={{
 fontFamily: 'var(--body-font)',
 fontSize: '0.8rem',
 color: 'var(--mktr-text-dim)',
 marginTop: '0.5rem',
 }}
 >
 By joining, you agree to be contacted about {brand.name}. See our{" "}
 <Link to={brand.pdpaUrl} style={{ textDecoration: 'underline' }}>Privacy Policy</Link>.
 </p>
 </>
 )}
 </div>
 </section>
 );
};

export default CTASection;
