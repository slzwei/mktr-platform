import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { apiClient } from "@/api/client";
import { MapPin, Send, CheckCircle, MessageCircle } from "lucide-react";
import MarketingLayout from "@/components/layout/MarketingLayout";
import "../pages/Homepage.css";

export default function Contact() {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    company: "",
    userType: "",
    message: "",
  });
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    const messageLength = formData.message?.trim().length || 0;
    if (messageLength < 10) {
      setError("Please enter at least 10 characters in your message.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      await apiClient.post("/contact", formData);
      setSubmitted(true);
    } catch (err) {
      const apiMessage = err?.message || "";
      if (apiMessage.includes("length must be at least 10")) {
        setError("Please enter at least 10 characters in your message.");
      } else {
        setError(
          "There was an issue sending your message. Please try again later."
        );
      }
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const inputStyle = {
    background: "var(--mktr-bg-card)",
    border: "1px solid var(--mktr-border)",
    color: "var(--mktr-text)",
    borderRadius: 12,
    fontFamily: "var(--body-font)",
  };

  return (
    <MarketingLayout>
      {/* Hero */}
      <section className="mktr-section" style={{ paddingTop: "5rem", paddingBottom: "3rem" }}>
        <div className="mktr-section-container" style={{ textAlign: "center" }}>
          <p className="mktr-section-eyebrow mktr-reveal">Contact Us</p>
          <h1
            className="mktr-hero-title mktr-reveal mktr-reveal-delay-1"
            style={{ marginBottom: "1.5rem" }}
          >
            Let's Talk <span className="accent">Business.</span>
          </h1>
          <p className="mktr-hero-subtitle mktr-reveal mktr-reveal-delay-2">
            Whether you're an individual agent or running a 500-person team,
            we'd love to hear from you. We typically respond within one business day.
          </p>
        </div>
      </section>

      {/* Contact Grid */}
      <section className="mktr-section mktr-section-alt" style={{ paddingTop: "2rem" }}>
        <div className="mktr-section-container">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1.2fr 0.8fr",
              gap: "3rem",
              alignItems: "start",
            }}
          >
            {/* Form */}
            <div className="mktr-reveal">
              {submitted ? (
                <div
                  style={{
                    background: "var(--mktr-bg-card)",
                    border: "1px solid var(--mktr-border)",
                    borderRadius: 20,
                    padding: "4rem 3rem",
                    textAlign: "center",
                  }}
                >
                  <CheckCircle
                    className="w-16 h-16 mx-auto mb-4"
                    style={{ color: "#22c55e" }}
                  />
                  <h3
                    style={{
                      fontFamily: "var(--heading-font)",
                      fontSize: "1.5rem",
                      fontWeight: 700,
                      color: "var(--mktr-text)",
                      marginBottom: "0.75rem",
                    }}
                  >
                    Message Sent!
                  </h3>
                  <p
                    style={{
                      fontFamily: "var(--body-font)",
                      fontSize: "1rem",
                      color: "var(--mktr-text-muted)",
                      fontWeight: 300,
                    }}
                  >
                    Thank you for reaching out. We'll get back to you within 24 hours.
                  </p>
                </div>
              ) : (
                <div
                  style={{
                    background: "var(--mktr-bg-card)",
                    border: "1px solid var(--mktr-border)",
                    borderRadius: 20,
                    padding: "2.5rem",
                  }}
                >
                  <h3
                    style={{
                      fontFamily: "var(--mono-font)",
                      fontSize: "0.7rem",
                      letterSpacing: "3px",
                      textTransform: "uppercase",
                      color: "var(--mktr-accent)",
                      marginBottom: "2rem",
                    }}
                  >
                    Send Us a Message
                  </h3>
                  <form onSubmit={handleSubmit} className="space-y-5">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label
                          style={{
                            display: "block",
                            fontFamily: "var(--body-font)",
                            fontSize: "0.85rem",
                            color: "var(--mktr-text-muted)",
                            marginBottom: "0.5rem",
                            fontWeight: 400,
                          }}
                        >
                          Full Name *
                        </label>
                        <Input
                          name="name"
                          value={formData.name}
                          onChange={handleChange}
                          required
                          placeholder="Your full name"
                          style={inputStyle}
                        />
                      </div>
                      <div>
                        <label
                          style={{
                            display: "block",
                            fontFamily: "var(--body-font)",
                            fontSize: "0.85rem",
                            color: "var(--mktr-text-muted)",
                            marginBottom: "0.5rem",
                            fontWeight: 400,
                          }}
                        >
                          Company
                        </label>
                        <Input
                          name="company"
                          value={formData.company}
                          onChange={handleChange}
                          placeholder="Your company"
                          style={inputStyle}
                        />
                      </div>
                    </div>

                    <div>
                      <label
                        style={{
                          display: "block",
                          fontFamily: "var(--body-font)",
                          fontSize: "0.85rem",
                          color: "var(--mktr-text-muted)",
                          marginBottom: "0.5rem",
                          fontWeight: 400,
                        }}
                      >
                        I am a...
                      </label>
                      <Select
                        value={formData.userType}
                        onValueChange={(val) =>
                          setFormData({ ...formData, userType: val })
                        }
                      >
                        <SelectTrigger style={{ ...inputStyle, width: "100%" }}>
                          <SelectValue placeholder="Select one" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="insurance_agent">Insurance Agent</SelectItem>
                          <SelectItem value="property_agent">Property Agent</SelectItem>
                          <SelectItem value="financial_advisor">Financial Advisor</SelectItem>
                          <SelectItem value="agency_manager">Agency Manager</SelectItem>
                          <SelectItem value="fleet_owner">Fleet Owner</SelectItem>
                          <SelectItem value="other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label
                          style={{
                            display: "block",
                            fontFamily: "var(--body-font)",
                            fontSize: "0.85rem",
                            color: "var(--mktr-text-muted)",
                            marginBottom: "0.5rem",
                            fontWeight: 400,
                          }}
                        >
                          Email *
                        </label>
                        <Input
                          name="email"
                          type="email"
                          value={formData.email}
                          onChange={handleChange}
                          required
                          placeholder="your@email.com"
                          style={inputStyle}
                        />
                      </div>
                      <div>
                        <label
                          style={{
                            display: "block",
                            fontFamily: "var(--body-font)",
                            fontSize: "0.85rem",
                            color: "var(--mktr-text-muted)",
                            marginBottom: "0.5rem",
                            fontWeight: 400,
                          }}
                        >
                          Phone
                        </label>
                        <Input
                          name="phone"
                          value={formData.phone}
                          onChange={handleChange}
                          placeholder="+65 8123 4567"
                          style={inputStyle}
                        />
                      </div>
                    </div>

                    <div>
                      <label
                        style={{
                          display: "block",
                          fontFamily: "var(--body-font)",
                          fontSize: "0.85rem",
                          color: "var(--mktr-text-muted)",
                          marginBottom: "0.5rem",
                          fontWeight: 400,
                        }}
                      >
                        Message *
                      </label>
                      <Textarea
                        name="message"
                        value={formData.message}
                        onChange={handleChange}
                        required
                        minLength={10}
                        rows={5}
                        placeholder="Tell us about your needs..."
                        style={inputStyle}
                      />
                      {error && (
                        <p
                          style={{
                            marginTop: "0.5rem",
                            fontSize: "0.85rem",
                            color: "#ef4444",
                          }}
                        >
                          {error}
                        </p>
                      )}
                    </div>

                    <button
                      type="submit"
                      disabled={loading}
                      className="mktr-hero-cta"
                      style={{
                        width: "100%",
                        justifyContent: "center",
                        opacity: loading ? 0.6 : 1,
                      }}
                    >
                      {loading ? "Sending..." : "Send Message"}
                      {!loading && <Send className="w-4 h-4" />}
                    </button>
                  </form>
                </div>
              )}
            </div>

            {/* Info Cards */}
            <div className="space-y-4 mktr-reveal mktr-reveal-delay-2">
              <div
                style={{
                  background: "var(--mktr-bg-card)",
                  border: "1px solid var(--mktr-border)",
                  borderRadius: 16,
                  padding: "2rem",
                }}
              >
                <div className="mktr-feature-icon" style={{ marginBottom: "1rem" }}>
                  <MapPin className="w-5 h-5" />
                </div>
                <h4
                  style={{
                    fontFamily: "var(--heading-font)",
                    fontSize: "1.1rem",
                    fontWeight: 600,
                    color: "var(--mktr-text)",
                    marginBottom: "0.5rem",
                  }}
                >
                  MKTR PTE. LTD.
                </h4>
                <p
                  style={{
                    fontFamily: "var(--body-font)",
                    fontSize: "0.9rem",
                    color: "var(--mktr-text-muted)",
                    lineHeight: 1.6,
                    fontWeight: 300,
                  }}
                >
                  71 Ayer Rajah Crescent
                  <br />
                  #06-14, Singapore 139951
                </p>
              </div>

              <div
                style={{
                  background: "var(--mktr-bg-card)",
                  border: "1px solid var(--mktr-border)",
                  borderRadius: 16,
                  padding: "2rem",
                }}
              >
                <div className="mktr-feature-icon" style={{ marginBottom: "1rem" }}>
                  <MessageCircle className="w-5 h-5" />
                </div>
                <h4
                  style={{
                    fontFamily: "var(--heading-font)",
                    fontSize: "1.1rem",
                    fontWeight: 600,
                    color: "var(--mktr-text)",
                    marginBottom: "0.5rem",
                  }}
                >
                  WhatsApp
                </h4>
                <p
                  style={{
                    fontFamily: "var(--body-font)",
                    fontSize: "0.9rem",
                    color: "var(--mktr-text-muted)",
                    lineHeight: 1.6,
                    fontWeight: 300,
                    marginBottom: "1rem",
                  }}
                >
                  Fastest way to reach us — WhatsApp only.
                </p>
                <a
                  href="https://wa.me/6580790542"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mktr-hero-cta-secondary"
                  style={{ fontSize: "0.9rem", padding: "0.75rem 1.5rem" }}
                >
                  +65 8079 0542
                </a>
              </div>

              <div
                style={{
                  background: "var(--mktr-bg-card)",
                  border: "1px solid var(--mktr-border)",
                  borderRadius: 16,
                  padding: "2rem",
                }}
              >
                <h4
                  style={{
                    fontFamily: "var(--mono-font)",
                    fontSize: "0.7rem",
                    letterSpacing: "3px",
                    textTransform: "uppercase",
                    color: "var(--mktr-accent)",
                    marginBottom: "1rem",
                  }}
                >
                  Response Time
                </h4>
                <p
                  style={{
                    fontFamily: "var(--body-font)",
                    fontSize: "0.9rem",
                    color: "var(--mktr-text-muted)",
                    lineHeight: 1.6,
                    fontWeight: 300,
                  }}
                >
                  We typically respond within <strong style={{ color: "var(--mktr-text)", fontWeight: 500 }}>4 hours</strong> during
                  business hours (Mon-Fri, 9am-6pm SGT).
                </p>
              </div>
            </div>
          </div>

          <style>{`
            @media (max-width: 768px) {
              .mktr-section-container > div[style*="grid-template-columns: 1.2fr"] {
                grid-template-columns: 1fr !important;
              }
            }
          `}</style>
        </div>
      </section>
    </MarketingLayout>
  );
}
