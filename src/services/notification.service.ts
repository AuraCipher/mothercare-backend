import twilio from 'twilio';
import env from '../config/env';

// Initialize Twilio client
const twilioClient = twilio(
  env.TWILIO_ACCOUNT_SID,
  env.TWILIO_AUTH_TOKEN
);

interface NotificationService {
  sendOTP(params: { phone: string; otp: string; name: string }): Promise<void>;
  // Other notification methods can be added here (email, WhatsApp, etc.)
}

const notificationService: NotificationService = {
  /**
   * Send OTP via SMS using Twilio
   */
  async sendOTP({ phone, otp, name }: { phone: string; otp: string; name: string }): Promise<void> {
    try {
      // Format phone number for Twilio (assuming it's already in international format)
      const formattedPhone = phone.startsWith('+') ? phone : `+${phone}`;

      await twilioClient.messages.create({
        body: `Hello ${name}, your Mother Care School verification code is: ${otp}. This code will expire in ${env.OTP_EXPIRY_MINUTES} minutes.`,
        from: env.TWILIO_PHONE_NUMBER,
        to: formattedPhone,
      });

      console.log(`OTP sent successfully to ${phone}`);
    } catch (error) {
      console.error('Failed to send OTP:', error);
      // In production, you might want to throw this error or handle it differently
      // For now, we'll log it but not fail the OTP generation process
      // The OTP is still valid in Redis, so user can still try to verify it
      throw new Error('Failed to send OTP. Please try again.');
    }
  }
};

export default notificationService;