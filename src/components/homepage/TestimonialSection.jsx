import { brand } from "@/lib/brand";

const TestimonialSection = () => {
 return (
 <section className="mktr-testimonial">
 {/* Background Video */}
 <video
 className="mktr-testimonial-video" autoPlay
 muted
 loop
 playsInline
 poster="https://images.pexels.com/photos/7688336/pexels-photo-7688336.jpeg?auto=compress&cs=tinysrgb&w=1920" >
 <source
 src="https://videos.pexels.com/video-files/7578554/7578554-uhd_2560_1440_30fps.mp4" type="video/mp4" />
 </video>

 <div className="mktr-testimonial-overlay"/>

 <div className="mktr-testimonial-content mktr-reveal">
 <blockquote className="mktr-testimonial-quote">
 {brand.name} completely changed how I prospect. I went from cold-calling 50 people a day
 to having qualified leads come directly to me. My closing rate tripled in two months.
 </blockquote>
 <p className="mktr-testimonial-author">Sarah Tan</p>
 <p className="mktr-testimonial-role">Senior Financial Advisor &bull; Great Eastern</p>
 </div>
 </section>
 );
};

export default TestimonialSection;
