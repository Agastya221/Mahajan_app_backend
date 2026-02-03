import { config } from '../config/env';
import { ValidationError } from '../utils/errors';
import { logger } from '../utils/logger';

const MSG91_BASE_URL = 'https://control.msg91.com/api/v5';

export class Msg91Service {
  private authKey: string;
  private templateId: string;
  private otpLength: number;

  constructor() {
    this.authKey = config.msg91.authKey;
    this.templateId = config.msg91.templateId;
    this.otpLength = config.msg91.otpLength;
  }

  async sendOTP(phone: string): Promise<{ type: string }> {
    // Ensure phone is in format with country code (e.g., 91XXXXXXXXXX)
    const formattedPhone = this.formatPhone(phone);

    const response = await fetch(`${MSG91_BASE_URL}/otp?template_id=${this.templateId}&mobile=${formattedPhone}&otp_length=${this.otpLength}`, {
      method: 'POST',
      headers: {
        'authkey': this.authKey,
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json() as { type: string; message?: string };

    if (data.type !== 'success') {
      logger.error('MSG91 send OTP failed', { phone: formattedPhone, response: data });
      throw new ValidationError(data.message || 'Failed to send OTP');
    }

    logger.info('OTP sent', { phone: formattedPhone });
    return { type: 'success' };
  }

  async verifyOTP(phone: string, otp: string): Promise<{ type: string }> {
    const formattedPhone = this.formatPhone(phone);

    const response = await fetch(`${MSG91_BASE_URL}/otp/verify?mobile=${formattedPhone}&otp=${otp}`, {
      method: 'POST',
      headers: {
        'authkey': this.authKey,
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json() as { type: string; message?: string };

    if (data.type !== 'success') {
      logger.error('MSG91 verify OTP failed', { phone: formattedPhone, response: data });
      throw new ValidationError('Invalid or expired OTP');
    }

    logger.info('OTP verified', { phone: formattedPhone });
    return { type: 'success' };
  }

  async resendOTP(phone: string, retryType?: 'voice' | 'text'): Promise<{ type: string }> {
    const formattedPhone = this.formatPhone(phone);

    const url = retryType
      ? `${MSG91_BASE_URL}/otp/retry?mobile=${formattedPhone}&retrytype=${retryType}`
      : `${MSG91_BASE_URL}/otp/retry?mobile=${formattedPhone}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'authkey': this.authKey,
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json() as { type: string; message?: string };

    if (data.type !== 'success') {
      logger.error('MSG91 resend OTP failed', { phone: formattedPhone, response: data });
      throw new ValidationError(data.message || 'Failed to resend OTP');
    }

    logger.info('OTP resent', { phone: formattedPhone, retryType });
    return { type: 'success' };
  }

  private formatPhone(phone: string): string {
    // Strip any spaces, dashes, parens
    let cleaned = phone.replace(/[\s\-()]/g, '');

    // If starts with +, remove it (MSG91 expects without +)
    if (cleaned.startsWith('+')) {
      cleaned = cleaned.substring(1);
    }

    // If it's 10 digits (Indian number without country code), prepend 91
    if (cleaned.length === 10 && /^\d{10}$/.test(cleaned)) {
      cleaned = '91' + cleaned;
    }

    return cleaned;
  }
}

export const msg91Service = new Msg91Service();
