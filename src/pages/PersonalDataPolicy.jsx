import MarketingLayout from"@/components/layout/MarketingLayout";
import { brand } from"@/lib/brand";
import"../pages/Homepage.css";

const sections = [
 {
 title:"1. Collection of Personal Data",
 content: `We may collect personal data from you through various channels, including but not limited to:`,
 list: [
"When you submit forms on our platform or lead capture pages.",
"When you interact with our agents, customer service team, or representatives.",
"When you sign up for our campaigns, promotions, or newsletters.",
"Through your usage of our website and digital services (via cookies and similar technologies).",
 ],
 after: `The types of personal data we may collect include: name, NRIC/FIN (partial), email address, phone number, postal code, date of birth, occupation, and other information relevant to the services we provide.`,
 },
 {
 title:"2. Purpose of Data Collection",
 content: `We collect and use your personal data for the following purposes:`,
 list: [
"To provide you with our products and services.",
"To match you with relevant insurance or financial products.",
"To communicate with you about our offerings and updates.",
"To improve our services and user experience.",
"To comply with legal and regulatory requirements.",
"To prevent fraud and ensure the security of our platform.",
 ],
 },
 {
 title:"3. Disclosure of Personal Data",
 content: `We may share your personal data with:`,
 list: [
"Our authorised agents and representatives who will be assisting you.",
"Insurance companies and financial institutions for the purpose of providing quotes and services.",
"Service providers who help us operate our platform (e.g., cloud hosting, analytics).",
"Government authorities when required by law.",
 ],
 after: `We do not sell your personal data to any third parties.`,
 },
 {
 title:"4. Data Retention",
 content: `We retain your personal data for as long as necessary to fulfil the purposes for which it was collected, or as required by law. When data is no longer needed, it will be securely deleted or anonymised.`,
 },
 {
 title:"5. Access and Correction",
 content: `You may request access to or correction of your personal data held by us. To make such a request, please contact us using the details provided at the end of this policy. We may charge a reasonable fee for processing access requests.`,
 },
 {
 title:"6. Withdrawal of Consent",
 content: `You may withdraw your consent for us to collect, use, or disclose your personal data at any time by contacting us. Please note that withdrawal of consent may affect our ability to provide certain services to you.`,
 },
 {
 title:"7. Cookies and Tracking",
 content: `Our website uses cookies and similar technologies to improve your browsing experience and analyse website traffic. You may configure your browser to reject cookies, though some features may not function properly.`,
 },
 {
 title:"8. Data Security",
 content: `We implement appropriate technical and organisational measures to protect your personal data against unauthorised access, collection, use, disclosure, or similar risks. These measures include encryption, access controls, and regular security audits.`,
 },
 {
 title:"9. Changes to This Policy",
 content: `We may update this policy from time to time to reflect changes in our practices or legal requirements. The updated policy will be posted on our website with the revised date.`,
 },
 {
 title:"10. Analytics and Advertising Partners",
 content: `To measure the performance of our marketing campaigns and improve the relevance of our advertising, we work with third-party advertising platforms, including Meta Platforms, Inc. ("Meta", operator of Facebook and Instagram).`,
 list: [
"Hashed (SHA-256) contact information — email address and phone number — unless you have unticked the marketing-consent checkbox above the submit button on a campaign signup form. The checkbox is ticked by default; if you untick it before submitting, no contact information is shared.",
"Anonymous browser identifiers placed by Meta on our pages (the “_fbp” cookie and the “fbclid” / “_fbc” click identifier), your device's IP address, and your browser's user-agent string.",
 ],
 after: `We send these signals in two ways: (a) the Meta Pixel — a small JavaScript snippet on our public lead-capture pages that fires when you view a page and when you submit a form, and (b) the Meta Conversions API — a server-to-server transmission of the same conversion event from our servers. We pair the two methods using a shared event ID so Meta counts each real conversion only once, not twice. Meta receives only what is listed above; it does not receive your name, your NRIC, your address, your date of birth, or any free-text information you provide on the form.\n\nHow to opt out:\n• Untick the marketing-consent checkbox before you submit a form. The checkbox is ticked by default; unticking it means we will not transmit your contact information to Meta. You can still submit the form.\n• Adjust “Off-Facebook activity” settings in your Meta account at facebook.com/off_facebook_activity.\n• Configure your browser to block third-party cookies, or install a browser extension that blocks ad-related scripts.\n\nInformation collected through Meta is governed by Meta's own privacy policy at facebook.com/about/privacy.`,
 },
 {
 title:"11. Contact Us",
 content: `If you have any questions about this policy or wish to exercise your rights regarding your personal data, please contact us:`,
 // Legal entity per D3 — keep MKTR PTE. LTD. as the data controller regardless of brand.
 after: `MKTR PTE. LTD.\n71 Ayer Rajah Crescent, #06-14\nSingapore 139951\n\nWhatsApp: +65 8079 0542`,
 },
];

export default function PersonalDataPolicy() {
 return (
 <MarketingLayout>
 <section className="mktr-section" style={{ paddingTop:"5rem"}}>
 <div className="mktr-section-container" style={{ maxWidth: 800 }}>
 <p className="mktr-section-eyebrow mktr-reveal">Legal</p>
 <h1
 className="mktr-section-title mktr-reveal mktr-reveal-delay-1" style={{ textAlign:"left", marginBottom:"0.5rem"}}
 >
 Personal Data Policy
 </h1>
 <p
 className="mktr-reveal mktr-reveal-delay-2" style={{
 fontFamily:"var(--mono-font)",
 fontSize:"0.75rem",
 color:"var(--mktr-text-dim)",
 letterSpacing:"1px",
 marginBottom:"3rem",
 }}
 >
 Last Updated: May 2026
 </p>

 <div className="mktr-reveal mktr-reveal-delay-2" style={{ marginBottom:"2rem"}}>
 <p
 style={{
 fontFamily:"var(--body-font)",
 fontSize:"1.05rem",
 color:"var(--mktr-text-muted)",
 lineHeight: 1.8,
 fontWeight: 300,
 }}
 >
 At MKTR PTE. LTD. (&ldquo;{brand.name}&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;, or
 &ldquo;our&rdquo;), we take your privacy seriously. This Personal Data Policy
 outlines how we collect, use, disclose, and manage your personal data in accordance
 with the Personal Data Protection Act 2012 (&ldquo;PDPA&rdquo;) of Singapore.
 </p>
 </div>

 {sections.map((s, i) => (
 <div key={i} className="mktr-reveal" style={{ marginBottom:"2.5rem"}}>
 <h2
 style={{
 fontFamily:"var(--heading-font)",
 fontSize:"1.25rem",
 fontWeight: 600,
 color:"var(--mktr-text)",
 marginBottom:"1rem",
 paddingBottom:"0.75rem",
 borderBottom:"1px solid var(--mktr-border)",
 }}
 >
 {s.title}
 </h2>
 <p
 style={{
 fontFamily:"var(--body-font)",
 fontSize:"0.95rem",
 color:"var(--mktr-text-muted)",
 lineHeight: 1.8,
 fontWeight: 300,
 marginBottom: s.list ?"1rem": 0,
 }}
 >
 {s.content}
 </p>
 {s.list && (
 <ul
 style={{
 listStyle:"none",
 padding: 0,
 margin:"0 0 1rem",
 }}
 >
 {s.list.map((item, j) => (
 <li
 key={j}
 style={{
 fontFamily:"var(--body-font)",
 fontSize:"0.95rem",
 color:"var(--mktr-text-muted)",
 lineHeight: 1.8,
 fontWeight: 300,
 paddingLeft:"1.5rem",
 position:"relative",
 marginBottom:"0.25rem",
 }}
 >
 <span
 style={{
 position:"absolute",
 left: 0,
 color:"var(--mktr-accent)",
 }}
 >
 &bull;
 </span>
 {item}
 </li>
 ))}
 </ul>
 )}
 {s.after && (
 <p
 style={{
 fontFamily:"var(--body-font)",
 fontSize:"0.95rem",
 color:"var(--mktr-text-muted)",
 lineHeight: 1.8,
 fontWeight: 300,
 whiteSpace:"pre-line",
 }}
 >
 {s.after}
 </p>
 )}
 </div>
 ))}
 </div>
 </section>
 </MarketingLayout>
 );
}
