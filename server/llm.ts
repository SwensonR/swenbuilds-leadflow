type LLMResult = Partial<{
  patientName: string;
  service: string;
  appointmentDate: string;
  appointmentTime: string;
  email: string;
  phone: string;
  dentist: string;
  notes: string;
}> | null;

async function tryParseJSON(content: string) {
  try {
    return JSON.parse(content) as LLMResult;
  } catch {
    const m = content.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]) as LLMResult;
      } catch {
        return null;
      }
    }
    return null;
  }
}

function getTodayContext() {
  const now = new Date();
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  return `${days[now.getDay()]}, ${months[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`;
}

export async function extractWithLLM(text: string): Promise<LLMResult> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    console.log('[LLM] No OPENAI_API_KEY, skipping LLM extraction');
    return null;
  }

  const today = getTodayContext();
  console.log('[LLM] Extracting for date context:', today);

  const system = `You are a dental office scheduling assistant parsing inbound appointment request emails.

Today is ${today}. Use this to resolve relative dates like "this Wednesday", "next Monday", "tomorrow", "next week", etc.

Return ONLY a valid JSON object with these fields (omit any field you are not confident about — do NOT guess or fill in blanks):
- patientName: string — full name (first and last) preferred. Include if at least a first name is given.
- service: string — the specific dental service or reason for visit (e.g. "cleaning", "filling", "crown", "whitening", "exam", "checkup", "extraction", "root canal", "toothache", "broken tooth"). Only include if the patient named a specific type of work or reason. "An appointment", "come in", "schedule something" = no service field.
- appointmentDate: string — YYYY-MM-DD. Resolve relative references using today's date. "This Wednesday" means the coming Wednesday.
- appointmentTime: string — HH:MM in 24-hour format
- email: string — patient's email address (not the sender header, only if mentioned in the message body)
- phone: string — patient's phone number
- dentist: string — requested dentist name, only if explicitly mentioned
- notes: string — any other relevant context or requests

Rules:
- If you are not confident about a field, omit it entirely. Do not return null, empty strings, or placeholder values.
- Do not infer a service from vague phrases. "An appointment", "come in", "schedule something" = no service field.
- Return ONLY the JSON object, no explanation, no markdown.`;

  const payload = {
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: text },
    ],
    temperature: 0.0,
    max_tokens: 512,
  };

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errorText = await res.text();
      console.log('[LLM] API error:', res.status, errorText);
      return null;
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      console.log('[LLM] No content in response:', data);
      return null;
    }

    console.log('[LLM] Raw response:', content);
    const parsed = await tryParseJSON(content);
    console.log('[LLM] Parsed result:', parsed);
    return parsed;
  } catch (err) {
    console.log('[LLM] Error during extraction:', err);
    return null;
  }
}

export default extractWithLLM;

export async function generateFollowUp(originalMessage: string, missingFields: string[]) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;

  const fieldDescriptions: Record<string, string> = {
    'full name': 'your full first and last name',
    'service': 'the reason for your visit or type of service needed (e.g. cleaning, filling, exam)',
    'preferred date': 'your preferred appointment date',
    'preferred time': 'your preferred appointment time',
    'phone': 'a phone number where we can reach you',
  };

  const missing = missingFields
    .map((f) => fieldDescriptions[f] ?? f)
    .join(', ');

  const system = `You are a friendly, professional dental office receptionist writing a short follow-up email.
Be warm but brief. Do not include a subject line. Do not sign with a specific person's name — sign off as "The Scheduling Team".`;

  const prompt = `A patient sent us this appointment request:

"${originalMessage}"

We need the following to complete their booking: ${missing}.

Write a short, friendly reply asking them to provide this information so we can get them scheduled.`;

  const payload = {
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: prompt },
    ],
    temperature: 0.3,
    max_tokens: 300,
  };

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.text();
      console.log('[LLM] followup error', res.status, err);
      return null;
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    return content?.trim() ?? null;
  } catch (err) {
    console.log('[LLM] followup exception', err);
    return null;
  }
}
