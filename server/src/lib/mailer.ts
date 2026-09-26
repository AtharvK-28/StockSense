import nodemailer from "nodemailer";
import { env } from "../env";

const transporter = env.smtp.host
  ? nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.port === 465,
      auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined,
    })
  : null;

export async function sendOtpEmail(to: string, name: string, code: string) {
  if (!transporter) {
    console.info(`[otp] SMTP not configured — reset code for ${to}: ${code}`);
    return;
  }
  await transporter.sendMail({
    from: env.smtp.from,
    to,
    subject: `${code} is your StockSense reset code`,
    text: `Hi ${name},\n\nYour StockSense password reset code is ${code}. It expires in 10 minutes and can be used once.\n\nIf you didn't ask for this, you can ignore this email.`,
    html: `<div style="font-family:system-ui,sans-serif;color:#222;max-width:420px">
      <h2 style="margin:0 0 12px">Reset your password</h2>
      <p>Hi ${name}, use this code to reset your StockSense password:</p>
      <p style="font-size:32px;letter-spacing:8px;font-weight:700;margin:24px 0">${code}</p>
      <p style="color:#6a6a6a">It expires in 10 minutes and can be used once. If you didn't ask for this, ignore this email.</p>
    </div>`,
  });
}
