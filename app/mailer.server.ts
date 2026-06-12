// 可插拔邮件适配器。统计写入我们自己的 EmailLog，不依赖邮件商。
//  - dev / Node：SMTP（Nodemailer，动态导入，避免 Workers 静态打包 Node 依赖）
//  - 生产 / Cloudflare Workers：Resend（纯 HTTP fetch，无需 TCP）
// 选择规则：设置了 RESEND_API_KEY → Resend；否则 → SMTP。
// 调用方（subscription.server）零改动。

export interface MailInput {
  to: string;
  subject: string;
  html: string;
  fromName: string;
  fromEmail: string;
}

export interface MailResult {
  ok: boolean;
  error?: string;
}

export interface MailerAdapter {
  send(input: MailInput): Promise<MailResult>;
}

// ── Resend 适配器（HTTP，Workers 友好）─────────────────────────────
// 环境变量：RESEND_API_KEY
class ResendMailer implements MailerAdapter {
  async send(input: MailInput): Promise<MailResult> {
    try {
      const resp = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: `${input.fromName} <${input.fromEmail}>`,
          to: [input.to],
          subject: input.subject,
          html: input.html,
        }),
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        return { ok: false, error: `Resend ${resp.status}: ${text.slice(0, 200)}` };
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
}

// ── SMTP 适配器（Nodemailer，动态导入）──────────────────────────────
// 环境变量：SMTP_HOST, SMTP_PORT, SMTP_SECURE(true/false), SMTP_USER, SMTP_PASS
class SmtpMailer implements MailerAdapter {
  private transporter: any = null;

  private async getTransporter() {
    if (this.transporter) return this.transporter;
    const nodemailer = (await import("nodemailer")).default;
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === "true",
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
    return this.transporter;
  }

  async send(input: MailInput): Promise<MailResult> {
    if (!process.env.SMTP_HOST) {
      console.log(
        `[mailer:dev] 未配置 SMTP/Resend，邮件未真正发送 → to=${input.to} subject="${input.subject}"`,
      );
      return { ok: true };
    }
    try {
      const transporter = await this.getTransporter();
      await transporter.sendMail({
        from: `"${input.fromName}" <${input.fromEmail}>`,
        to: input.to,
        subject: input.subject,
        html: input.html,
      });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
}

// 单例：有 Resend key 用 Resend，否则用 SMTP（dev）。
export const mailer: MailerAdapter = process.env.RESEND_API_KEY
  ? new ResendMailer()
  : new SmtpMailer();
