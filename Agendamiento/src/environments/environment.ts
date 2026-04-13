export const environment = {
  production: true,
  /** En dev, `true` + proxy.conf.json evita CORS al llamar Edge Functions desde el navegador. */
  functionsViaDevProxy: false,
  supabaseUrl: 'https://xxmkcmgqgprmseoviilb.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh4bWtjbWdxZ3BybXNlb3ZpaWxiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyNTEyOTMsImV4cCI6MjA5MDgyNzI5M30.K364Cg6pdB8PRKGeopenjEokaWV2M7Qv6Wfnn7rtTVc',
  supabaseDefaultKey: 'sb_publishable_Cn-XPpvqDBFhCwZH_uaMKg_XpWIC0NC',
  supabaseSecretKey: 'sb_secret_gEsMhmxcUTa2oP1HfLwtSw_ELbqReA2',
};
