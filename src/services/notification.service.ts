import twilio from 'twilio';
import env from '../config/env';

// Initialize Twilio client
const twilioClient = twilio(
  env.TWILIO_ACCOUNT_SID,
  env.TWILIO_AUTH_TOKEN
);

interface NotificationService {
  sendOTP(params: { phone: string; otp: string; name: string }): Promise<void>;
  sendCredential(params: {
    to: string;
    username: string;
    password: string;
    name: string;
  }): Promise<{ success: boolean; messageStatus?: string }>;
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
  },

  /**
   * Send login credentials via WhatsApp using Twilio
   */
  async sendCredential({ to, username, password, name }: {
    to: string;
    username: string;
    password: string;
    name: string;
  }): Promise<{ success: boolean; messageStatus?: string }> {
    try {
      const formattedTo = to.startsWith('+') ? `whatsapp:${to}` : `whatsapp:+${to}`;
      const from = `whatsapp:${env.TWILIO_WHATSAPP_NUMBER}`;

      const message = await twilioClient.messages.create({
        from,
        to: formattedTo,
        body: `Welcome to Mother Care School, ${name}!

We are delighted to have you and your family as part of our school community. This is your personal login to stay connected with your child's academic journey.

Login Credentials:
👤 Username: ${username}
🔑 Password: ${password}

─────────────────────
🌐 Web Portal:
Login with same credentials on your browser to access full detail reports, attendance, fees & more.
${env.FRONTEND_URL || 'https://mothercare.pk'}

📱 MCS Messaging App:
Download our app to receive instant push notifications for homework, class activities, messages from teachers & principal.
${env.APP_DOWNLOAD_URL || 'https://play.google.com/store/apps/details?id=com.mothercare.app'}

─────────────────────
⚠️ If you forget your password, contact the school management to get a new one.

Keep your credentials safe. Do not share your password.`,
      });

      return { success: true, messageStatus: message.status };
    } catch (error: any) {
      console.error('Failed to send WhatsApp credential:', error.message);
      return { success: false, messageStatus: error.message || 'Failed' };
    }
  }
};

export default notificationService;