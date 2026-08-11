/**
 * 122 — seed a comprehensive partner-category taxonomy.
 *
 * The taxonomy (migration 052) shipped empty and grew three hand-made rows;
 * every Add-business / pool / reward picker offered only those. This seeds the
 * SG-SME verticals Redeem Ops actually prospects, one-time and idempotently:
 * a name that already exists (case-insensitive) is left untouched, and a
 * category an admin later deletes is NEVER re-added — a migration runs once.
 *
 * Seeded fields: name + providerSearchTerms (what Discover sends to Google
 * Maps — the create-path default is [name], curated terms here where the name
 * alone searches poorly). igHashtags and categoryFilterWords stay NULL by
 * design: both are opt-in curation with no name fallback (052/065/074 notes).
 */

const SEED = [
  // ── F&B ──────────────────────────────────────────────────────────────────
  ['Cafe', ['cafe', 'coffee shop']],
  ['Restaurant', ['restaurant']],
  ['Bakery & Desserts', ['bakery', 'dessert shop', 'patisserie']],
  ['Bubble Tea', ['bubble tea shop']],
  ['Bars & Nightlife', ['bar', 'pub']],
  ['Hawker & Kopitiam', ['kopitiam', 'zi char', 'hawker stall']],
  // ── Beauty & grooming ────────────────────────────────────────────────────
  ['Beauty', ['beauty salon']],
  ['Hair Salon', ['hair salon', 'hairdresser']],
  ['Nail Salon', ['nail salon', 'manicure']],
  ['Facial & Skincare', ['facial spa', 'skincare clinic']],
  ['Spa & Massage', ['spa', 'massage therapist']],
  ['Aesthetics Clinic', ['aesthetic clinic', 'medical aesthetics']],
  ['Barbershop', ['barber shop']],
  ['Lashes & Brows', ['eyelash extension studio', 'brow studio']],
  // ── Fitness & sports ─────────────────────────────────────────────────────
  ['Gym & Fitness', ['gym', 'fitness studio']],
  ['Yoga & Pilates', ['yoga studio', 'pilates studio']],
  ['Martial Arts', ['martial arts school', 'muay thai gym']],
  ['Dance Studio', ['dance studio']],
  ['Gymnastics', ['gymnastics club', 'gymnastics school']],
  ['Swim School', ['swimming school', 'swimming lessons']],
  ['Climbing & Bouldering', ['bouldering gym', 'rock climbing gym']],
  ['Sports Academy', ['football academy', 'sports coaching']],
  // ── Health & wellness ────────────────────────────────────────────────────
  ['TCM & Acupuncture', ['tcm clinic', 'acupuncture clinic']],
  ['Dental Clinic', ['dental clinic', 'dentist']],
  ['Physio & Chiropractic', ['physiotherapy clinic', 'chiropractor']],
  ['Optical & Eyewear', ['optical shop', 'optician']],
  // ── Pets ─────────────────────────────────────────────────────────────────
  ['Pet Grooming', ['pet grooming']],
  ['Pet Hotels', ['pet hotel', 'pet boarding']],
  ['Pet Shop', ['pet shop', 'pet supplies store']],
  ['Veterinary Clinic', ['veterinary clinic', 'vet']],
  // ── Retail ───────────────────────────────────────────────────────────────
  ['Fashion & Apparel', ['clothing store', 'fashion boutique']],
  ['Jewellery', ['jewellery store']],
  ['Florist', ['florist', 'flower shop']],
  ['Gifts & Stationery', ['gift shop', 'stationery store']],
  ['Home & Living', ['home decor store', 'furniture store']],
  ['Electronics & Gadgets', ['electronics store', 'mobile phone shop']],
  // ── Kids & education ─────────────────────────────────────────────────────
  ['Tuition & Enrichment', ['tuition centre', 'enrichment centre']],
  ['Childcare & Preschool', ['childcare centre', 'preschool']],
  ['Kids Play & Parties', ['indoor playground', 'kids party venue']],
  // ── Services ─────────────────────────────────────────────────────────────
  ['Photography Studio', ['photography studio', 'photo studio']],
  ['Car Grooming & Workshop', ['car grooming', 'car workshop']],
  ['Laundry & Dry Cleaning', ['laundry service', 'dry cleaner']],
  ['Tailoring & Alterations', ['tailor', 'clothing alterations']],
  ['Travel Agency', ['travel agency']],
  // ── Leisure & entertainment ──────────────────────────────────────────────
  ['Attractions & Leisure', ['tourist attraction', 'leisure centre']],
  ['Karaoke', ['karaoke', 'ktv lounge']],
  ['Escape Rooms & Games', ['escape room', 'board game cafe']],
];

export async function up(queryInterface) {
  for (const [name, terms] of SEED) {
    await queryInterface.sequelize.query(
      `INSERT INTO redeem_ops_categories
              (id, name, "providerSearchTerms", "isActive", "createdAt", "updatedAt")
       SELECT gen_random_uuid(), :name, ARRAY[:terms]::text[], true, NOW(), NOW()
        WHERE NOT EXISTS (
          SELECT 1 FROM redeem_ops_categories WHERE lower(name) = lower(:name)
        )`,
      { replacements: { name, terms } }
    );
  }
}

export async function down(queryInterface) {
  // Mirror deleteCategory's stance: remove a seeded row only while nothing
  // references its name — rows in use (or admin-edited names) are left alone.
  await queryInterface.sequelize.query(
    `DELETE FROM redeem_ops_categories c
      WHERE c.name IN (:names)
        AND NOT EXISTS (SELECT 1 FROM partner_organisations p WHERE p.category = c.name)
        AND NOT EXISTS (SELECT 1 FROM prospecting_pools pp WHERE pp.category = c.name)
        AND NOT EXISTS (SELECT 1 FROM reward_offers r WHERE r.category = c.name)`,
    { replacements: { names: SEED.map(([name]) => name) } }
  );
}
