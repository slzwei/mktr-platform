import { Link } from"react-router-dom";

const FooterSection = () => {
 return (
 <footer className="mktr-footer">
 <div className="mktr-footer-grid">
 <div>
 <div className="mktr-footer-logo">MKTR.</div>
 <p className="mktr-footer-desc">
 Singapore's AI-powered lead generation platform for insurance
 and property agents. Capture, qualify, and convert prospects at scale.
 </p>
 </div>

 <div>
 <h4 className="mktr-footer-heading">Platform</h4>
 <Link to="/LeadCapture" className="mktr-footer-link">Lead Capture</Link>
 <Link to="/AdminDashboard" className="mktr-footer-link">Dashboard</Link>
 <a href="#features" className="mktr-footer-link">Features</a>
 </div>

 <div>
 <h4 className="mktr-footer-heading">Support</h4>
 <a href="#" className="mktr-footer-link">Documentation</a>
 <a href="#" className="mktr-footer-link">Help Center</a>
 <Link to="/Contact" className="mktr-footer-link">Contact Us</Link>
 </div>

 <div>
 <h4 className="mktr-footer-heading">Company</h4>
 <a href="#" className="mktr-footer-link">About</a>
 <Link to="/personal-data-policy" className="mktr-footer-link">Privacy Policy</Link>
 <a href="#" className="mktr-footer-link">Terms of Service</a>
 </div>
 </div>

 <div className="mktr-footer-bottom">
 <p className="mktr-footer-copy">
 &copy; {new Date().getFullYear()} MKTR. Singapore. All rights reserved.
 </p>
 <p className="mktr-footer-copy">
 71 Ayer Rajah Crescent, #06-14, Singapore 139951
 </p>
 </div>
 </footer>
 );
};

export default FooterSection;
