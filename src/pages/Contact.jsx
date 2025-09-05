import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Link } from "react-router-dom";
import { apiClient } from "@/api/client";
import { createPageUrl } from "@/utils";
import {
  ArrowLeft,
  Mail,
  Phone,
  MapPin,
  Clock,
  Send,
  CheckCircle
} from "lucide-react";

export default function Contact() {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    company: "",
    message: ""
  });
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await apiClient.post('/contact', formData);
      setSubmitted(true);
    } catch (err) {
      console.error('Failed to submit contact form', err);
      alert('There was an issue sending your message. Please try again later.');
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
  };

  return (
    <>
      <style>{`
        /* CSS Custom Properties */
        :root {
          --heading-font: 'Mindset', 'Inter', sans-serif;
          --body-font: 'Inter', sans-serif;
          --mono-font: 'PT Mono', 'Courier New', monospace;
          --black: #000000;
          --white: #ffffff;
          --grey: #909090;
        }

        /* Import Fonts */
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
        @import url('https://fonts.googleapis.com/css2?family=PT+Mono:wght@400&display=swap');

        /* Typography */
        .hero-title {
          font-family: var(--heading-font);
          font-size: clamp(3rem, 8vw, 6rem);
          line-height: 0.9;
          font-weight: 700;
          color: var(--black);
          margin: 0;
          text-shadow: 2px 2px 4px rgba(0,0,0,0.1);
        }

        .section-title {
          font-family: var(--mono-font);
          text-transform: uppercase;
          letter-spacing: 3px;
          font-size: 0.875rem;
          color: var(--black);
          margin-bottom: 2rem;
        }

        .body-text {
          font-family: var(--body-font);
          font-size: 1.125rem;
          line-height: 1.7;
          color: var(--grey);
        }

        /* Layout */
        .section-spacing {
          padding: 6rem 0;
          position: relative;
        }

        .container {
          max-width: 1200px;
          margin: 0 auto;
          padding: 0 2rem;
          position: relative;
          z-index: 2;
        }

        /* Buttons */
        .btn-primary {
          background: var(--black);
          color: var(--white);
          border: none;
          padding: 1rem 2rem;
          font-family: var(--mono-font);
          text-transform: uppercase;
          letter-spacing: 1px;
          text-decoration: none;
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          transition: all 0.3s ease;
          cursor: pointer;
        }

        .btn-primary:hover {
          opacity: 0.8;
          transform: translateY(-2px);
          box-shadow: 0 10px 20px rgba(0,0,0,0.2);
        }

        .btn-outline {
          background: transparent;
          color: var(--black);
          border: 2px solid var(--black);
          padding: 1rem 2rem;
          font-family: var(--mono-font);
          text-transform: uppercase;
          letter-spacing: 1px;
          text-decoration: none;
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          transition: all 0.3s ease;
          cursor: pointer;
        }

        .btn-outline:hover {
          background: var(--black);
          color: var(--white);
          transform: translateY(-2px);
          box-shadow: 0 10px 20px rgba(0,0,0,0.2);
        }

        /* Responsive */
        @media (max-width: 768px) {
          .hero-title {
            font-size: clamp(2.5rem, 10vw, 4rem);
          }

          .section-spacing {
            padding: 4rem 0;
          }

          .container {
            padding: 0 1rem;
          }
        }
      `}</style>

      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-white">
        {/* Header */}
        <header className="bg-white/95 backdrop-blur-sm border-b border-gray-200">
          <div className="container">
            <div className="flex items-center justify-between py-6">
              <Link 
                to={createPageUrl("Homepage")} 
                className="text-2xl font-bold text-black"
                style={{ fontFamily: 'var(--heading-font)' }}
              >
                MKTR PTE. LTD.
              </Link>
              <Link to={createPageUrl("Homepage")}>
                <Button variant="outline" className="gap-2">
                  <ArrowLeft className="w-4 h-4" />
                  Back to Home
                </Button>
              </Link>
            </div>
          </div>
        </header>

        {/* Hero Section */}
        <section className="section-spacing bg-white">
          <div className="container">
            <div className="text-center max-w-4xl mx-auto mb-16">
              <p className="section-title">Get in Touch</p>
              <h1 className="hero-title mb-6">Let's Talk Business</h1>
              <p className="body-text max-w-2xl mx-auto">
                Speak with MKTR PTE. LTD. about lead generation, campaign design, and sales enablement. We typically respond within one business day.
              </p>
            </div>
          </div>
        </section>

        {/* Contact Section */}
        <section className="bg-white py-16">
          <div className="container">
            <div className="grid lg:grid-cols-2 gap-16">
              {/* Contact Form */}
              <div>
                {submitted ? (
                  <Card className="p-8 text-center">
                    <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
                    <h3 className="text-2xl font-bold text-gray-900 mb-2">Message Sent!</h3>
                    <p className="text-gray-600">
                      Thank you for reaching out. We'll get back to you within 24 hours.
                    </p>
                  </Card>
                ) : (
                  <Card className="p-8">
                    <h3 className="section-title mb-6">Send us a Message</h3>
                    <form onSubmit={handleSubmit} className="space-y-6">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Full Name *
                          </label>
                          <Input
                            name="name"
                            value={formData.name}
                            onChange={handleChange}
                            required
                            className="w-full"
                            placeholder="Your full name"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Company
                          </label>
                          <Input
                            name="company"
                            value={formData.company}
                            onChange={handleChange}
                            className="w-full"
                            placeholder="Your company"
                          />
                        </div>
                      </div>
                      
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Email Address *
                          </label>
                          <Input
                            name="email"
                            type="email"
                            value={formData.email}
                            onChange={handleChange}
                            required
                            className="w-full"
                            placeholder="your@email.com"
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">
                            Phone Number
                          </label>
                          <Input
                            name="phone"
                            value={formData.phone}
                            onChange={handleChange}
                            className="w-full"
                            placeholder="+65 8123 4567"
                          />
                        </div>
                      </div>
                      
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Message *
                        </label>
                        <Textarea
                          name="message"
                          value={formData.message}
                          onChange={handleChange}
                          required
                          rows={6}
                          className="w-full"
                          placeholder="Tell us about your marketing needs and how we can help..."
                        />
                      </div>
                      
                      <Button 
                        type="submit" 
                        disabled={loading}
                        className="btn-primary w-full"
                      >
                        {loading ? 'Sending...' : (
                          <>
                            Send Message
                            <Send className="w-4 h-4" />
                          </>
                        )}
                      </Button>
                    </form>
                  </Card>
                )}
              </div>

              {/* Contact Information */}
              <div className="space-y-8">
                <Card className="p-8">
                  <h3 className="section-title mb-6">Company</h3>
                  <div className="space-y-4">
                    <div className="flex items-start gap-4">
                      <div className="w-12 h-12 bg-black text-white rounded-lg flex items-center justify-center shrink-0">
                        <MapPin className="w-6 h-6" />
                      </div>
                      <div>
                        <h4 className="font-semibold text-gray-900 mb-1">MKTR PTE. LTD.</h4>
                        <p className="text-gray-600">Singapore</p>
                      </div>
                    </div>
                    <div className="text-sm text-gray-500">
                      For all enquiries, please use the contact form.
                    </div>
                  </div>
                </Card>
              </div>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="bg-black text-white py-12">
          <div className="container">
            <div className="text-center">
              <div className="text-2xl font-bold mb-4" style={{ fontFamily: 'var(--heading-font)' }}>
                MKTR PTE. LTD.
              </div>
              <p className="text-gray-400">
                Singapore's leading marketer platform for intelligent lead generation.
              </p>
              <div className="mt-8 pt-8 border-t border-gray-700 text-gray-400 text-sm">
                &copy; 2024 MKTR PTE. LTD., Singapore. All rights reserved.
              </div>
            </div>
          </div>
        </footer>
      </div>
    </>
  );
}