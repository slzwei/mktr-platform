import { useState } from 'react';

/* Accordion over the rm-faq classes (marketplace.css). items: [{ q, a }]. */
export default function FaqList({ items }) {
  const [open, setOpen] = useState(-1);
  return (
    <div>
      {items.map((f, i) => {
        const isOpen = open === i;
        return (
          <div key={f.q} className="rm-faq-row">
            <button className="rm-faq-q" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? -1 : i)}>
              <span>{f.q}</span>
              <span className={`rm-faq-sym${isOpen ? ' is-open' : ''}`} aria-hidden="true">+</span>
            </button>
            <div className={`rm-faq-reveal${isOpen ? ' is-open' : ''}`}>
              <div className="rm-faq-clip">
                <div className="rm-faq-a">{f.a}</div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
