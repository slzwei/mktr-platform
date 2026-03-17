import { Users, TrendingUp, QrCode } from "lucide-react";

const FeaturesSection = () => {
  return (
    <section id="features" className="section-spacing bg-black text-white pb-12">
        <div className="container">
          <p className="section-title text-center !text-white">Core Features</p>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-12 mt-12 mobile-grid-fix">
            <div className="text-center parallax-card">
              <div className="w-16 h-16 mx-auto mb-6 border-2 border-white flex items-center justify-center">
                <Users className="w-8 h-8 text-white" />
              </div>
              <h3 className="section-title mb-4 !text-white">Lead Capture</h3>
              <p className="body-text text-gray-300">
                Mobile-optimized forms with Singapore phone verification and postal code validation.
              </p>
            </div>

            <div className="text-center parallax-card">
              <div className="w-16 h-16 mx-auto mb-6 border-2 border-white flex items-center justify-center">
                <TrendingUp className="w-8 h-8 text-white" />
              </div>
              <h3 className="section-title mb-4 !text-white">Campaign Mgmt</h3>
              <p className="body-text text-gray-300">
                Create targeted campaigns with custom designs and real-time tracking.
              </p>
            </div>

            <div className="text-center parallax-card">
              <div className="w-16 h-16 mx-auto mb-6 border-2 border-white flex items-center justify-center">
                <QrCode className="w-8 h-8 text-white" />
              </div>
              <h3 className="section-title mb-4 !text-white">QR Integration</h3>
              <p className="body-text text-gray-300">
                Generate QR codes for physical marketing with tracking and commission management.
              </p>
            </div>
          </div>
        </div>
      </section>
  );
};

export default FeaturesSection;
