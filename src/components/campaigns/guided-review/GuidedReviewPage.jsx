import { Check, Gift, LockKeyhole, Sparkles } from 'lucide-react';
import { normalizeGuidedReview, rewardConditionLabel } from './guidedReviewDefaults';
import './guidedReviewPage.css';

function EditableSection({ id, selected, onSelect, children, className = '' }) {
  const editable = typeof onSelect === 'function';
  return (
    <section
      className={`gr-section ${editable ? 'gr-section--editable' : ''} ${selected ? 'gr-section--selected' : ''} ${className}`}
      data-section={id}
      onClick={editable ? (event) => {
        event.stopPropagation();
        onSelect(id);
      } : undefined}
    >
      {editable && <span className="gr-edit-pill">Edit section</span>}
      {children}
    </section>
  );
}

function Eyebrow({ children, light = false }) {
  return <p className={`gr-eyebrow ${light ? 'gr-eyebrow--light' : ''}`}>{children}</p>;
}

function Hero({ data, onCta, editableProps }) {
  return (
    <EditableSection id="hero" className="gr-hero" {...editableProps}>
      <div className="gr-wrap gr-hero__grid">
        <div className="gr-hero__copy">
          <Eyebrow>{data.eyebrow}</Eyebrow>
          <h1>{data.headline}</h1>
          <h2>{data.supportingHeadline}</h2>
          <p>{data.body}</p>
          <div className="gr-hero__actions">
            <button type="button" className="gr-button" onClick={(event) => { event.stopPropagation(); onCta?.(); }}>{data.ctaLabel}</button>
            <span><Sparkles size={15} /> {data.closingLabel}</span>
          </div>
        </div>
        <div className="gr-hero__art" aria-hidden="true">
          <div className="gr-orbit gr-orbit--one" />
          <div className="gr-orbit gr-orbit--two" />
          <div className="gr-art-card gr-art-card--back"><span>CPF</span><strong>Income</strong></div>
          <div className="gr-art-card gr-art-card--front">
            <span className="gr-art-card__icon"><Sparkles size={22} /></span>
            <small>Your review</small>
            <strong>{data.visualLabel}</strong>
            <i><Check size={15} /> Clear next steps</i>
          </div>
        </div>
      </div>
    </EditableSection>
  );
}

function Audience({ data, editableProps }) {
  return (
    <EditableSection id="audience" className="gr-audience" {...editableProps}>
      <div className="gr-wrap gr-centered">
        <Eyebrow>{data.eyebrow}</Eyebrow>
        <h2 className="gr-heading">{data.title}</h2>
        <p className="gr-lede">{data.body}</p>
        <div className="gr-chip-row">
          {(data.chips || []).map((chip) => <span key={chip}><Check size={14} />{chip}</span>)}
        </div>
      </div>
    </EditableSection>
  );
}

function Problem({ data, editableProps }) {
  return (
    <EditableSection id="problem" className="gr-problem" {...editableProps}>
      <div className="gr-wrap">
        <div className="gr-section-heading">
          <div><Eyebrow>{data.eyebrow}</Eyebrow><h2 className="gr-heading">{data.title}</h2></div>
          <p>{data.body}</p>
        </div>
        <div className="gr-card-grid">
          {(data.cards || []).map((card, index) => (
            <article className="gr-info-card" key={`${card.title}-${index}`}>
              <span>0{index + 1}</span><h3>{card.title}</h3><p>{card.body}</p>
            </article>
          ))}
        </div>
      </div>
    </EditableSection>
  );
}

function Review({ data, editableProps }) {
  return (
    <EditableSection id="review" className="gr-review" {...editableProps}>
      <div className="gr-wrap">
        <div className="gr-review__intro">
          <div>
            <Eyebrow light>{data.eyebrow}</Eyebrow>
            <h2 className="gr-heading gr-heading--light">{data.title}</h2>
          </div>
          <div><p>{data.body}</p><div className="gr-session-meta"><span>{data.duration}</span><span>{data.mode}</span></div></div>
        </div>
        <div className="gr-outcomes">
          {(data.outcomes || []).map((outcome, index) => (
            <article key={`${outcome.title}-${index}`}><b>{index + 1}</b><div><h3>{outcome.title}</h3><p>{outcome.body}</p></div></article>
          ))}
        </div>
        <p className="gr-review__note"><LockKeyhole size={16} />{data.noObligation}</p>
      </div>
    </EditableSection>
  );
}

function Rewards({ data, editableProps }) {
  return (
    <EditableSection id="rewards" className="gr-rewards" {...editableProps}>
      <div className="gr-wrap gr-centered">
        <Eyebrow light>{data.eyebrow}</Eyebrow>
        <h2 className="gr-heading gr-heading--light">{data.title}</h2>
        <div className="gr-reward-grid">
          {[data.grand, data.attendance].map((reward, index) => (
            <article key={reward.title}>
              <div className="gr-reward-visual"><Gift size={34} /><span>{index === 0 ? 'DRAW' : 'THANK YOU'}</span></div>
              <div className="gr-reward-body">
                <Eyebrow>{reward.label}</Eyebrow><h3>{reward.title}</h3><strong>{reward.value}</strong><p>{reward.body}</p>
                <div className="gr-condition"><Check size={14} />{rewardConditionLabel(reward)}</div>
                {(reward.fulfilmentDays || reward.fulfilment) && <small>{reward.fulfilmentDays ? `Delivered within ${reward.fulfilmentDays} days` : reward.fulfilment}</small>}
              </div>
            </article>
          ))}
        </div>
      </div>
    </EditableSection>
  );
}

function Questions({ data, children, editableProps }) {
  return (
    <EditableSection id="questions" className="gr-questions" {...editableProps}>
      <div className="gr-wrap gr-centered">
        <Eyebrow light>{data.eyebrow}</Eyebrow>
        <h2 className="gr-heading gr-heading--light">{data.title}</h2>
        <p className="gr-lede gr-lede--light">{data.body}</p>
        <div className="gr-form-shell">
          {children || (
            <div className="gr-question-mock">
              <div className="gr-question-progress"><i /><span>1 / {(data.items || []).length}</span></div>
              <h3>{data.items?.[0]?.prompt || 'Your first question'}</h3>
              {(data.items?.[0]?.options || []).slice(0, 4).map((option) => <button type="button" key={option}>{option}<span /></button>)}
            </div>
          )}
        </div>
      </div>
    </EditableSection>
  );
}

function Booking({ data, onCta, editableProps }) {
  return (
    <EditableSection id="booking" className="gr-booking" {...editableProps}>
      <div className="gr-wrap gr-booking__card">
        <div><Eyebrow>{data.eyebrow}</Eyebrow><h2 className="gr-heading">{data.title}</h2></div>
        <div><p>{data.body}</p><button type="button" className="gr-button" onClick={(event) => { event.stopPropagation(); onCta?.(); }}>{data.ctaLabel}</button><small>{data.note}</small></div>
      </div>
    </EditableSection>
  );
}

function Trust({ data, editableProps }) {
  return (
    <EditableSection id="trust" className="gr-trust" {...editableProps}>
      <div className="gr-wrap gr-trust__grid">
        <div><Eyebrow light>{data.eyebrow}</Eyebrow><h2 className="gr-heading gr-heading--light">{data.title}</h2></div>
        <div className="gr-trust__details">
          <div><span>Campaign operator</span><strong>{data.operator}</strong><small>UEN {data.operatorUen}</small></div>
          <div><span>Review provider</span><strong>{data.partner}</strong></div>
          <p>{data.disclosure}</p>
          <nav><a href="/personal-data-policy">{data.privacyLabel}</a><a href="#terms">{data.termsLabel}</a></nav>
        </div>
      </div>
    </EditableSection>
  );
}

function CustomSection({ data, editableProps }) {
  return (
    <EditableSection id={data.id} className="gr-audience" {...editableProps}>
      <div className="gr-wrap gr-centered">
        <Eyebrow>{data.eyebrow}</Eyebrow>
        <h2 className="gr-heading">{data.title}</h2>
        <p className="gr-lede">{data.body}</p>
      </div>
    </EditableSection>
  );
}

export function GuidedReviewSuccess({ config, campaignName, onShare, editableProps }) {
  const content = normalizeGuidedReview(config, campaignName);
  const data = content.success;
  const style = {
    '--gr-accent': content.theme.accent,
    '--gr-ink': content.theme.ink,
    '--gr-paper': content.theme.paper,
    '--gr-sage': content.theme.sage,
  };
  return (
    <div className={`gr-page gr-success-page ${content.theme.headingStyle === 'modern' ? 'gr-page--modern' : ''}`} style={style}>
      <EditableSection id="success" className="gr-success" {...editableProps}>
        <div className="gr-success__card">
          <span className="gr-success__icon"><Check size={32} /></span>
          <Eyebrow>{data.eyebrow}</Eyebrow><h1>{data.title}</h1><p>{data.body}</p>
          <div className="gr-success__status"><Gift size={19} /><div><strong>{data.statusLabel}</strong><span>{data.nextStep}</span></div></div>
          <button type="button" className="gr-button" onClick={onShare}>{data.shareLabel}</button>
        </div>
      </EditableSection>
    </div>
  );
}

export default function GuidedReviewPage({
  config,
  campaignName,
  children,
  onCta,
  selectedSection,
  onSelectSection,
}) {
  const content = normalizeGuidedReview(config, campaignName);
  const sectionMap = {
    hero: Hero,
    audience: Audience,
    problem: Problem,
    review: Review,
    rewards: Rewards,
    questions: Questions,
    booking: Booking,
    trust: Trust,
    custom: CustomSection,
  };
  const style = {
    '--gr-accent': content.theme.accent,
    '--gr-ink': content.theme.ink,
    '--gr-paper': content.theme.paper,
    '--gr-sage': content.theme.sage,
  };

  return (
    <div className={`gr-page ${content.theme.headingStyle === 'modern' ? 'gr-page--modern' : ''}`} style={style}>
      <header className="gr-nav">
        <div className="gr-wrap"><a href="/" className="gr-wordmark">✷ REDEEM</a><button type="button" className="gr-nav__cta" onClick={onCta}>{content.hero.ctaLabel}</button></div>
      </header>
      {(content.sections || []).map((section) => {
        if (!section.visible || section.type === 'success') return null;
        const Component = sectionMap[section.type];
        if (!Component) return null;
        return (
          <Component
            key={section.id}
            data={section.type === 'custom'
              ? { id: section.id, ...(content.customSections?.[section.id] || {}) }
              : content[section.type]}
            onCta={onCta}
            editableProps={{
              selected: selectedSection === section.id,
              onSelect: onSelectSection,
            }}
          >
            {section.type === 'questions' ? children : null}
          </Component>
        );
      })}
      <footer className="gr-footer"><div className="gr-wrap"><strong>✷ REDEEM</strong><span>{content.trust.operator} · UEN {content.trust.operatorUen}</span></div></footer>
    </div>
  );
}
