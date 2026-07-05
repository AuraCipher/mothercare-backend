import type { CredentialRecipientType } from './meta-whatsapp.service';
import { enqueueCredentialSend } from '../queues/message.queue';
import type { SendCredentialResult } from './credential-delivery.service';

interface NotificationService {
  sendCredential(params: {
    to: string;
    username: string;
    password: string;
    name: string;
    recipientType: CredentialRecipientType;
  }): Promise<SendCredentialResult>;
}

const notificationService: NotificationService = {
  async sendCredential(params) {
    return enqueueCredentialSend(params, { wait: true });
  },
};

export default notificationService;
export type { SendCredentialResult };
