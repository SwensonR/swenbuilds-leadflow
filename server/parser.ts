import { EmailWebhookPayload } from './types';
import { extractWithLLM } from './llm.js';

function normalizeText(payload: EmailWebhookPayload) {
  const parts = [payload.subject, payload.text, payload.html].filter(Boolean);
  return parts.join('\n').replace(/\r\n/g, '\n').trim();
}

function extract(regexes: RegExp[], text: string): string | undefined {
  for (const regex of regexes) {
    const match = text.match(regex);
    if (match?.[1]) {
      return match[1].trim();
    }
  }
  return undefined;
}

function parseEmail(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = value.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/);
  return match?.[0];
}

function parsePhone(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = value.match(/\+?[0-9][0-9()\s.-]{6,}[0-9]/);
  return match ? match[0].trim() : undefined;
}

function parseDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const text = value.trim();
  const iso = text.match(/(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];

  const slash = text.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (slash) {
    let [, month, day, year] = slash;
    if (year.length === 2) year = `20${year}`;
    month = month.padStart(2, '0');
    day = day.padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  const words = text.match(/(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:,\s*(\d{4}))?/i);
  if (words) {
    const [, monthName, day, year] = words;
    const month = String(new Date(`${monthName} 1, 2000`).getMonth() + 1).padStart(2, '0');
    const paddedDay = day.padStart(2, '0');
    return `${year ?? new Date().getFullYear()}-${month}-${paddedDay}`;
  }

  const monthDay = text.match(/(\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\b)\.?\s*(\d{1,2})(?:,\s*(\d{4}))?/i);
  if (monthDay) {
    const [, monthName, day, year] = monthDay;
    const month = String(new Date(`${monthName} 1, 2000`).getMonth() + 1).padStart(2, '0');
    return `${year ?? new Date().getFullYear()}-${month}-${day.padStart(2, '0')}`;
  }

  return undefined;
}

function parseTime(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const text = value.trim();
  const hourMinute = text.match(/(\d{1,2})(?::(\d{2}))?\s*(AM|PM|am|pm)?/);
  if (hourMinute) {
    let [, hourStr, minute = '00', part] = hourMinute;
    let hour = Number(hourStr);
    if (part) {
      if (/pm/i.test(part) && hour < 12) hour += 12;
      if (/am/i.test(part) && hour === 12) hour = 0;
    }
    return `${String(hour).padStart(2, '0')}:${minute.padStart(2, '0')}`;
  }
  return undefined;
}

function normalizeFrom(from?: EmailWebhookPayload['from']) {
  if (!from) return { email: undefined, name: undefined };
  if (typeof from === 'string') {
    const email = parseEmail(from);
    const nameMatch = from.match(/^\s*([^<]+?)\s*</);
    return { email, name: nameMatch?.[1]?.trim() };
  }
  return {
    email: parseEmail(from.email || undefined),
    name: from.name,
  };
}

export async function parseAppointment(payload: EmailWebhookPayload) {
  const body = normalizeText(payload);
  const source = normalizeFrom(payload.from);

  // rule-based extraction (fallbacks)
  const rulePatientName =
    extract([/Patient\s*Name\s*[:\-]\s*(.+)/i, /Name\s*[:\-]\s*(.+)/i], body) ||
    source.name ||
    (source.email ? source.email.replace(/@.+$/, '') : undefined) ||
    'Unknown Patient';

  const ruleService =
    extract([/Service\s*[:\-]\s*(.+)/i, /Consultation\s*[:\-]\s*(.+)/i, /(?:I want|please book|need a|looking for)\s+(.+?)\b(?:appointment|visit|cleaning|consultation|checkup)?/i], body) ||
    payload.subject?.match(/(cleaning|consultation|filling|crown|checkup|exam|whitening)/i)?.[1] ||
    'Dental appointment';

  const ruleAppointmentDate =
    parseDate(extract([/Date\s*[:\-]\s*(.+)/i, /(\d{4}-\d{2}-\d{2})/i, /(\d{1,2}\/\d{1,2}\/\d{2,4})/i, /(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:,\s*\d{4})?/i], body)) ||
    parseDate(body.match(/(?:on|for)\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:,\s*\d{4})?/i)?.[0]);

  const ruleAppointmentTime =
    parseTime(extract([/Time\s*[:\-]\s*(.+)/i, /(\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)?)/i, /(\d{1,2}\s*(?:AM|PM|am|pm))/i], body));

  const ruleEmail =
    parseEmail(source.email) ||
    extract([/Email\s*[:\-]\s*(.+)/i, /([\w.+-]+@[\w.-]+\.[A-Za-z]{2,})/i], body);
  const rulePhone = parsePhone(
    extract([/Phone\s*[:\-]\s*(.+)/i, /Tel\s*[:\-]\s*(.+)/i, /(?:call|reach me at)\s*([0-9+\s().-]{7,})/i], body),
  );
  const ruleDentist = extract([/Dentist\s*[:\-]\s*(.+)/i], body);
  const ruleNotes = [payload.subject, payload.text, payload.html].filter(Boolean).join('\n\n');

  // try LLM extraction when available (merge with rule-based)
  let llm: any = null;
  try {
    if (process.env.OPENAI_API_KEY) {
      console.log('[Parser] Calling LLM extractor...');
      llm = await extractWithLLM(body);
      console.log('[Parser] LLM result:', llm);
    }
  } catch (err) {
    console.log('[Parser] LLM error:', err);
    llm = null;
  }

  return {
    patientName: (llm && llm.patientName) || rulePatientName,
    service: (llm && llm.service) || ruleService,
    appointmentDate: (llm && llm.appointmentDate) || ruleAppointmentDate,
    appointmentTime: (llm && llm.appointmentTime) || ruleAppointmentTime,
    email: (llm && llm.email) || ruleEmail,
    phone: (llm && llm.phone) || rulePhone,
    dentist: (llm && llm.dentist) || ruleDentist,
    notes: (llm && llm.notes) || ruleNotes,
  };
}
