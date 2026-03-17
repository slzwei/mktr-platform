import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";

const CTASection = () => {
  return (
    <section className="section-spacing bg-white dark:bg-gray-900">
        <div className="container text-center">
          <h2 className="text-black dark:text-white mb-8 hero-title" style={{ fontSize: 'clamp(2rem, 6vw, 4rem)' }}>
            Ready to Transform<br />Your Marketing?
          </h2>
          <p className="mx-auto my-2 body-text max-w-2xl text-black dark:text-white" style={{ fontSize: '1.2rem' }}>
            Join hundreds of agents already using MKTR to capture and convert more leads.
          </p>
          <div className="mt-8">
            <Link to={"/AdminDashboard"} className="btn-primary bg-black text-white hover:bg-gray-800 max-w-xs mx-auto">
              Get Started Now
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </section>
  );
};

export default CTASection;
