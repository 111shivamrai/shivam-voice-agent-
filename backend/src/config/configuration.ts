export interface AppConfig {
  port: number;
  supabaseUrl: string;
  supabaseServiceKey: string;
  openaiApiKey: string;
  sarvamApiKey: string;
  deepgramApiKey: string;
  smallestApiKey?: string;
  adminPassword: string;
  twilioAccountSid: string;
  twilioAuthToken: string;
  twilioPhoneNumber: string;
  backendUrl: string;
  appUrl?: string;
  frontendUrl?: string;
  telnyxApiKey?: string;
  supabase: {
    url: string;
    serviceKey: string;
  };
  openai: {
    apiKey: string;
  };
  sarvam: {
    apiKey: string;
  };
  deepgram: {
    apiKey: string;
  };
  smallest?: {
    apiKey?: string;
  };
  twilio: {
    accountSid: string;
    authToken: string;
    phoneNumber: string;
  };
  telnyx: {
    apiKey?: string;
    phoneNumber?: string;
    appId?: string;
    connectionId?: string;
  };
  admin: {
    password: string;
  };
  [key: string]: unknown;
}

export const configuration = (): AppConfig => {
  const requiredKeys = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_KEY',
    'OPENAI_API_KEY',
    'SARVAM_API_KEY',
    'DEEPGRAM_API_KEY',
    'TWILIO_ACCOUNT_SID',
    'TWILIO_AUTH_TOKEN',
    'TWILIO_PHONE_NUMBER',
    'BACKEND_URL',
    'ADMIN_PASSWORD',
  ] as const;

  const missing = requiredKeys.filter((key) => {
    const val = process.env[key];
    return typeof val !== 'string' || val.trim() === '';
  });

  if (missing.length > 0) {
    throw new Error(
      `Application startup failed: Missing required environment variable(s): ${missing.join(', ')}`,
    );
  }

  const rawPort = process.env.PORT;
  const parsedPort = rawPort ? parseInt(rawPort, 10) : 3001;
  const port = Number.isNaN(parsedPort) ? 3001 : parsedPort;

  const supabaseUrl = process.env.SUPABASE_URL!;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY!;
  const openaiApiKey = process.env.OPENAI_API_KEY!;
  const sarvamApiKey = process.env.SARVAM_API_KEY!;
  const deepgramApiKey = process.env.DEEPGRAM_API_KEY!;
  const smallestApiKey = process.env.SMALLEST_API_KEY;
  const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID!;
  const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN!;
  const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER!;
  const backendUrl = process.env.BACKEND_URL!;
  const adminPassword = process.env.ADMIN_PASSWORD!;
  const frontendUrl = process.env.FRONTEND_URL;
  const telnyxApiKey = process.env.TELNYX_API_KEY;

  return {
    port,
    supabaseUrl,
    supabaseServiceKey,
    openaiApiKey,
    sarvamApiKey,
    deepgramApiKey,
    smallestApiKey,
    twilioAccountSid,
    twilioAuthToken,
    twilioPhoneNumber,
    backendUrl,
    adminPassword,
    frontendUrl,
    telnyxApiKey,
    appUrl: process.env.APP_URL ?? backendUrl,
    // Flat uppercase mappings for direct ConfigService.get('...') lookups
    SUPABASE_URL: supabaseUrl,
    SUPABASE_SERVICE_KEY: supabaseServiceKey,
    OPENAI_API_KEY: openaiApiKey,
    SARVAM_API_KEY: sarvamApiKey,
    DEEPGRAM_API_KEY: deepgramApiKey,
    SMALLEST_API_KEY: smallestApiKey,
    TWILIO_ACCOUNT_SID: twilioAccountSid,
    TWILIO_AUTH_TOKEN: twilioAuthToken,
    TWILIO_PHONE_NUMBER: twilioPhoneNumber,
    BACKEND_URL: backendUrl,
    ADMIN_PASSWORD: adminPassword,
    PORT: port,
    TELNYX_API_KEY: telnyxApiKey,
    TELNYX_PHONE_NUMBER: process.env.TELNYX_PHONE_NUMBER,
    TELNYX_APP_ID: process.env.TELNYX_APP_ID,
    TELNYX_CONNECTION_ID: process.env.TELNYX_CONNECTION_ID,
    // Nested domain namespaces
    supabase: {
      url: supabaseUrl,
      serviceKey: supabaseServiceKey,
    },
    openai: {
      apiKey: openaiApiKey,
    },
    sarvam: {
      apiKey: sarvamApiKey,
    },
    deepgram: {
      apiKey: deepgramApiKey,
    },
    smallest: {
      apiKey: smallestApiKey,
    },
    twilio: {
      accountSid: twilioAccountSid,
      authToken: twilioAuthToken,
      phoneNumber: twilioPhoneNumber,
    },
    telnyx: {
      apiKey: telnyxApiKey,
      phoneNumber: process.env.TELNYX_PHONE_NUMBER,
      appId: process.env.TELNYX_APP_ID,
      connectionId: process.env.TELNYX_CONNECTION_ID,
    },
    admin: {
      password: adminPassword,
    },
  };
};

export default configuration;
