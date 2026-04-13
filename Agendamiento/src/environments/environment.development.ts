export const environment = {
  production: false,
  /** Petición a `/functions/v1/...` vía proxy → mismo origen, sin preflight CORS a Supabase. */
  functionsViaDevProxy: true,
  supabaseUrl: 'https://xxmkcmgqgprmseoviilb.supabase.co',
  /** JWT anon (rol `anon`); las publishable keys a veces fallan con Edge Functions / preflight. */
  supabaseAnonKey:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh4bWtjbWdxZ3BybXNlb3ZpaWxiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyNTEyOTMsImV4cCI6MjA5MDgyNzI5M30.K364Cg6pdB8PRKGeopenjEokaWV2M7Qv6Wfnn7rtTVc',
};
