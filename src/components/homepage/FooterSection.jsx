import { Link } from "react-router-dom";

const FooterSection = () => {
  return (
    <footer className="section-spacing border-t bg-black text-white">
        <div className="container">
          <div className="grid md:grid-cols-4 gap-8 mobile-grid-fix">
            <div>
              <h3 className="logo mb-4 !text-white">MKTR.</h3>
              <p className="body-text text-gray-300">
                Singapore's leading marketer platform for intelligent lead generation.
              </p>
            </div>
            <div>
              <h4 className="section-title mb-4 !text-white">Platform</h4>
              <ul className="space-y-2">
                <li><Link to={"/LeadCapture"} className="body-text text-gray-300 hover:text-white">Lead Capture</Link></li>
                <li><Link to={"/AdminDashboard"} className="body-text text-gray-300 hover:text-white">Dashboard</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="section-title mb-4 !text-white">Support</h4>
              <ul className="space-y-2">
                <li><a href="#" className="body-text text-gray-300 hover:text-white">Documentation</a></li>
                <li><a href="#" className="body-text text-gray-300 hover:text-white">Help Center</a></li>
              </ul>
            </div>
            <div>
              <h4 className="section-title mb-4 !text-white">Company</h4>
              <ul className="space-y-2">
                <li><a href="#" className="body-text text-gray-300 hover:text-white">About Us</a></li>
                <li><a href="#" className="body-text text-gray-300 hover:text-white">Privacy Policy</a></li>
                <li><Link to={"/Contact"} className="body-text text-gray-300 hover:text-white">Contact</Link></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-gray-700 mt-12 pt-8 text-center">
            <p className="body-text text-gray-400">&copy; 2025 MKTR. Singapore. All rights reserved.</p>
          </div>
        </div>
      </footer>
  );
};

export default FooterSection;
