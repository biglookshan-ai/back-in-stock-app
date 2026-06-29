// 一次性 / 临时邮箱域名黑名单（常见的几十个）。
// storefront 订阅时挡掉，减少垃圾订阅、保护发件信誉。
const DISPOSABLE = new Set<string>([
  "mailinator.com", "10minutemail.com", "guerrillamail.com", "guerrillamail.info",
  "guerrillamail.biz", "guerrillamail.de", "sharklasers.com", "grr.la", "spam4.me",
  "trashmail.com", "trashmail.de", "trashmail.net", "yopmail.com", "yopmail.fr",
  "tempmail.com", "temp-mail.org", "tempmailo.com", "tempmail.net", "throwawaymail.com",
  "getnada.com", "nada.email", "maildrop.cc", "mailnesia.com", "mintemail.com",
  "dispostable.com", "fakeinbox.com", "mailcatch.com", "mohmal.com", "emailondeck.com",
  "moakt.com", "mytemp.email", "tempr.email", "discard.email", "spambox.us",
  "mailtemp.info", "burnermail.io", "tmpmail.org", "tmpmail.net", "33mail.com",
  "anonbox.net", "fakemail.net", "harakirimail.com", "incognitomail.com", "mailsac.com",
  "spamgourmet.com", "tempinbox.com", "vomoto.com", "wegwerfmail.de", "trbvm.com",
  "0wnd.net", "0wnd.org", "cock.li", "emailtemporanea.com", "luxusmail.org",
]);

// 邮箱是否属于一次性域名（大小写不敏感）
export function isDisposableEmail(email: string): boolean {
  const domain = email.trim().toLowerCase().split("@")[1] ?? "";
  return DISPOSABLE.has(domain);
}
