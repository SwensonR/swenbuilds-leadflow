const MAILGUN_API_KEY = process.env.MAILGUN_API_KEY;
const MAILGUN_DOMAIN = process.env.MAILGUN_DOMAIN;
const MAILGUN_FROM = process.env.MAILGUN_FROM;

export async function sendMailgunEmail(to: string, subject: string, text: string) {
  if (!MAILGUN_API_KEY || !MAILGUN_DOMAIN || !MAILGUN_FROM) {
    console.log('[Mailgun] Missing config, cannot send email');
    return { ok: false, error: 'missing_config' };
  }

  const url = `https://api.mailgun.net/v3/${MAILGUN_DOMAIN}/messages`;
  const body = new URLSearchParams();
  body.append('from', MAILGUN_FROM);
  body.append('to', to);
  body.append('subject', subject);
  body.append('text', text);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`api:${MAILGUN_API_KEY}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  if (!res.ok) {
    const txt = await res.text();
    console.log('[Mailgun] send error', res.status, txt);
    return { ok: false, error: txt };
  }

  const data = await res.json().catch(() => null);
  return { ok: true, data };
}

export default sendMailgunEmail;
