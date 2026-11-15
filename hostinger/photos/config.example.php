<?php
// Copy this file to config.php (same folder) and fill in the values.
// config.php is never sent to visitors (.htaccess blocks it) and is not kept in git.
return [
    // Supabase project address and its public "anon" key (Supabase > Project Settings > API).
    // The anon key is the same public key the website itself uses.
    'supabase_url' => 'https://YOUR-PROJECT.supabase.co',
    'supabase_anon_key' => 'YOUR-ANON-KEY',

    // The web address of this folder on Hostinger, without a slash at the end.
    'public_base_url' => 'https://photos.kitaabaurkona.com',

    // Websites allowed to upload: the admin panel. Add http://localhost:5198 only while
    // testing the admin panel on your own computer.
    'allowed_origins' => ['https://kitaabaurkona.vercel.app'],

    // Largest photo accepted, in bytes. The admin panel shrinks photos to well under this.
    'max_bytes' => 5 * 1024 * 1024,
];
