import path from 'path';

// Seed a development user using the existing backend Sequelize User model and hooks
export async function seedDevUser() {
  try {
    if (process.env.NODE_ENV === 'production') return; // no-op in production

    const seedEmail = process.env.SEED_EMAIL || 'test@mktr.sg';
    const seedPassword = process.env.SEED_PASSWORD || 'test';

    // Dynamically import backend User model; it brings its own Sequelize connection and bcrypt hooks
    const userModulePath = path.resolve(
      path.dirname(new URL(import.meta.url).pathname),
      '../../../backend/src/models/User.js'
    );
    const { default: User } = await import(userModulePath);

    // Ensure table exists (backend DB should already be initialized); try a simple query
    const existing = await User.findOne({ where: { email: seedEmail } });
    if (existing) {
      return; // leave as-is
    }

    await User.create({
      email: seedEmail,
      password: seedPassword,
      role: 'admin',
      emailVerified: true,
      isActive: true,
      firstName: 'Dev',
      lastName: 'User'
    }, { validate: false });

    console.log(`[auth-service] Seeded dev user: ${seedEmail}`);
  } catch (err) {
    // Silent failure in dev shouldn't break the service; log for visibility
    console.warn('[auth-service] Dev user seed skipped or failed:', err?.message || err);
  }
}


