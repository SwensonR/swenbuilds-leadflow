import fs from 'fs/promises';
import path from 'path';
import { Appointment } from './types';

const dataFile = path.join(process.cwd(), 'server', 'data', 'appointments.json');

async function ensureDataFile() {
  const dir = path.dirname(dataFile);
  await fs.mkdir(dir, { recursive: true });
  try {
    await fs.access(dataFile);
  } catch {
    await fs.writeFile(dataFile, '[]', 'utf8');
  }
}

export async function loadAppointments(): Promise<Appointment[]> {
  await ensureDataFile();
  const raw = await fs.readFile(dataFile, 'utf8');
  try {
    return JSON.parse(raw) as Appointment[];
  } catch {
    return [];
  }
}

export async function saveAppointments(appointments: Appointment[]) {
  await ensureDataFile();
  await fs.writeFile(dataFile, JSON.stringify(appointments, null, 2), 'utf8');
}

export async function addAppointment(appointment: Appointment): Promise<Appointment> {
  const appointments = await loadAppointments();
  appointments.unshift(appointment);
  await saveAppointments(appointments);
  return appointment;
}

export async function updateAppointmentStatus(
  id: string,
  status: Appointment['status'],
): Promise<Appointment | null> {
  const appointments = await loadAppointments();
  const index = appointments.findIndex((appointment) => appointment.id === id);
  if (index === -1) {
    return null;
  }

  appointments[index] = {
    ...appointments[index],
    status,
  };

  await saveAppointments(appointments);
  return appointments[index];
}

export async function updateAppointment(
  id: string,
  updates: Partial<Appointment>,
): Promise<Appointment | null> {
  const appointments = await loadAppointments();
  const index = appointments.findIndex((appointment) => appointment.id === id);
  if (index === -1) {
    return null;
  }

  appointments[index] = {
    ...appointments[index],
    ...updates,
  };

  await saveAppointments(appointments);
  return appointments[index];
}
