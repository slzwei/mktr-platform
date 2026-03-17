import { Users, TrendingUp, QrCode, Car } from "lucide-react";

const LeadSourcesSection = () => {
  return (
    <section className="section-spacing bg-white dark:bg-gray-900">
        <div className="container">
          <p className="section-title text-center text-black dark:text-white">Where Our Leads Come From</p>
          <h2 className="text-center mb-16 text-black dark:text-white" style={{ fontFamily: 'var(--heading-font)', fontSize: 'clamp(1.5rem, 4vw, 3rem)', lineHeight: '1.1' }}>
            Multi-Channel Lead<br />
            Generation Strategy
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-12">
            <div className="text-center">
              <div className="w-20 h-20 mx-auto mb-6 border-2 border-black dark:border-white flex items-center justify-center bg-white dark:bg-gray-800 hover:bg-black hover:text-white transition-all duration-300">
                <TrendingUp className="w-8 h-8" />
              </div>
              <div className="mb-4">
                <span className="section-title text-xs text-gray-500 dark:text-gray-400">01</span>
                <h3 className="section-title mb-2 text-lg">Social Media Ads</h3>
              </div>
              <p className="body-text text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
                Facebook, Instagram, and TikTok campaigns driving qualified prospects to your landing pages
              </p>
            </div>

            <div className="text-center">
              <div className="w-20 h-20 mx-auto mb-6 border-2 border-black dark:border-white flex items-center justify-center bg-white dark:bg-gray-800 hover:bg-black hover:text-white transition-all duration-300">
                <QrCode className="w-8 h-8" />
              </div>
              <div className="mb-4">
                <span className="section-title text-xs text-gray-500 dark:text-gray-400">02</span>
                <h3 className="section-title mb-2 text-lg">Physical Flyers</h3>
              </div>
              <p className="body-text text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
                QR-enabled flyers distributed at MRTs, shopping centers, and high-traffic locations
              </p>
            </div>

            <div className="text-center">
              <div className="w-20 h-20 mx-auto mb-6 border-2 border-black dark:border-white flex items-center justify-center bg-white dark:bg-gray-800 hover:bg-black hover:text-white transition-all duration-300">
                <Car className="w-8 h-8" />
              </div>
              <div className="mb-4">
                <span className="section-title text-xs text-gray-500 dark:text-gray-400">03</span>
                <h3 className="section-title mb-2 text-lg">Private Transport</h3>
              </div>
              <p className="body-text text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
                Vehicle-mounted QR codes on Grab cars, taxis, and private hire vehicles across Singapore
              </p>
            </div>

            <div className="text-center">
              <div className="w-20 h-20 mx-auto mb-6 border-2 border-black dark:border-white flex items-center justify-center bg-white dark:bg-gray-800 hover:bg-black hover:text-white transition-all duration-300">
                <Users className="w-8 h-8" />
              </div>
              <div className="mb-4">
                <span className="section-title text-xs text-gray-500 dark:text-gray-400">04</span>
                <h3 className="section-title mb-2 text-lg">Digital Campaigns</h3>
              </div>
              <p className="body-text text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
                Targeted online advertising reaching prospects when they're actively searching
              </p>
            </div>
          </div>
        </div>
      </section>
  );
};

export default LeadSourcesSection;
