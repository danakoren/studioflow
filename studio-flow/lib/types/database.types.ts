/**
 * lib/types/database.types.ts
 *
 * Schema types for the StudioFlow database.
 *
 * IN THE REAL PROJECT THIS FILE IS GENERATED, NOT HAND-EDITED:
 *
 *   supabase gen types typescript --local > lib/types/database.types.ts
 *
 * Add it to a `postdb:reset` script so it regenerates automatically. That is
 * what makes a column rename a BUILD FAILURE rather than a production defect —
 * the point made in Technical Architecture §6.1.
 *
 * This version is hand-written to mirror migrations 001-009 precisely so the
 * rest of Part 2 type-checks before a Supabase project exists.
 */

// ---------------------------------------------------------------------------
// Enums (migration 001)
// ---------------------------------------------------------------------------

export type MemberRole = 'student' | 'instructor' | 'admin';
export type SessionStatus = 'scheduled' | 'cancelled';
export type BookingStatus = 'confirmed' | 'cancelled';
export type AttendanceStatus = 'attended' | 'absent';
export type BookingSource = 'self' | 'admin' | 'waitlist_promotion';
export type WaitlistStatus = 'waiting' | 'promoted' | 'left';
export type LedgerEntryType =
  | 'grant'
  | 'booking'
  | 'refund'
  | 'expiry'
  | 'adjustment';
export type GrantStatus = 'active' | 'exhausted' | 'expired';
export type NotificationType =
  | 'waitlist_promoted'
  | 'session_cancelled'
  | 'session_updated'
  | 'credits_granted'
  | 'credits_expiring'
  | 'booking_confirmed';
export type EmailStatus = 'pending' | 'sent' | 'failed' | 'skipped';

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

export type ProfileRow = {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  created_at: string;
  updated_at: string;
};

export type StudioRow = {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  contact_email: string | null;
  contact_phone: string | null;
  cancellation_window_hours: number;
  promotion_cutoff_hours: number;
  attendance_window_hours: number;
  unmarked_attendance_default: AttendanceStatus;
  created_at: string;
  updated_at: string;
};

export type StudioMemberRow = {
  id: string;
  studio_id: string;
  user_id: string;
  role: MemberRole;
  is_active: boolean;
  must_change_password: boolean;
  joined_at: string;
};

export type RoomRow = {
  id: string;
  studio_id: string;
  name: string;
  capacity: number;
  is_active: boolean;
  created_at: string;
};

export type ClassTypeRow = {
  id: string;
  studio_id: string;
  name: string;
  description: string | null;
  duration_minutes: number;
  color: string;
  is_active: boolean;
  created_at: string;
};

export type SessionRow = {
  id: string;
  studio_id: string;
  class_type_id: string;
  room_id: string;
  instructor_id: string;
  starts_at: string;
  ends_at: string;
  capacity: number;
  status: SessionStatus;
  cancellation_reason: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  recurrence_group_id: string | null;
  created_at: string;
  created_by: string;
};

export type BookingRow = {
  id: string;
  session_id: string;
  student_id: string;
  studio_id: string;
  status: BookingStatus;
  attendance: AttendanceStatus | null;
  source: BookingSource;
  booked_at: string;
  cancelled_at: string | null;
  cancelled_by: string | null;
  credit_refunded: boolean;
  attendance_marked_at: string | null;
  attendance_marked_by: string | null;
  attendance_auto_resolved: boolean;
};

export type WaitlistEntryRow = {
  id: string;
  session_id: string;
  student_id: string;
  studio_id: string;
  status: WaitlistStatus;
  joined_at: string;
  promoted_at: string | null;
  promoted_booking_id: string | null;
  left_at: string | null;
};

export type CreditGrantRow = {
  id: string;
  studio_id: string;
  student_id: string;
  credits_total: number;
  credits_remaining: number;
  expires_at: string | null;
  status: GrantStatus;
  note: string | null;
  created_by: string;
  created_at: string;
};

export type CreditLedgerRow = {
  id: string;
  studio_id: string;
  student_id: string;
  grant_id: string | null;
  delta: number;
  entry_type: LedgerEntryType;
  booking_id: string | null;
  session_id: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
};

export type NotificationRow = {
  id: string;
  studio_id: string;
  recipient_id: string;
  type: NotificationType;
  title: string;
  body: string;
  payload: Record<string, unknown>;
  related_session_id: string | null;
  read_at: string | null;
  email_status: EmailStatus;
  email_attempts: number;
  email_sent_at: string | null;
  last_error: string | null;
  created_at: string;
};

// ---------------------------------------------------------------------------
// View shapes (migration 006)
// ---------------------------------------------------------------------------

export type SessionWithAvailability = {
  id: string;
  studio_id: string;
  class_type_id: string;
  room_id: string;
  instructor_id: string;
  starts_at: string;
  ends_at: string;
  capacity: number;
  status: SessionStatus;
  cancellation_reason: string | null;
  recurrence_group_id: string | null;
  class_type_name: string;
  class_type_description: string | null;
  class_type_color: string;
  duration_minutes: number;
  room_name: string;
  instructor_name: string;
  booked_count: number;
  seats_available: number;
  waiting_count: number;
  is_full: boolean;
};

export type WaitlistPosition = {
  id: string;
  session_id: string;
  student_id: string;
  studio_id: string;
  status: WaitlistStatus;
  joined_at: string;
  position: number;
};

export type StudentBalance = {
  studio_id: string;
  student_id: string;
  balance: number;
  next_expiry_at: string | null;
};

// ---------------------------------------------------------------------------
// Supabase `Database` generic
// ---------------------------------------------------------------------------

type Table<Row, Insert = Partial<Row>, Update = Partial<Row>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

type View<Row> = { Row: Row; Relationships: [] };

/**
 * Envelope returned by every core function in migration 007.
 *
 * The functions return jsonb `{ ok, error_code, ... }` rather than raising,
 * because a full class or an insufficient balance is a normal business
 * outcome that must reach the user as a specific message — not an exception.
 */
export type RpcResult<Extra = Record<string, never>> = {
  ok: boolean;
  error_code?: string;
} & Partial<Extra>;

/**
 * Typing Functions properly is what gives `supabase.rpc()` argument checking.
 * A misspelled parameter name (p_session vs p_session_id) becomes a COMPILE
 * ERROR instead of a runtime "function does not exist" at 2am.
 */
type DatabaseFunctions = {
  book_session: {
    Args: { p_session_id: string };
    Returns: RpcResult<{ booking_id: string; new_balance: number }>;
  };
  join_waitlist: {
    Args: { p_session_id: string };
    Returns: RpcResult<{ entry_id: string; position: number }>;
  };
  leave_waitlist: {
    Args: { p_entry_id: string };
    Returns: RpcResult;
  };
  cancel_booking: {
    Args: { p_booking_id: string };
    Returns: RpcResult<{
      refunded: boolean;
      promoted_booking_id: string | null;
      new_balance: number;
    }>;
  };
  cancel_session: {
    Args: { p_session_id: string; p_reason: string };
    Returns: RpcResult<{ refunded_count: number; notified_count: number }>;
  };
  mark_attendance: {
    Args: { p_booking_id: string; p_attendance: AttendanceStatus };
    Returns: RpcResult;
  };
  grant_credits: {
    Args: {
      p_student_id: string;
      p_studio_id: string;
      p_credits: number;
      p_expires_at?: string | null;
      p_note?: string | null;
    };
    Returns: RpcResult<{ grant_id: string; new_balance: number }>;
  };
  adjust_credits: {
    Args: {
      p_student_id: string;
      p_studio_id: string;
      p_delta: number;
      p_reason: string;
    };
    Returns: RpcResult<{ new_balance: number }>;
  };
  admin_book_student: {
    Args: { p_session_id: string; p_student_id: string };
    Returns: RpcResult<{ booking_id: string }>;
  };
  admin_remove_booking: {
    Args: { p_booking_id: string; p_refund: boolean };
    Returns: RpcResult<{ promoted_booking_id: string | null }>;
  };
  create_recurring_sessions: {
    Args: {
      p_studio_id: string;
      p_class_type_id: string;
      p_room_id: string;
      p_instructor_id: string;
      p_first_start: string;
      p_weeks: number;
      p_capacity?: number | null;
    };
    Returns: RpcResult<{
      recurrence_group_id: string;
      created_ids: string[];
      created_count: number;
      conflicts: Array<{ starts_at: string; reason: string }>;
    }>;
  };
  complete_password_rotation: {
    Args: Record<string, never>;
    Returns: RpcResult;
  };
  student_balance: {
    Args: { p_student_id: string };
    Returns: number;
  };

  // --- service_role only (migration 008) --------------------------------
  finalize_attendance: {
    Args: Record<string, never>;
    Returns: RpcResult<{ resolved_count: number }>;
  };
  expire_credits: {
    Args: Record<string, never>;
    Returns: RpcResult<{ grants_expired: number; credits_expired: number }>;
  };
  notify_expiring_credits: {
    Args: Record<string, never>;
    Returns: RpcResult<{ notified_count: number }>;
  };
  claim_pending_notifications: {
    Args: { p_limit?: number };
    Returns: Array<{
      id: string;
      recipient_id: string;
      recipient_name: string;
      recipient_email: string;
      type: NotificationType;
      title: string;
      body: string;
      payload: Record<string, unknown>;
      email_attempts: number;
    }>;
  };
  mark_notification_email_result: {
    Args: {
      p_notification_id: string;
      p_success: boolean;
      p_error?: string | null;
    };
    Returns: RpcResult<{ attempts: number }>;
  };

  // --- CI assertions (migration 009) ------------------------------------
  assert_rls_coverage: {
    Args: Record<string, never>;
    Returns: Array<{
      table_name: string;
      rls_enabled: boolean;
      policy_count: number;
      is_secure: boolean;
    }>;
  };
  assert_definer_search_path: {
    Args: Record<string, never>;
    Returns: Array<{ function_name: string; has_search_path: boolean }>;
  };
  assert_views_security_invoker: {
    Args: Record<string, never>;
    Returns: Array<{ view_name: string; security_invoker: boolean }>;
  };
  assert_ledger_consistency: {
    Args: Record<string, never>;
    Returns: Array<{
      grant_id: string;
      student_id: string;
      credits_remaining: number;
      ledger_sum: number;
    }>;
  };
  assert_no_overbooking: {
    Args: Record<string, never>;
    Returns: Array<{
      session_id: string;
      capacity: number;
      confirmed_count: number;
    }>;
  };
  assert_no_dual_state: {
    Args: Record<string, never>;
    Returns: Array<{ session_id: string; student_id: string }>;
  };
};

export interface Database {
  public: {
    Tables: {
      profiles: Table<ProfileRow>;
      studios: Table<StudioRow>;
      studio_members: Table<StudioMemberRow>;
      rooms: Table<RoomRow>;
      class_types: Table<ClassTypeRow>;
      sessions: Table<SessionRow>;
      bookings: Table<BookingRow>;
      waitlist_entries: Table<WaitlistEntryRow>;
      credit_grants: Table<CreditGrantRow>;
      credit_ledger: Table<CreditLedgerRow>;
      notifications: Table<NotificationRow>;
    };
    Views: {
      v_sessions_with_availability: View<SessionWithAvailability>;
      v_waitlist_positions: View<WaitlistPosition>;
      v_student_balances: View<StudentBalance>;
      v_grant_ledger_reconciliation: View<{
        grant_id: string;
        studio_id: string;
        student_id: string;
        credits_total: number;
        credits_remaining: number;
        ledger_sum: number;
        is_consistent: boolean;
      }>;
    };
    Functions: DatabaseFunctions;
    Enums: {
      member_role: MemberRole;
      session_status: SessionStatus;
      attendance_status: AttendanceStatus;
      booking_status: BookingStatus;
      booking_source: BookingSource;
      waitlist_status: WaitlistStatus;
      ledger_entry_type: LedgerEntryType;
      grant_status: GrantStatus;
      notification_type: NotificationType;
      email_status: EmailStatus;
    };
    CompositeTypes: Record<string, never>;
  };
}
