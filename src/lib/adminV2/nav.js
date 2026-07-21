/**
 * Admin v2 sidebar IA — one list, two consumers: the shell renders it as the
 * sidebar, the ⌘K palette matches page routes against its labels. Mock IA
 * order — Agents/Groups ahead of Campaigns (design source sidebar).
 */
export const NAV = [
  {
    label: 'Overview',
    items: [{ to: '/AdminDashboard', label: 'Dashboard' }],
  },
  {
    label: 'Lead Generation',
    items: [
      { to: '/AdminProspects', label: 'Prospects' },
      { to: '/AdminCohorts', label: 'Cohorts' },
      { to: '/AdminAgents', label: 'Agents' },
      { to: '/AdminAgentGroups', label: 'Agent Groups' },
      { to: '/AdminCampaigns', label: 'Campaigns' },
      { to: '/AdminWallets', label: 'Wallets & Commitments' },
      { to: '/AdminQRCodes', label: 'QR Codes' },
      { to: '/AdminShortLinks', label: 'Short Links' },
    ],
  },
  {
    label: 'System',
    items: [
      { to: '/AdminUsers', label: 'Users' },
      { to: '/AdminAISettings', label: 'AI Settings' },
    ],
  },
];
