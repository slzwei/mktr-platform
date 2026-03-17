import * as provisioningService from '../services/provisioningService.js';

export const createSession = async (req, res) => {
  try {
    const result = await provisioningService.createSession({
      sessionCode: req.body.sessionCode,
      ipAddress: req.body.ipAddress || req.ip
    });

    if (result.error) {
      return res.status(result.status).json({ message: result.error });
    }

    if (result.alreadyExists) {
      return res.json({ success: true, message: 'Session already exists' });
    }

    res.json({ success: true, expiresAt: result.expiresAt });
  } catch (error) {
    console.error('Error creating provisioning session:', error);
    res.status(500).json({ message: 'Internal Error' });
  }
};

export const checkSession = async (req, res) => {
  try {
    const result = await provisioningService.checkSession(req.params.code);

    if (!result) {
      return res.status(404).json({ status: 'not_found' });
    }

    if (result.status === 'fulfilled') {
      return res.json({ status: 'fulfilled', deviceKey: result.deviceKey });
    }

    res.json({ status: result.status });
  } catch (error) {
    console.error('Error polling session:', error);
    res.status(500).json({ message: 'Internal Error' });
  }
};

export const fulfillSession = async (req, res) => {
  try {
    const result = await provisioningService.fulfillSession(req.body);

    if (result.error) {
      return res.status(result.status).json({ message: result.error });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Error fulfilling session:', error);
    res.status(500).json({ message: 'Error fulfilling session' });
  }
};
