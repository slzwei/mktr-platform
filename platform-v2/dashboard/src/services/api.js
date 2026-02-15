const API_URL = 'https://dooh-backend.onrender.com/api';

export const screensApi = {
    getAll: async () => {
        const res = await fetch(`${API_URL}/screens`);
        if (!res.ok) throw new Error('Failed to fetch screens');
        return res.json();
    },

    register: async (name, pairingCode) => {
        const res = await fetch(`${API_URL}/screens`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, pairing_code: pairingCode })
        });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || 'Failed to register screen');
        }
        return res.json();
    }
};
