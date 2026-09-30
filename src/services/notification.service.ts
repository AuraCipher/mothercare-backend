import type { CredentialRecipientType } from './twilio-whatsapp.service';
import { enqueueCredentialSend } from '../queues/message.queue';
import type { SendCredentialResult } from './credential-delivery.service';

interface NotificationService {
  sendCredential(params: {
    to: string;
    username: string;
    password: string;
    name: string;
    recipientType: CredentialRecipientType;
    /** Staff only — required for staff_wc {{1}}. */
    designation?: string;
    /** Student only — required for student_wc {{2}}. */
    className?: string;
    website?: string;
  }): Promise<SendCredentialResult>;
}

const notificationService: NotificationService = {
  async sendCredential(params) {
    return enqueueCredentialSend(params, { wait: true });
  },
};

export default notificationService;
export type { SendCredentialResult };
