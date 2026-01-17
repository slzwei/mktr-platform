import React from 'react';

const PersonalDataPolicy = () => {
    return (
        <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8 font-sans">
            <div className="max-w-4xl mx-auto bg-white shadow-lg rounded-xl overflow-hidden border border-gray-100">
                <div className="bg-slate-900 px-8 py-6">
                    <h1 className="text-2xl font-bold text-white tracking-tight">MKTR Personal Data Policy</h1>
                    <p className="text-slate-400 text-sm mt-1">Last Updated: January 2026</p>
                </div>

                <div className="p-8 space-y-8 text-gray-700 leading-relaxed">
                    <section>
                        <p className="text-lg">
                            At MKTR PTE. LTD. ("MKTR", "we", "us", or "our"), we take your privacy seriously. This Personal Data Policy outlines how we collect, use, disclose, and manage your personal data in accordance with the Personal Data Protection Act 2012 ("PDPA") of Singapore.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-slate-900 mb-4 border-b pb-2">1. Collection of Personal Data</h2>
                        <p className="mb-4">
                            We may collect personal data from you through various channels, including but not limited to:
                        </p>
                        <ul className="list-disc pl-6 space-y-2">
                            <li>When you submit forms on our platform or lead capture pages.</li>
                            <li>When you interact with our agents, customer service team, or representatives.</li>
                            <li>When you sign up for our campaigns, promotions, or newsletters.</li>
                            <li>Through your usage of our website and digital services (via cookies and similar technologies).</li>
                        </ul>
                        <p className="mt-4">
                            The types of personal data we collect may include your name, contact numbers, email address, mailing address, NRIC/FIN (where necessary and permitted), and other information required to provide our services.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-slate-900 mb-4 border-b pb-2">2. Purpose of Collection and Use</h2>
                        <p className="mb-4">
                            We collect and use your personal data for the following purposes:
                        </p>
                        <ul className="list-disc pl-6 space-y-2">
                            <li>To provide, operate, and maintain our services to you.</li>
                            <li>To process your applications, transactions, and registrations.</li>
                            <li>To communicate with you regarding updates, promotions, rewards, and marketing messages (where you have consented).</li>
                            <li>To conduct market research, analysis, and service improvements.</li>
                            <li>To comply with applicable laws, regulations, and legal obligations.</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-slate-900 mb-4 border-b pb-2">3. Disclosure to Third Parties</h2>
                        <p className="mb-4">
                            We respect your confidentiality. However, we may disclose your personal data to trusted third parties in the following circumstances:
                        </p>
                        <ul className="list-disc pl-6 space-y-2">
                            <li>
                                <strong>MKTR Partners & Representatives:</strong> To our affiliates, authorised representatives, and service providers who assist us in our business operations (e.g., IT support, marketing agencies, call centres).
                            </li>
                            <li>
                                <strong>Legal Compliance:</strong> When required by law, regulation, or court order to disclose information to government or regulatory authorities.
                            </li>
                            <li>
                                <strong>Business Transactions:</strong> In the event of a merger, acquisition, or sale of assets, where personal data may be transferred as part of the transaction.
                            </li>
                        </ul>
                        <p className="mt-4">
                            We require all third parties to respect the security of your personal data and to treat it in accordance with the law.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-slate-900 mb-4 border-b pb-2">4. Protection and Retention</h2>
                        <p>
                            We implement appropriate administrative, physical, and technical security measures to protect your personal data from unauthorised access, misuse, disclosure, alteration, or destruction. We retain your personal data only for as long as is necessary to fulfil the purposes for which it was collected, or as required by law.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-slate-900 mb-4 border-b pb-2">5. Your Rights: Application, Withdrawal, and Correction</h2>
                        <p className="mb-4">
                            Under the PDPA, you have the following rights regarding your personal data:
                        </p>
                        <ul className="list-disc pl-6 space-y-2">
                            <li><strong>Access:</strong> You may request access to the personal data we hold about you.</li>
                            <li><strong>Correction:</strong> You may request correction of any inaccurate or incomplete personal data.</li>
                            <li><strong>Withdrawal of Consent:</strong> You may withdraw your consent for the collection, use, or disclosure of your personal data at any time.</li>
                        </ul>
                        <p className="mt-4">
                            Please note that withdrawing consent may affect our ability to continue providing certain services to you.
                        </p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-slate-900 mb-4 border-b pb-2">6. Contact Us / Data Protection Officer</h2>
                        <p className="mb-4">
                            If you have any questions about this Personal Data Policy, or if you wish to exercise your rights (Access, Correction, or Withdrawal of Consent), please contact us via:
                        </p>
                        <div className="bg-gray-50 p-6 rounded-lg border border-gray-200">
                            <p className="font-semibold text-slate-800">Data Protection Matters</p>
                            <p className="mt-2">
                                <strong>WhatsApp:</strong> <a href="https://wa.me/601154388337" className="text-blue-600 hover:text-blue-800 hover:underline transition-colors">+60 11 5438 8337</a>
                            </p>
                            <p className="mt-1 text-sm text-gray-500">
                                (Please state "Data Protection" or "PDPA" in your message for faster routing.)
                            </p>
                        </div>
                    </section>
                </div>

                <div className="bg-gray-50 px-8 py-6 border-t border-gray-200 text-center">
                    <p className="text-sm text-gray-500">&copy; {new Date().getFullYear()} MKTR PTE. LTD. All rights reserved.</p>
                </div>
            </div>
        </div>
    );
};

export default PersonalDataPolicy;
