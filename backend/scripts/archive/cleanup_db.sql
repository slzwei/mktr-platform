-- Database Cleanup Script
-- Preserves 'admin@tetrapass.com' in both auth.users and admin_users.
-- Wipes all other data.

DO $$
DECLARE
    v_master_email text := 'admin@tetrapass.com';
    v_master_auth_id uuid;
BEGIN
    -- 1. Identify Master Admin ID in auth.users
    SELECT id INTO v_master_auth_id
    FROM auth.users
    WHERE email = v_master_email;

    IF v_master_auth_id IS NULL THEN
        RAISE NOTICE 'Master admin % not found in auth.users. Aborting cleanup to prevent total lockout.', v_master_email;
        RETURN;
    END IF;

    RAISE NOTICE 'Preserving Master Admin: % (Auth ID: %)', v_master_email, v_master_auth_id;

    -- 2. Truncate Business Tables (CASCADE to handle FKs)
    -- List from actual database inspection
    TRUNCATE TABLE
        registrations,
        tenant_apple_api_keys,
        certificate_provisioning_logs,
        campaign_assets,
        passholders,
        pass_transactions,
        campaign_stats,
        partner_integrations,
        pass_queue,
        profiles,
        partners,
        campaign_steps,
        locations,
        devices,
        deleted_device_tokens,
        tenant_usage,
        admin_audit_log,
        staff,
        tenant_certificates,
        tenant_profiles,
        certificate_renewal_schedule,
        certificate_notifications,
        campaigns,
        passes,
        tenant_invitations
    CASCADE;

    RAISE NOTICE 'Business tables truncated.';

    -- 3. Cleanup admin_users
    -- Preserve the row with the master email
    DELETE FROM public.admin_users
    WHERE email != v_master_email;

    RAISE NOTICE 'Cleaned public.admin_users.';

    -- 4. Cleanup auth.users
    -- This relies on CASCADE DELETE to clean up any related auth tables (like identities, sessions)
    -- Supabase auth tables usually cascade.
    DELETE FROM auth.users
    WHERE id != v_master_auth_id;

    RAISE NOTICE 'Cleaned auth.users.';

END $$;
