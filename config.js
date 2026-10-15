// The same Supabase project as the extension's supabase-config.js; keep the two in step. Both
// values are public: the admin_* functions check the caller against public.admins, so the
// publishable key reaches nothing an admin's sign-in doesn't. Never put a secret or service_role
// key here: this folder is published on GitHub Pages.
export const SUPABASE_URL = 'https://mwqlaecfjoucjhpgcptj.supabase.co';
export const SUPABASE_KEY = 'sb_publishable_t4Ccov1u0EQT9Eu2l86s1Q_qI5xWAWb';
