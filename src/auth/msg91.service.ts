import { config } from '../config/env';
import { ValidationError } from '../utils/errors';
import { logger } from '../utils/logger';

const MSG91_BASE_URL = 'https://control.msg91.com/api/v5';

interface VerifyAccessTokenResponse {
  type: 'success' | 'error';
  message: string;
  code?: string;
  // MSG91 response can have phone in different places
  data?: {
    mobile?: string;
    email?: string;
    country_code?: string;
  };
  // Some responses have these at root level
  mobile?: string;
  country_code?: string;
  identifier?: string; // Could be phone or email
}

export class Msg91Service {
  private authKey: string;
  private widgetId: string;
  private tokenAuth: string;

  constructor() {
    this.authKey = config.msg91.authKey;
    this.widgetId = config.msg91.widgetId;
    this.tokenAuth = config.msg91.tokenAuth; // Corresponds to 'tokenAuth' in widget config
  }

  /**
   * Get widget configuration for frontend initialization
   * Returns widgetId and tokenAuth needed to initialize MSG91 widget
   */
  getWidgetConfig() {
    return {
      widgetId: this.widgetId,
      tokenAuth: this.tokenAuth,
    };
  }

  /**
   * Verify access token received from MSG91 OTP Widget on frontend.
   *
   * Flow:
   * 1. Frontend loads MSG91 widget with widgetId (configured in HTML)
   * 2. User enters phone, receives OTP, enters OTP via widget UI
   * 3. Widget returns JWT access token on success
   * 4. Frontend sends access token to backend
   * 5. Backend calls this method to verify token and get phone number
   */
  async verifyWidgetToken(accessToken: string): Promise<{ phone: string }> {
    // DEVELOPMENT MOCK BYPASS
    // Allows testing without MSG91 IP Whitelisting
    if (config.nodeEnv === 'development' && accessToken.startsWith('mock_')) {
      logger.warn('⚠️ USING MOCK MSG91 VERIFICATION - BYPASSING API CALL');
      return { phone: '+919876543210' };
    }

    // Debug logging
    const payload = {
      authkey: this.authKey, // AuthKey must be in the body per documentation
      'access-token': accessToken,
      widgetId: this.widgetId, // keeping widgetId as it's often required for widget-specific verification
    };
    logger.info('MSG91 Verifying Token:', {
      ...payload,
      authkey: this.authKey ? `${this.authKey.substring(0, 5)}...` : 'MISSING'
    });

    const response = await fetch(`${MSG91_BASE_URL}/widget/verifyAccessToken`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        // 'authkey': this.authKey, // Removed from header as it is now in body
      },
      body: JSON.stringify(payload),
    });

    let data = (await response.json()) as VerifyAccessTokenResponse;
    logger.info('MSG91 Verification Response:', data);

    // If main Auth Key fails, try verifying with the Widget Token Auth key
    if (data.type === 'error' && (data.message === 'AuthenticationFailure' || data.code === '418') && this.tokenAuth) {
      logger.warn('MSG91 master key failed. Retrying verification using Widget Token Auth...');

      try {
        const retryResponse = await fetch(`${MSG91_BASE_URL}/widget/verifyAccessToken`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify({
            authkey: this.tokenAuth, // Use the widget's tokenAuth in body
            'access-token': accessToken,
            widgetId: this.widgetId,
          }),
        });

        const retryData = await retryResponse.json() as VerifyAccessTokenResponse;
        logger.info('MSG91 Retry Verification Response:', retryData);

        if (retryData.type === 'success') {
          data = retryData; // Use the successful response
        }
      } catch (retryErr) {
        logger.error('Retry with tokenAuth also failed', retryErr);
      }
    }

    if (data.type !== 'success') {
      logger.error('MSG91 widget token verification failed', { response: data });

      if (data.code === '418') {
        throw new ValidationError('MSG91 IP Whitelist restriction. Add your server IP to MSG91 API Security settings.');
      }

      throw new ValidationError(data.message || 'Invalid or expired OTP token');
    }

    // Extract phone from response - MSG91 returns phone in 'message' field on success!
    // Response format: { message: '916202923165', type: 'success' }
    const mobile = data.message || data.data?.mobile || data.mobile || data.identifier;
    const countryCode = data.data?.country_code || data.country_code || '91';

    logger.info('MSG91 extracted data:', { mobile, countryCode, fullResponse: JSON.stringify(data) });

    if (!mobile) {
      logger.error('MSG91 token verified but no mobile in response', { response: data });
      throw new ValidationError('Could not extract phone number from verification. Response: ' + JSON.stringify(data));
    }

    // Format phone as +countryCode+mobile (e.g., +919876543210)
    // If mobile already includes country code, don't add it again
    let phone: string;
    if (mobile.startsWith('+')) {
      phone = mobile;
    } else if (mobile.startsWith(countryCode)) {
      phone = `+${mobile}`;
    } else {
      phone = `+${countryCode}${mobile}`;
    }

    logger.info('MSG91 widget token verified', { phone });
    return { phone };
  }

}

export const msg91Service = new Msg91Service();
