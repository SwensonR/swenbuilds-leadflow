import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import { parseAppointment } from './parser.js';
import { generateFollowUp } from './llm.js';
import { sendMailgunEmail } from './mailgun.js';
import { addAppointment, loadAppointments, saveAppointments, updateAppointment, updateAppointmentStatus } from './store.js';
import { Appointment, EmailMessage } from './types.js';

const app = express();
const port = Number(process.env.PORT || 4174);
const GENERIC_SERVICES = ['dental appointment', 'appointment'];

app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

function verifyMailgunSignature(req: express.Request, res: express.Response, next: express.NextFunction) {
  const apiKey = process.env.MAILGUN_API_KEY;
  const body = req.body as Record<string, unknown> | undefined;
  const timestamp = typeof body?.timestamp === 'string' ? body.timestamp : undefined;
  const token = typeof body?.token === 'string' ? body.token : undefined;
  const signatureFromBody = typeof body?.signature === 'string' ? body.signature : undefined;
  const headerSignature = req.headers['x-mailgun-signature'];
  const signature = signatureFromBody || (Array.isArray(headerSignature) ? headerSignature[0] : headerSignature);

  if (!apiKey || !timestamp || !token || !signature || typeof signature !== 'string') {
    return next();
  }

  const expected = crypto.createHmac('sha256', apiKey).update(`${timestamp}${token}`).digest('hex');
  if (expected !== signature) {
    return res.status(403).json({ error: 'invalid Mailgun signature' });
  }
  next();
}

function checkBusinessHours(date?: string, time?: string): string | null {
  if (!date || !time) return null;
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const d = new Date(year, month - 1, day);
  const dow = d.getDay();
  if (dow === 0 || dow === 6) {
    const dayName = dow === 0 ? 'Sunday' : 'Saturday';
    return `a weekday appointment time — we are open Monday through Friday only (the requested day is a ${dayName})`;
  }
  const totalMins = hour * 60 + minute;
  if (totalMins < 8 * 60 || totalMins >= 17 * 60) {
    return `a time within our office hours — we are open 8:00 AM to 5:00 PM Monday through Friday (the requested time, ${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}, is outside those hours)`;
  }
  return null;
}

function checkConflict(date: string, time: string, appointments: Appointment[], excludeId?: string): boolean {
  return appointments.some(a =>
    a.id !== excludeId &&
    a.appointmentDate === date &&
    a.appointmentTime === time &&
    ['Requested', 'Confirmed'].includes(a.status)
  );
}

function buildMissingList(appt: Appointment, existing: Appointment[]): string[] {
  const serviceIsMissing = !appt.service || GENERIC_SERVICES.includes(appt.service.toLowerCase().trim());
  const hasFullName = !!(appt.patientName && appt.patientName.trim().includes(' '));
  const missing: string[] = [];
  if (!hasFullName) missing.push('full name');
  if (serviceIsMissing) missing.push('reason for visit');
  if (!appt.appointmentDate) missing.push('preferred date');
  if (!appt.appointmentTime) missing.push('preferred time');
  if (appt.appointmentDate && appt.appointmentTime) {
    const hoursIssue = checkBusinessHours(appt.appointmentDate, appt.appointmentTime);
    if (hoursIssue) {
      missing.push(hoursIssue);
    } else if (missing.length === 0) {
      const hasConflict = checkConflict(appt.appointmentDate, appt.appointmentTime, existing, appt.id);
      if (hasConflict) {
        const d = new Date(appt.appointmentDate + 'T00:00:00');
        const formatted = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
        const [h, m] = appt.appointmentTime.split(':').map(Number);
        const timeStr = `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
        missing.push(`a different appointment time — ${formatted} at ${timeStr} is already booked. Please suggest another time and we will get you scheduled`);
      }
    }
  }
  return missing;
}

async function handleAppointmentCreation(parsed: ReturnType<typeof parseAppointment> extends Promise<infer T> ? T : never, existing: Appointment[]) {
  const now = new Date().toISOString();
  const appointment: Appointment = {
    id: crypto.randomUUID(),
    patientName: parsed.patientName,
    service: parsed.service,
    appointmentDate: parsed.appointmentDate,
    appointmentTime: parsed.appointmentTime,
    email: parsed.email,
    phone: parsed.phone,
    dentist: parsed.dentist,
    notes: parsed.notes,
    status: 'Requested',
    createdAt: now,
    emailHistory: [{ direction: 'inbound', body: parsed.notes ?? '', timestamp: now }],
  };

  const serviceIsMissing = !appointment.service || GENERIC_SERVICES.includes(appointment.service.toLowerCase().trim());
  if (serviceIsMissing) appointment.service = '';

  const missing = buildMissingList(appointment, existing);
  return { appointment, missing };
}

function buildConfirmationEmail(appointment: Appointment): string {
  const firstName = appointment.patientName.split(' ')[0];
  const d = appointment.appointmentDate
    ? new Date(appointment.appointmentDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    : null;
  const [h, m] = (appointment.appointmentTime ?? '').split(':').map(Number);
  const t = appointment.appointmentTime
    ? `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
    : null;

  return `Hi ${firstName},\n\nYour appointment is confirmed!\n\n` +
    `Service: ${appointment.service}\n` +
    (d ? `Date: ${d}\n` : '') +
    (t ? `Time: ${t}\n` : '') +
    `\nWe look forward to seeing you. If you need to reschedule or have any questions, just reply to this email.\n\nBest,\nThe Scheduling Team`;
}

async function sendConfirmationIfConfigured(appointment: Appointment) {
  const body = buildConfirmationEmail(appointment);
  const outbound: EmailMessage = { direction: 'outbound', body, timestamp: new Date().toISOString() };
  const emailHistory = [...(appointment.emailHistory ?? []), outbound];
  appointment.emailHistory = emailHistory;
  await updateAppointment(appointment.id, { emailHistory });
  if (process.env.MAILGUN_API_KEY) {
    try {
      await sendMailgunEmail('swen@swenbuilds.com', 'Your appointment is confirmed', body);
    } catch (err) {
      console.log('confirmation send error', err);
    }
  }
}

async function sendFollowUpIfConfigured(appointment: Appointment, missing: string[]) {
  if (!process.env.MAILGUN_API_KEY) return;
  try {
    const followUp = await generateFollowUp(appointment.notes ?? '', missing);
    if (followUp) {
      const outbound: EmailMessage = { direction: 'outbound', body: followUp, timestamp: new Date().toISOString() };
      const emailHistory = [...(appointment.emailHistory ?? []), outbound];
      await sendMailgunEmail('swen@swenbuilds.com', 'More info needed for your appointment request', followUp);
      appointment.followUpSent = true;
      appointment.followUpMessage = followUp;
      appointment.emailHistory = emailHistory;
      await updateAppointment(appointment.id, { followUpSent: true, followUpMessage: followUp, emailHistory });
    }
  } catch (err) {
    console.log('follow-up error', err);
  }
}

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', message: 'Dental Booking AI backend is running.' });
});

app.get('/api/appointments', async (_req, res) => {
  const appointments = await loadAppointments();
  res.json(appointments);
});

app.post('/api/email-webhook', verifyMailgunSignature, async (req, res) => {
  const bodyPayload = (() => {
    const b = req.body as any;
    if (b && (b['sender'] || b['recipient'] || b['body-plain'] || b['event-data'])) {
      const from = b['sender'] || (b['event-data']?.message?.headers?.from);
      const subject = b['subject'] || (b['event-data']?.message?.headers?.subject);
      const text = b['body-plain'] || b['stripped-text'] || (b['event-data']?.message?.['body-plain']);
      const html = b['body-html'] || b['stripped-html'] || (b['event-data']?.message?.['body-html']);
      return { from, subject, text, html };
    }
    return req.body;
  })();

  const existing = await loadAppointments();
  const parsed = await parseAppointment(bodyPayload as any);
  const { appointment, missing } = await handleAppointmentCreation(parsed, existing);

  if (missing.length > 0) {
    appointment.status = 'NeedsInfo';
    appointment.followUpSent = false;
    await addAppointment(appointment);
    await sendFollowUpIfConfigured(appointment, missing);
    return res.status(201).json({ appointment });
  }

  appointment.status = 'Confirmed';
  await addAppointment(appointment);
  await sendConfirmationIfConfigured(appointment);
  res.status(201).json({ appointment });
});

app.patch('/api/appointments/:id/status', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body as { status?: string };
  const allowedStatuses: Appointment['status'][] = ['Requested', 'NeedsInfo', 'Confirmed'];

  if (!status || !allowedStatuses.includes(status as Appointment['status'])) {
    return res.status(400).json({ message: 'Invalid status value' });
  }

  if (status === 'Confirmed') {
    const all = await loadAppointments();
    const appt = all.find((a) => a.id === id);
    if (!appt) return res.status(404).json({ message: 'Appointment not found' });

    const blocking: string[] = [];
    if (!appt.patientName || !appt.patientName.trim().includes(' ')) blocking.push('full name');
    if (!appt.service || GENERIC_SERVICES.includes(appt.service.toLowerCase().trim())) blocking.push('reason for visit');
    if (!appt.appointmentDate) blocking.push('preferred date');
    if (!appt.appointmentTime) blocking.push('preferred time');
    if (appt.appointmentDate && appt.appointmentTime) {
      const hoursIssue = checkBusinessHours(appt.appointmentDate, appt.appointmentTime);
      if (hoursIssue) blocking.push('valid appointment time (outside office hours)');
      else if (checkConflict(appt.appointmentDate, appt.appointmentTime, all, id)) {
        blocking.push('non-conflicting time (slot already booked)');
      }
    }

    if (blocking.length > 0) {
      return res.status(422).json({ message: 'Cannot confirm: missing required information', missing: blocking });
    }
  }

  const appointment = await updateAppointmentStatus(id, status as Appointment['status']);
  if (!appointment) return res.status(404).json({ message: 'Appointment not found' });
  res.json({ appointment });
});

app.post('/api/appointments/:id/reply', async (req, res) => {
  const { id } = req.params;
  const { text } = req.body as { text?: string };
  if (!text?.trim()) return res.status(400).json({ message: 'Reply text required' });

  const all = await loadAppointments();
  const appt = all.find(a => a.id === id);
  if (!appt) return res.status(404).json({ message: 'Appointment not found' });

  const now = new Date().toISOString();
  const inbound: EmailMessage = { direction: 'inbound', body: text, timestamp: now };
  const history = [...(appt.emailHistory ?? []), inbound];

  // Parse the reply and merge any newly provided info into the appointment
  const parsed = await parseAppointment({ text, subject: 'Patient reply' } as any);
  const merged: Appointment = {
    ...appt,
    emailHistory: history,
    patientName: (parsed.patientName && parsed.patientName !== 'Unknown Patient' && parsed.patientName.includes(' '))
      ? parsed.patientName : appt.patientName,
    service: (parsed.service && !GENERIC_SERVICES.includes(parsed.service.toLowerCase()))
      ? parsed.service : appt.service,
    appointmentDate: parsed.appointmentDate ?? appt.appointmentDate,
    appointmentTime: parsed.appointmentTime ?? appt.appointmentTime,
    email: parsed.email ?? appt.email,
    phone: parsed.phone ?? appt.phone,
  };

  const missing = buildMissingList(merged, all);

  if (missing.length === 0) {
    merged.status = 'Confirmed';
    await updateAppointment(id, merged);
    await sendConfirmationIfConfigured(merged);
  } else {
    // Send another follow-up for whatever is still missing
    try {
      if (process.env.MAILGUN_API_KEY) {
        const followUp = await generateFollowUp(text, missing);
        if (followUp) {
          const outbound: EmailMessage = { direction: 'outbound', body: followUp, timestamp: new Date().toISOString() };
          merged.emailHistory = [...history, outbound];
          merged.followUpMessage = followUp;
          await sendMailgunEmail('swen@swenbuilds.com', 'Follow-up to appointment request', followUp);
        }
      }
    } catch (err) {
      console.log('reply follow-up error', err);
    }
    await updateAppointment(id, merged);
  }

  const final = (await loadAppointments()).find(a => a.id === id)!;
  res.json({ appointment: final });
});

app.post('/api/reset', async (_req, res) => {
  await saveAppointments([]);
  res.json({ ok: true });
});

app.post('/api/demo-email', async (req, res) => {
  const { from, subject, text } = req.body as { from?: string; subject?: string; text?: string };

  const payload = {
    from: from || 'demo@example.com',
    subject: subject || 'Appointment Request',
    text: text || '',
  };

  const existing = await loadAppointments();
  const parsed = await parseAppointment(payload as any);
  const { appointment, missing } = await handleAppointmentCreation(parsed, existing);

  if (missing.length > 0) {
    appointment.status = 'NeedsInfo';
    appointment.followUpSent = false;
    await addAppointment(appointment);
    await sendFollowUpIfConfigured(appointment, missing);
    return res.status(201).json({ appointment });
  }

  appointment.status = 'Confirmed';
  await addAppointment(appointment);
  await sendConfirmationIfConfigured(appointment);
  res.status(201).json({ appointment });
});

app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`);
});
