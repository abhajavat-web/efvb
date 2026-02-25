const NIMBUS_BASE_URL = 'https://api.nimbuspost.com/v1';

let cachedToken = null;
let tokenExpiry = null;

/**
 * Login to NimbusPost to get API Token
 */
async function login() {
    try {
        const response = await fetch(`${NIMBUS_BASE_URL}/users/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: process.env.NIMBUS_EMAIL,
                password: process.env.NIMBUS_PASSWORD
            })
        });

        const result = await response.json();
        if (result.status && result.data) {
            cachedToken = result.data;
            // Token usually lasts for a long time, but let's assume valid unless 401
            return cachedToken;
        } else {
            throw new Error(result.message || 'NimbusPost Login Failed');
        }
    } catch (error) {
        console.error('NimbusPost Login Error:', error.message);
        throw error;
    }
}

/**
 * Get Tracking Data for an AWB
 */
async function trackShipment(awb) {
    if (!cachedToken) {
        await login();
    }

    try {
        // Try POST first as it's more common in recent docs
        const response = await fetch(`${NIMBUS_BASE_URL}/shipments/track`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${cachedToken}`
            },
            body: JSON.stringify({ awb })
        });

        let result = await response.json();

        // Handle Token Expired (common code 401)
        if (result.status === false && (result.message?.includes('expired') || result.message?.includes('token'))) {
            await login();
            return trackShipment(awb);
        }

        return result;
    } catch (error) {
        console.error('NimbusPost Tracking Error:', error.message);
        throw error;
    }
}

/**
 * Create a new shipment/order in NimbusPost
 */
async function createShipment(orderData) {
    if (!cachedToken) {
        await login();
    }

    try {
        const response = await fetch(`${NIMBUS_BASE_URL}/shipments/create`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${cachedToken}`
            },
            body: JSON.stringify(orderData)
        });

        let result = await response.json();

        // Handle Token Expired
        if (result.status === false && (result.message?.includes('expired') || result.message?.includes('token'))) {
            await login();
            return createShipment(orderData);
        }

        return result;
    } catch (error) {
        console.error('NimbusPost Create Shipment Error:', error.message);
        throw error;
    }
}

module.exports = {
    login,
    trackShipment,
    createShipment
};
