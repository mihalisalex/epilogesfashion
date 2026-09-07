import "server-only";
import { Resend } from "resend";
import { prisma } from "@/lib/prisma";
import { isUndeliverableAddress } from "@/lib/email/deliverability";
import { logger } from "@/lib/logger";
import type { EmailMessage, EmailProvider } from "@/lib/email/types";

/**
 * Real sending via Resend, still logged to `EmailLog` (same as the dev provider) so
 * the admin Emails page keeps working as the audit trail regardless of provider.
 * A send failure throws — callers already wrap every `.send()` call in try/catch
 * (order confirmation, shipping updates, password reset, welcome) so a Resend outage
 * degrades to "no email sent" rather than failing the underlying order/action.
 */
export function createResendEmailProvider(input: { apiKey: string; from: string }): EmailProvider {
  const resend = new Resend(input.apiKey);
  return {
    async send(message: EmailMessage) {
      /**
       * Reserved addresses are dropped here, at the only place that can actually put a
       * message on the wire, rather than in each job that might produce one. There is more
       * than one path to a test address — the e2e suite's checkout, a seeded customer, a
       * typo — and a guard per path is a guard that gets forgotten on the next path.
       *
       * Returns rather than throws, which is the deliberate half. Callers treat a throw as a
       * send failure: `runAbandonedCartRecovery` would count it as failed and, crucially,
       * would not set `abandonedCartEmailSentAt` — so the same cart would be retried every
       * single day, warning every time, forever. Skipping quietly and letting the caller mark
       * it handled is the behaviour that ends rather than repeats. The warning is the record
       * that it happened, and no `EmailLog` row is written because nothing was sent: a row
       * here would put mail in the admin Emails page that does not exist, which is the exact
       * defect the provider-switch comment above this function describes.
       */
      if (isUndeliverableAddress(message.to)) {
        logger.warn("Skipped email to a reserved, undeliverable address", {
          to: message.to,
          template: message.template,
        });
        return;
      }

      const { error } = await resend.emails.send({
        from: input.from,
        to: message.to,
        subject: message.subject,
        html: message.html,
        text: message.text,
      });
      if (error) throw new Error(`Resend send failed: ${error.message}`);

      await prisma.emailLog.create({
        data: {
          to: message.to,
          subject: message.subject,
          html: message.html,
          text: message.text,
          template: message.template,
        },
      });
    },
  };
}
