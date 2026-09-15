import { pathToFileURL } from 'node:url';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { loginIdToInternalEmail } from '../shared/loginIdentity.js';

const bootstrapErrorCodes = new Set([
    'invalid_login_id',
    'active_admin_check_failed',
    'active_admin_exists',
    'provisioning_prepare_failed',
    'auth_user_creation_failed',
    'profile_promotion_failed',
    'promotion_failed_compensation_failed',
    'missing_configuration',
    'invalid_temporary_password'
]);

const fail = (code) => {
    throw new Error(code);
};

export const normalizeBootstrapErrorCode = (error) =>
    error instanceof Error && bootstrapErrorCodes.has(error.message) ? error.message : 'bootstrap_failed';

export async function bootstrapAdmin({ loginId, temporaryPassword, client, logger = console, createNonce = () => crypto.randomUUID() }) {
    const email = loginIdToInternalEmail(loginId);
    if (!email) fail('invalid_login_id');

    const existing = await client.from('profiles').select('id').eq('role', 'admin').eq('is_active', true).limit(1);
    if (existing.error) fail('active_admin_check_failed');
    if (existing.data?.length) fail('active_admin_exists');

    const provisioningNonce = createNonce();
    const prepared = await client.rpc('prepare_user_provisioning', {
        target_login_id: loginId,
        provisioning_nonce: provisioningNonce
    });
    if (prepared.error || prepared.data !== true) fail('provisioning_prepare_failed');

    const created = await client.auth.admin.createUser({
        email,
        password: temporaryPassword,
        email_confirm: true,
        app_metadata: { nexerp_provisioned: true, login_id: loginId },
        user_metadata: { provisioning_nonce: provisioningNonce }
    });
    const userId = created.data?.user?.id;
    if (created.error || !userId) fail('auth_user_creation_failed');

    let promoted;
    try {
        promoted = await client.rpc('bootstrap_first_admin', { target_user_id: userId });
    } catch {
        promoted = { data: null, error: true };
    }

    if (promoted.error || promoted.data !== userId) {
        let compensated = false;
        try {
            const deleted = await client.auth.admin.deleteUser(userId);
            compensated = !deleted.error;
        } catch {
            compensated = false;
        }

        if (!compensated) fail('promotion_failed_compensation_failed');
        if (promoted.error?.message === 'active_admin_exists') fail('active_admin_exists');
        fail('profile_promotion_failed');
    }

    logger.info(`Administrator ${loginId} created.`);
}

export async function runBootstrapCli({ env = process.env, createClient = createSupabaseClient, logger = console } = {}) {
    const supabaseUrl = env.SUPABASE_URL;
    const secretKey = env.SUPABASE_SECRET_KEY;
    const loginId = env.NEXERP_ADMIN_LOGIN_ID;
    const temporaryPassword = env.NEXERP_ADMIN_TEMPORARY_PASSWORD;

    if (!supabaseUrl || !secretKey || !loginId || temporaryPassword === undefined) fail('missing_configuration');
    if (temporaryPassword.length < 8 || temporaryPassword.length > 128) fail('invalid_temporary_password');

    const client = createClient(supabaseUrl, secretKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
    });
    await bootstrapAdmin({ loginId, temporaryPassword, client, logger });
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
    runBootstrapCli().catch((error) => {
        console.error(normalizeBootstrapErrorCode(error));
        process.exitCode = 1;
    });
}
