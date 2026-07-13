import { useState } from 'react';
import DesignEditor from '@/components/campaigns/DesignEditor';

const DEMO_CAMPAIGN = {
  id: 'guided-review-local-demo',
  name: 'Financial Readiness Review',
  type: 'guided_review',
  design_config: {},
};

/** Development-only, backend-free showcase for the Guided Review designer. */
export default function GuidedReviewDemo() {
  const [campaign, setCampaign] = useState(DEMO_CAMPAIGN);

  const handleSave = async (designConfig) => {
    setCampaign((current) => ({ ...current, design_config: designConfig }));
  };

  return (
    <DesignEditor
      campaign={campaign}
      onSave={handleSave}
      heightClass="h-screen"
    />
  );
}
