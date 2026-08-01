import GuidedReviewDesigner from "./guided-review/GuidedReviewDesigner";

/**
 * Guided-review dispatcher — all that remains of the classic DesignEditor.
 *
 * Since the Studio became the permanent design surface, the workspace mounts
 * this component ONLY when studioSupportsCampaign() is false, i.e. exclusively
 * for guided_review campaigns — so the classic panel editor that used to live
 * below this dispatch could never render, and it (plus the whole
 * src/components/campaigns/editor/ tree) has been deleted. Non-guided
 * campaigns are edited in Campaign Studio (/admin/campaigns/:id/studio); if
 * one is ever mounted here by mistake it renders nothing — the backend
 * independently 409s any classic-style write over a v2 doc
 * (DESIGN_CONFIG_VERSION_CONFLICT), so there is no editor to resurrect.
 */
export default function DesignEditor(props) {
 if (props.campaign?.type === 'guided_review') {
 return <GuidedReviewDesigner {...props} />;
 }
 return null;
}
