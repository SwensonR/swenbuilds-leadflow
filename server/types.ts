export type AppointmentStatus = 'Requested' | 'NeedsInfo' | 'Confirmed';

export interface EmailMessage {
  direction: 'inbound' | 'outbound';
  body: string;
  timestamp: string;
}

export interface Appointment {
  id: string;
  patientName: string;
  service: string;
  appointmentDate?: string;
  appointmentTime?: string;
  email?: string;
  phone?: string;
  dentist?: string;
  notes?: string;
  followUpSent?: boolean;
  followUpMessage?: string;
  emailHistory?: EmailMessage[];
  status: AppointmentStatus;
  createdAt: string;
}

export interface EmailWebhookPayload {
  from?: { email?: string; name?: string } | string;
  subject?: string;
  text?: string;
  html?: string;
}
