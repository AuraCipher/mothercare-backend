import type { TemplateOptions } from '../types';

export function adminInvitationEmailHtml(
  token: string,
  email: string,
  branchName: string,
  branchCode: string,
  options: TemplateOptions,
): string {
  const registerUrl = `${options.frontendUrl}/register-admin?token=${encodeURIComponent(token)}`;
  const schoolName = options.schoolName || 'Mother Care School';
  const currentYear = new Date().getFullYear();

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light dark">
  <meta name="x-apple-disable-message-reformatting">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>You're invited to manage ${branchName} — ${schoolName}</title>
  <!--[if mso]>
  <noscript>
    <xml>
      <o:OfficeDocumentSettings>
        <o:PixelsPerInch>96</o:PixelsPerInch>
      </o:OfficeDocumentSettings>
    </xml>
  </noscript>
  <![endif]-->
  <style type="text/css">
    @media only screen and (max-width: 600px) {
      .email-container { width: 100% !important; max-width: 100% !important; }
      .email-padding { padding: 32px 16px !important; }
      .email-body-padding { padding: 24px 20px !important; }
      .email-footer-padding { padding: 16px 20px !important; }
      .email-button { display: block !important; width: 100% !important; padding: 16px 0 !important; text-align: center !important; font-size: 18px !important; }
      .email-header-title { font-size: 24px !important; }
      .email-body-text { font-size: 16px !important; }
      .email-footer-text { font-size: 11px !important; }
      .email-info-table { width: 100% !important; }
      .email-info-cell { display: block !important; width: 100% !important; padding: 8px 0 !important; border-bottom: 1px solid #332e2b !important; }
    }
    @media only screen and (max-width: 400px) {
      .email-padding { padding: 24px 12px !important; }
      .email-body-padding { padding: 20px 16px !important; }
      .email-header-title { font-size: 22px !important; }
      .email-button { font-size: 16px !important; }
    }
  </style>
</head>
<body style="margin:0;padding:0;background-color:#1a1614;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#1a1614;">
    <tr>
      <td align="center" style="padding:40px 16px;">
        <!--[if mso]><table role="presentation" width="600" cellpadding="0" cellspacing="0" align="center"><tr><td><![endif]-->
        <table role="presentation" class="email-container" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background-color:#24201e;border-radius:12px;overflow:hidden;border:1px solid #332e2b;">
          <!-- Header -->
          <tr>
            <td class="email-padding" style="padding:40px 40px 24px;text-align:center;background:linear-gradient(135deg,#2d2826,#1a1614);border-bottom:1px solid #332e2b;">
              <div style="width:56px;height:56px;margin:0 auto 16px;background:rgba(183,154,118,0.12);border-radius:50%;display:flex;align-items:center;justify-content:center;">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#b79a76" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M22 10v6M2 10l10-5 10 5-10 5z"/>
                  <path d="M6 12v5c3 3 9 3 12 0v-5"/>
                </svg>
              </div>
              <h1 class="email-header-title" style="color:#e8e0d8;font-size:26px;margin:0;font-weight:300;letter-spacing:-0.3px;">${schoolName}</h1>
              <p style="color:#b79a76;font-size:12px;margin:8px 0 0;text-transform:uppercase;letter-spacing:1px;font-weight:500;">Admin Invitation</p>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td class="email-body-padding" style="padding:36px 40px;">
              <p class="email-body-text" style="font-size:15px;color:#a09888;line-height:1.6;margin:0 0 6px;">Dear Administrator,</p>
              <p class="email-body-text" style="font-size:15px;color:#a09888;line-height:1.6;margin:0 0 20px;">
                You have been invited to join <strong style="color:#e8e0d8;">${schoolName}</strong>
                as a branch administrator for <strong style="color:#e8e0d8;">${branchName}</strong>.
                Click the button below to set up your account and start managing your campus.
              </p>

              <!-- Info Table -->
              <table role="presentation" class="email-info-table" width="100%" cellpadding="0" cellspacing="0" style="background-color:#1a1614;border:1px solid #332e2b;border-radius:10px;margin-bottom:28px;">
                <tr>
                  <td style="padding:16px 20px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td class="email-info-cell" style="padding:8px 0;border-bottom:1px solid #332e2b;">
                          <table role="presentation" cellpadding="0" cellspacing="0">
                            <tr>
                              <td style="vertical-align:middle;padding-right:10px;">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#b79a76" stroke-width="1.5">
                                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                                  <circle cx="12" cy="10" r="3"/>
                                </svg>
                              </td>
                              <td style="vertical-align:middle;">
                                <span style="font-size:11px;color:#7a7068;text-transform:uppercase;letter-spacing:0.5px;">Branch</span>
                                <span style="font-size:14px;color:#e8e0d8;margin-left:12px;">${branchName} (${branchCode})</span>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                      <tr>
                        <td class="email-info-cell" style="padding:8px 0;border-bottom:1px solid #332e2b;">
                          <table role="presentation" cellpadding="0" cellspacing="0">
                            <tr>
                              <td style="vertical-align:middle;padding-right:10px;">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#b79a76" stroke-width="1.5">
                                  <rect x="2" y="4" width="20" height="16" rx="2"/>
                                  <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/>
                                </svg>
                              </td>
                              <td style="vertical-align:middle;">
                                <span style="font-size:11px;color:#7a7068;text-transform:uppercase;letter-spacing:0.5px;">Email</span>
                                <span style="font-size:14px;color:#e8e0d8;margin-left:12px;">${email}</span>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                      <tr>
                        <td class="email-info-cell" style="padding:8px 0;">
                          <table role="presentation" cellpadding="0" cellspacing="0">
                            <tr>
                              <td style="vertical-align:middle;padding-right:10px;">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#b79a76" stroke-width="1.5">
                                  <circle cx="12" cy="12" r="10"/>
                                  <polyline points="12 6 12 12 16 14"/>
                                </svg>
                              </td>
                              <td style="vertical-align:middle;">
                                <span style="font-size:11px;color:#7a7068;text-transform:uppercase;letter-spacing:0.5px;">Expires</span>
                                <span style="font-size:14px;color:#e8e0d8;margin-left:12px;">7 days from now</span>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Button -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding:8px 0 24px;">
                    <!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${registerUrl}" style="height:50px;v-text-anchor:middle;width:220px;" arcsize="12%" stroke="f" fillcolor="#b79a76"><w:anchorlock/><center><![endif]-->
                    <a href="${registerUrl}" class="email-button" style="display:inline-block;padding:15px 40px;background-color:#b79a76;color:#1a1614;text-decoration:none;border-radius:10px;font-size:15px;font-weight:600;mso-hide:all;">Accept Invitation</a>
                    <!--[if mso]></center></v:roundrect><![endif]-->
                  </td>
                </tr>
              </table>

              <p style="font-size:13px;color:#6a6258;margin:0;text-align:center;line-height:1.5;">
                This invitation link is unique and can only be used once.
              </p>
              <p style="font-size:13px;color:#6a6258;margin:4px 0 0;text-align:center;line-height:1.5;">
                If you didn't expect this invitation, you can ignore this email.
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td class="email-footer-padding" style="padding:16px 40px;border-top:1px solid #332e2b;background-color:#1a1614;">
              <p class="email-footer-text" style="font-size:12px;color:#6a6258;margin:0 0 4px;text-align:center;">
                ${schoolName} &mdash; Nurturing young minds, shaping futures.
              </p>
              <p class="email-footer-text" style="font-size:11px;color:#5a5248;margin:0;text-align:center;">
                &copy; ${currentYear} ${schoolName}. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
        <!--[if mso]></td></tr></table><![endif]-->
      </td>
    </tr>
  </table>
</body>
</html>`;
}
