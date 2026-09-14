/**
 * Types, DTOs, and Constants for CallsModule and Telnyx Call Orchestration.
 */

export type CallDirection = 'inbound' | 'outbound';

export type CallStatus = 'in_progress' | 'completed' | 'failed' | 'dropped';

export interface CallTranscriptItem {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  source?: 'document' | 'fallback' | 'greeting' | 'warning' | 'limit' | 'system';
}

export interface CallRecord {
  id: string;
  client_id: string;
  direction: CallDirection;
  caller_number: string;
  called_number: string;
  telnyx_call_id: string | null;
  duration_seconds: number;
  minutes_used: number;
  transcript: CallTranscriptItem[];
  recording_url: string | null;
  status: CallStatus;
  language_used: string;
  started_at: string | Date;
  ended_at: string | Date | null;
  created_at: string | Date;
}

export interface InitiateOutboundCallDto {
  to: string;
}

export interface InitiateOutboundCallResponse {
  callId: string;
  telnyxCallId: string | null;
  status: CallStatus;
  direction: 'outbound';
  callerNumber: string;
  calledNumber: string;
}

export interface CallListQueryDto {
  page?: number;
  limit?: number;
  status?: CallStatus;
  direction?: CallDirection;
}

export interface CallListResponse {
  calls: CallRecord[];
  total: number;
  page: number;
  limit: number;
  totalPages?: number;
}

export interface DeductMinutesResult {
  success: boolean;
  deducted?: number;
  minutes_requested?: number;
  remaining_balance?: number;
  newBalance?: number;
  client_id?: string;
  error?: string;
  message?: string;
}

export interface ProcessUtteranceResult {
  responseAudio?: Buffer;
  responseText: string;
  source: 'document' | 'fallback' | 'warning' | 'limit' | 'system';
  hangup: boolean;
  warningGiven?: boolean;
}

// ====================================================================
// Locked Product Constants
// ====================================================================

/** Maximum call duration in seconds: 10 minutes */
export const MAX_CALL_DURATION_SECONDS = 600;

/** Remaining duration at which to trigger warning: 3 minutes */
export const WARNING_REMAINING_SECONDS = 180;

/** Elapsed seconds after which 3-minute warning triggers (10m - 3m = 7m) */
export const WARNING_TRIGGER_ELAPSED_SECONDS = 420;

/** Consecutive empty STT inputs threshold to trigger 'Are you still there?' prompt */
export const EMPTY_STT_PROMPT_THRESHOLD = 3;

/** Consecutive empty STT inputs threshold to terminate call */
export const EMPTY_STT_TERMINATE_THRESHOLD = 5;

// ====================================================================
// Standard Telephony Voice Prompts & Messages (English / Hindi)
// ====================================================================

export const CALL_MESSAGES = {
  GREETING_EN: 'Hello! How can I assist you today?',
  GREETING_HI: 'नमस्ते! मैं आपकी क्या सहायता कर सकता हूँ?',
  
  INSUFFICIENT_BALANCE_EN: 'Your account balance is insufficient to complete this call. Please recharge your balance.',
  INSUFFICIENT_BALANCE_HI: 'आपके खाते में पर्याप्त बैलेंस नहीं है। कृपया अपना बैलेंस रिचार्ज करें।',
  
  WARNING_3MIN_EN: 'Notice: This call will end in 3 minutes.',
  WARNING_3MIN_HI: 'सूचना: यह कॉल 3 मिनट में समाप्त हो जाएगी।',
  
  MAX_DURATION_EN: 'This call has reached the maximum 10-minute duration limit. Thank you for calling.',
  MAX_DURATION_HI: 'यह कॉल 10 मिनट की अधिकतम समय सीमा पर पहुंच गई है। कॉल करने के लिए धन्यवाद।',
  TIME_LIMIT_EN: 'This call has reached the maximum 10-minute duration limit. Thank you for calling.',
  TIME_LIMIT_HI: 'यह कॉल 10 मिनट की अधिकतम समय सीमा पर पहुंच गई है। कॉल करने के लिए धन्यवाद।',
  
  EMPTY_STT_PROMPT_EN: 'Are you still there? Please ask your question.',
  EMPTY_STT_PROMPT_HI: 'क्या आप अभी भी लाइन पर हैं? कृपया अपना प्रश्न पूछें।',
  STILL_THERE_EN: 'Are you still there? Please ask your question.',
  STILL_THERE_HI: 'क्या आप अभी भी लाइन पर हैं? कृपया अपना प्रश्न पूछें।',
  
  EMPTY_STT_TERMINATE_EN: 'We have not received any response. The call will now disconnect. Goodbye.',
  EMPTY_STT_TERMINATE_HI: 'हमें कोई प्रतिक्रिया प्राप्त नहीं हुई है। कॉल अब समाप्त हो रही है। धन्यवाद।',
  GOODBYE_EN: 'We have not received any response. The call will now disconnect. Goodbye.',
  GOODBYE_HI: 'हमें कोई प्रतिक्रिया प्राप्त नहीं हुई है। कॉल अब समाप्त हो रही है। धन्यवाद।',
  
  MAX_TURNS_EN: 'You have reached the maximum conversation turn limit. Thank you for calling.',
  MAX_TURNS_HI: 'बातचीत की अधिकतम सीमा समाप्त हो गई है। कॉल करने के लिए धन्यवाद।',
} as const;
