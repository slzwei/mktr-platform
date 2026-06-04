import { Link } from"react-router-dom";
import { brand } from"@/lib/brand";
import MktrWordmark from"@/components/brand/MktrWordmark";

const FooterSection = () => {
 const whatsappDigits = (brand.contactWhatsapp || "").replace(/\D/g,"");

 return (
 <footer className="mktr-footer">
 <div className="mktr-footer-grid">
 <div>
 <div className="mktr-footer-logo" style={{ color: 'var(--mktr-text)' }}>
 <MktrWordmark size={32} />
 </div>
 <p className="mktr-footer-desc">
 Singapore's lead generation service for insurance agents. We capture,
 qualify, and route exclusive leads straight to your phone.
 </p>
 </div>

 <div>
 <h4 className="mktr-footer-heading">Product</h4>
 <a href="/#how-it-works" className="mktr-footer-link">How it works</a>
 <a href="/#features" className="mktr-footer-link">What you get</a>
 <a href="/#waitlist" className="mktr-footer-link">Join the waitlist</a>
 </div>

 <div>
 <h4 className="mktr-footer-heading">Company</h4>
 {brand.contactEmail && (
 <a href={`mailto:${brand.contactEmail}`} className="mktr-footer-link">Contact us</a>
 )}
 {whatsappDigits && (
 <a
 href={`https://wa.me/${whatsappDigits}`}
 target="_blank" rel="noopener noreferrer" className="mktr-footer-link"
 >
 WhatsApp
 </a>
 )}
 <Link to="/personal-data-policy" className="mktr-footer-link">Privacy Policy</Link>
 </div>
 </div>

 <div className="mktr-footer-bottom">
 <p className="mktr-footer-copy">
 &copy; {new Date().getFullYear()} {brand.name} Singapore. All rights reserved.
 </p>
 <p className="mktr-footer-copy">
 71 Ayer Rajah Crescent, #06-14, Singapore 139951
 </p>
 </div>
 </footer>
 );
};

export default FooterSection;
