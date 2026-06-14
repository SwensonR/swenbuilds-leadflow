import { useEffect, useState } from 'react';

type AppointmentStatus = 'Requested' | 'NeedsInfo' | 'Confirmed';

interface EmailMessage {
  direction: 'inbound' | 'outbound';
  body: string;
  timestamp: string;
}

interface Appointment {
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

const DEMO_EMAIL = `Hi, my name is Kevin Patel and I'd like to schedule a teeth cleaning. I'm available June 25th at 11am. My phone number is (415) 555-7294 and my email is kevin.patel@gmail.com. Thank you!`;
const DEMO_REPLY = `Hi, my last name is Patel. Could we do June 25th at 10am instead? Thank you!`;

const STATUS_COLORS: Record<AppointmentStatus, string> = {
  Requested: '#f87171',
  NeedsInfo: '#fb923c',
  Confirmed: '#34d399',
};

const STATUS_SORT: Record<AppointmentStatus, number> = {
  NeedsInfo: 0,
  Requested: 1,
  Confirmed: 2,
};

function formatDate(date?: string) {
  if (!date) return 'No date';
  const [year, month, day] = date.split('-');
  return new Date(Number(year), Number(month) - 1, Number(day))
    .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTime(time?: string) {
  if (!time) return 'No time';
  const [h, m] = time.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

function getWeekDates(offset: number): Date[] {
  const today = new Date();
  const dow = today.getDay();
  const monday = new Date(today);
  monday.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1) + offset * 7);
  return Array.from({ length: 5 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}

function toDateKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16];

function Calendar({ appointments }: { appointments: Appointment[] }) {
  const [weekOffset, setWeekOffset] = useState(1);
  const weekDays = getWeekDates(weekOffset);
  const startLabel = weekDays[0].toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const endLabel = weekDays[4].toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  const booked = appointments.filter(a =>
    a.appointmentDate && a.appointmentTime &&
    ['Requested', 'Confirmed'].includes(a.status)
  );

  function getAppt(date: Date, hour: number) {
    const key = toDateKey(date);
    return booked.find(a =>
      a.appointmentDate === key &&
      a.appointmentTime?.startsWith(String(hour).padStart(2, '0'))
    );
  }

  return (
    <section className="calendar-panel">
      <div className="calendar-header">
        <h2>Office Calendar</h2>
        <div className="calendar-nav">
          <button className="cal-nav-btn" onClick={() => setWeekOffset(o => o - 1)}>‹</button>
          <span className="cal-week-label">{startLabel} – {endLabel}</span>
          <button className="cal-nav-btn" onClick={() => setWeekOffset(o => o + 1)}>›</button>
        </div>
      </div>

      <div className="cal-grid" style={{ gridTemplateColumns: `48px repeat(5, 1fr)` }}>
        <div className="cal-corner" />
        {weekDays.map(d => (
          <div key={toDateKey(d)} className="cal-day-header">
            <span className="cal-day-name">{d.toLocaleDateString('en-US', { weekday: 'short' })}</span>
            <span className="cal-day-num">{d.getDate()}</span>
          </div>
        ))}
        {HOURS.map(hour => (
          <>
            <div key={`h${hour}`} className="cal-time-label">
              {hour < 12 ? `${hour}am` : hour === 12 ? '12pm' : `${hour - 12}pm`}
            </div>
            {weekDays.map(day => {
              const appt = getAppt(day, hour);
              return (
                <div
                  key={`${toDateKey(day)}-${hour}`}
                  className={`cal-cell ${appt ? 'cal-cell-booked' : 'cal-cell-empty'}`}
                  style={appt ? { borderLeftColor: STATUS_COLORS[appt.status] } : {}}>
                  {appt && (
                    <>
                      <span className="cal-appt-name">{appt.patientName.split(' ')[0]}</span>
                      <span className="cal-appt-service">{appt.service}</span>
                    </>
                  )}
                </div>
              );
            })}
          </>
        ))}
      </div>
    </section>
  );
}

function AppointmentCard({
  appt,
  expandedFollowUp,
  onToggleFollowUp,
  onReplySubmit,
  onConfirm,
  confirmingId,
}: {
  appt: Appointment;
  expandedFollowUp: string | null;
  onToggleFollowUp: (id: string) => void;
  onReplySubmit: (id: string, text: string) => Promise<void>;
  onConfirm: (id: string) => void;
  confirmingId: string | null;
}) {
  const [replyText, setReplyText] = useState('');
  const [showReply, setShowReply] = useState(false);
  const [sendingReply, setSendingReply] = useState(false);

  const hasHistory = !!(appt.emailHistory?.length || appt.followUpMessage);
  const isConfirming = confirmingId === appt.id;

  async function submitReply() {
    if (!replyText.trim()) return;
    setSendingReply(true);
    await onReplySubmit(appt.id, replyText);
    setSendingReply(false);
    setShowReply(false);
    setReplyText('');
  }

  return (
    <article className="appointment-card">
      <header className="appointment-header">
        <div className="appointment-header-left">
          <h3>{appt.patientName}</h3>
          <span className="appt-service-tag">{appt.service || <span className="missing-field">No service</span>}</span>
        </div>
        <div className="appointment-meta">
          <span>{formatDate(appt.appointmentDate)}</span>
          <span>{formatTime(appt.appointmentTime)}</span>
        </div>
      </header>

      <div className="appt-contact-row">
        {appt.email && <span>{appt.email}</span>}
        {appt.phone && <span>{appt.phone}</span>}
      </div>

      {appt.status === 'NeedsInfo' && (
        <div className="awaiting-reply">
          <span className="awaiting-dot" />
          Awaiting patient reply
        </div>
      )}

      {hasHistory && (
        <div className="followup-section">
          <button className="followup-toggle" onClick={() => onToggleFollowUp(appt.id)}>
            <span>Email History</span>
            <span className="followup-chevron">{expandedFollowUp === appt.id ? '▼' : '▶'}</span>
          </button>

          {expandedFollowUp === appt.id && (
            <div className="email-thread">
              {(appt.emailHistory ?? (appt.followUpMessage ? [{ direction: 'outbound' as const, body: appt.followUpMessage, timestamp: appt.createdAt }] : [])).map((msg, i) => (
                <div key={i} className={`email-bubble email-bubble-${msg.direction}`}>
                  <span className="email-bubble-label">{msg.direction === 'inbound' ? 'Patient' : 'Your Office'}</span>
                  <p className="email-bubble-body">{msg.body}</p>
                </div>
              ))}

              {appt.status === 'NeedsInfo' && !showReply && (
                <button
                  className="reply-trigger"
                  onClick={() => { setShowReply(true); setReplyText(DEMO_REPLY); }}>
                  + Simulate patient reply
                </button>
              )}

              {appt.status === 'NeedsInfo' && showReply && (
                <div className="reply-composer">
                  <textarea
                    className="simulate-textarea"
                    rows={3}
                    value={replyText}
                    onChange={e => setReplyText(e.target.value)}
                  />
                  <div className="reply-composer-actions">
                    <button className="button" onClick={() => setShowReply(false)}>Cancel</button>
                    <button className="button button-primary" disabled={sendingReply || !replyText.trim()} onClick={submitReply}>
                      {sendingReply ? 'Sending…' : 'Send Reply'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {appt.status === 'Requested' && (
        <div className="card-actions">
          <button
            className="button button-confirm"
            disabled={isConfirming}
            onClick={() => onConfirm(appt.id)}>
            {isConfirming ? 'Confirming…' : 'Confirm Appointment'}
          </button>
        </div>
      )}
    </article>
  );
}

function App() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [showSimulate, setShowSimulate] = useState(false);
  const [simulateText, setSimulateText] = useState(DEMO_EMAIL);
  const [simulating, setSimulating] = useState(false);
  const [simulateResult, setSimulateResult] = useState<'Confirmed' | 'NeedsInfo' | null>(null);
  const [expandedFollowUp, setExpandedFollowUp] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'attention' | 'confirmed'>('attention');
  const [resetting, setResetting] = useState(false);

  useEffect(() => { fetchAppointments(true); }, []);

  async function fetchAppointments(seedIfEmpty = false) {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/appointments');
      if (!response.ok) throw new Error('Unable to load appointments');
      const data = (await response.json()) as Appointment[];
      if (seedIfEmpty && data.length === 0) {
        await fetch('/api/reset', { method: 'POST' });
        return fetchAppointments(false);
      }
      setAppointments(data);
    } catch (err) {
      setError((err as Error).message ?? 'Failed to fetch appointments');
    } finally {
      setLoading(false);
    }
  }

  async function confirmAppointment(id: string) {
    setConfirmingId(id);
    setError(null);
    try {
      const response = await fetch(`/api/appointments/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'Confirmed' }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { message?: string; missing?: string[] };
        throw new Error(body.missing?.length ? `Missing: ${body.missing.join(', ')}` : (body.message ?? 'Unable to confirm'));
      }
      const data = (await response.json()) as { appointment: Appointment };
      setAppointments(cur => cur.map(a => a.id === id ? data.appointment : a));
      setSimulateResult('Confirmed');
    } catch (err) {
      setError((err as Error).message ?? 'Failed to confirm');
    } finally {
      setConfirmingId(null);
    }
  }

  async function submitReply(id: string, text: string) {
    setError(null);
    try {
      const response = await fetch(`/api/appointments/${id}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!response.ok) throw new Error('Failed to send reply');
      const data = (await response.json()) as { appointment: Appointment };
      setAppointments(cur => cur.map(a => a.id === id ? data.appointment : a));
      if (data.appointment.status === 'Confirmed') setSimulateResult('Confirmed');
    } catch (err) {
      setError((err as Error).message ?? 'Failed to send reply');
    }
  }

  async function simulateEmail() {
    setSimulating(true);
    setSimulateResult(null);
    setError(null);
    try {
      const response = await fetch('/api/demo-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: simulateText, subject: 'Appointment Request' }),
      });
      if (!response.ok) throw new Error('Failed to simulate email');
      const data = (await response.json()) as { appointment: Appointment };
      await fetchAppointments();
      setSimulateResult(data.appointment.status === 'Confirmed' ? 'Confirmed' : 'NeedsInfo');
      setActiveTab(data.appointment.status === 'Confirmed' ? 'confirmed' : 'attention');
      setShowSimulate(false);
      setSimulateText(DEMO_EMAIL);
    } catch (err) {
      setError((err as Error).message ?? 'Simulation failed');
    } finally {
      setSimulating(false);
    }
  }

  async function resetDemo() {
    setResetting(true);
    try {
      await fetch('/api/reset', { method: 'POST' });
      await fetchAppointments();
      setSimulateResult(null);
      setError(null);
      setExpandedFollowUp(null);
    } finally {
      setResetting(false);
    }
  }

  const needsAttention = appointments
    .filter(a => a.status === 'NeedsInfo' || a.status === 'Requested')
    .sort((a, b) => STATUS_SORT[a.status] - STATUS_SORT[b.status]);

  const confirmed = appointments
    .filter(a => a.status === 'Confirmed')
    .sort((a, b) => new Date(a.appointmentDate ?? '').getTime() - new Date(b.appointmentDate ?? '').getTime());

  const toggleFollowUp = (id: string) =>
    setExpandedFollowUp(prev => prev === id ? null : id);

  return (
    <div className="app-shell">
      <header className="app-toolbar">
        <h1>Dental Booking AI</h1>
        <div className="toolbar-actions">
          <button
            className="button button-reset"
            disabled={resetting}
            onClick={resetDemo}>
            {resetting ? 'Resetting…' : 'Reset Demo'}
          </button>
          <button
            className="button button-demo"
            onClick={() => { setShowSimulate(s => !s); setSimulateResult(null); }}>
            {showSimulate ? 'Cancel' : '+ Simulate Email'}
          </button>
        </div>
      </header>

      <div className="cta-banner">
        <span className="cta-text">
          <strong>This is a live demo</strong> — the AI parses each email in real time. No scripts, no fakes.
        </span>
        <a
          className="cta-link"
          href="mailto:swen@swenbuilds.com?subject=Demo%20Request%20%E2%80%94%20Dental%20Booking%20AI"
        >
          Want this for your practice? →
        </a>
      </div>

      <div className="main-grid">
        <section className="left-col">
          {error && <div className="error-box">{error}</div>}
          {simulateResult === 'Confirmed' && (
            <div className="success-box">
              Appointment confirmed and added to the schedule.
              <button className="success-dismiss" onClick={() => setSimulateResult(null)}>✕</button>
            </div>
          )}
          {simulateResult === 'NeedsInfo' && (
            <div className="needs-info-box">
              Added to Needs Attention — missing information required before confirming.
              <button className="success-dismiss" onClick={() => setSimulateResult(null)}>✕</button>
            </div>
          )}

          {loading ? (
            <p className="loading-msg">Loading appointments…</p>
          ) : (
            <>
              {needsAttention.length === 0 && confirmed.length === 0 && (
                <div className="empty-state">
                  <p>No appointments yet.</p>
                  <p>Use "Simulate Email" to see the system in action.</p>
                </div>
              )}

              {(needsAttention.length > 0 || confirmed.length > 0) && (
                <>
                  <div className="tab-row">
                    <button
                      className={`tab-btn ${activeTab === 'attention' ? 'tab-btn-active tab-btn-attention' : ''}`}
                      onClick={() => setActiveTab('attention')}>
                      Needs Attention
                      {needsAttention.length > 0 && <span className="tab-count">{needsAttention.length}</span>}
                    </button>
                    <button
                      className={`tab-btn ${activeTab === 'confirmed' ? 'tab-btn-active tab-btn-confirmed' : ''}`}
                      onClick={() => setActiveTab('confirmed')}>
                      Confirmed
                      {confirmed.length > 0 && <span className="tab-count">{confirmed.length}</span>}
                    </button>
                  </div>

                  <div className="appointments-list">
                    {activeTab === 'attention' && needsAttention.map(appt => (
                      <AppointmentCard
                        key={appt.id}
                        appt={appt}
                        expandedFollowUp={expandedFollowUp}
                        onToggleFollowUp={toggleFollowUp}
                        onReplySubmit={submitReply}
                        onConfirm={confirmAppointment}
                        confirmingId={confirmingId}
                      />
                    ))}
                    {activeTab === 'attention' && needsAttention.length === 0 && (
                      <div className="empty-state"><p>No appointments need attention.</p></div>
                    )}
                    {activeTab === 'confirmed' && confirmed.map(appt => (
                      <AppointmentCard
                        key={appt.id}
                        appt={appt}
                        expandedFollowUp={expandedFollowUp}
                        onToggleFollowUp={toggleFollowUp}
                        onReplySubmit={submitReply}
                        onConfirm={confirmAppointment}
                        confirmingId={confirmingId}
                      />
                    ))}
                    {activeTab === 'confirmed' && confirmed.length === 0 && (
                      <div className="empty-state"><p>No confirmed appointments yet.</p></div>
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </section>

        <aside className="right-col">
          <Calendar appointments={appointments} />

          {showSimulate && (
            <div className="simulate-panel">
              <p className="simulate-label">
                Try <strong>June 20 at 10am</strong> for a conflict, or a <strong>weekend time</strong> for hours validation.
              </p>
              <textarea
                className="simulate-textarea"
                rows={5}
                value={simulateText}
                onChange={e => setSimulateText(e.target.value)}
              />
              <div className="simulate-actions">
                <button className="button button-primary" disabled={simulating || !simulateText.trim()} onClick={simulateEmail}>
                  {simulating ? 'Parsing…' : 'Submit Email'}
                </button>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

export default App;
