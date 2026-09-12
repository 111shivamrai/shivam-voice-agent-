export interface AppConfig {
  port: number;
  supabaseUrl: string;
  supabaseServiceKey: string;
  openaiApiKey: string;
  sarvamApiKey: string;
  telnyxApiKey: string;
  adminPassword: string;
  frontendUrl?: string;
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
  telnyx: {
    apiKey: string;
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
    'TELNYX_API_KEY',
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
  const telnyxApiKey = process.env.TELNYX_API_KEY!;
  const adminPassword = process.env.ADMIN_PASSWORD!;
  const frontendUrl = process.env.FRONTEND_URL;

  return {
    port,
    supabaseUrl,
    supabaseServiceKey,
    openaiApiKey,
    sarvamApiKey,
    telnyxApiKey,
    adminPassword,
    frontendUrl,
    // Flat uppercase mappings for direct ConfigService.get('SUPABASE_URL') lookups
    SUPABASE_URL: supabaseUrl,
    SUPABASE_SERVICE_KEY: supabaseServiceKey,
    OPENAI_API_KEY: openaiApiKey,
    SARVAM_API_KEY: sarvamApiKey,
    TELNYX_API_KEY: telnyxApiKey,
    ADMIN_PASSWORD: adminPassword,
    PORT: port,
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
    telnyx: {
      apiKey: telnyxApiKey,
    },
    admin: {
      password: adminPassword,
    },
  };
};

export default configuration;
