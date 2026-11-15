<?php
// Book photo storage for the Kitaab Aur Kona admin panel, on Hostinger web hosting.
//
// The admin panel (kitaabaurkona.vercel.app) sends each photo here after shrinking it in
// the browser. This file:
//   1. accepts requests only from the admin site's address (config.php: allowed_origins),
//   2. asks Supabase whether the person's sign-in belongs to an admin (public.is_admin),
//      so nobody else can upload or delete anything,
//   3. checks the file really is a JPG, PNG or WebP photo of a sensible size,
//   4. stores it under files/<year>/<month>/<random name>, never under the name it was
//      sent with, and answers with its public link.
// It can also delete photos it stored earlier (when an admin removes a photo from a book).
//
// Setup steps are in readmeforhelp.md (section "Book photos on Hostinger").

declare(strict_types=1);

const NAME_PATTERN = '#^\d{4}/\d{2}/[a-f0-9]{32}\.(jpg|png|webp)$#';
const TYPES = ['image/jpeg' => 'jpg', 'image/png' => 'png', 'image/webp' => 'webp'];
const MAX_SIDE = 6000;
const MAX_DELETE = 20;

$config = require __DIR__ . '/config.php';
$filesDir = __DIR__ . '/files';
$publicBase = rtrim((string) $config['public_base_url'], '/') . '/files/';

function reply(int $status, array $body): void
{
    http_response_code($status);
    echo json_encode($body, JSON_UNESCAPED_SLASHES);
    exit;
}

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');
header('Referrer-Policy: no-referrer');

// Only the admin site may call this from a browser.
$origin = (string) ($_SERVER['HTTP_ORIGIN'] ?? '');
$allowed = in_array($origin, (array) $config['allowed_origins'], true);
if ($allowed) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Access-Control-Allow-Methods: POST, OPTIONS');
    header('Access-Control-Allow-Headers: Authorization, Content-Type');
    header('Access-Control-Max-Age: 600');
}
header('Vary: Origin');

$method = (string) ($_SERVER['REQUEST_METHOD'] ?? '');
if ($method === 'OPTIONS') {
    http_response_code($allowed ? 204 : 403);
    exit;
}
if ($method !== 'POST') reply(405, ['error' => 'method']);
if (!$allowed) reply(403, ['error' => 'origin']);

// ---------- Who is asking? Supabase decides. ----------

$auth = (string) ($_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '');
if ($auth === '' && function_exists('getallheaders')) {
    foreach (getallheaders() as $key => $value) {
        if (strcasecmp((string) $key, 'Authorization') === 0) $auth = (string) $value;
    }
}
if (!preg_match('/^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/', $auth, $m) || strlen($m[1]) > 4096) {
    reply(401, ['error' => 'signin']);
}
$token = $m[1];

$ch = curl_init(rtrim((string) $config['supabase_url'], '/') . '/rest/v1/rpc/is_admin');
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => '{}',
    CURLOPT_HTTPHEADER => [
        'apikey: ' . $config['supabase_anon_key'],
        'Authorization: Bearer ' . $token,
        'Content-Type: application/json',
        'Accept: application/json',
    ],
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_CONNECTTIMEOUT => 5,
    CURLOPT_TIMEOUT => 10,
    CURLOPT_PROTOCOLS => CURLPROTO_HTTPS,
    CURLOPT_SSL_VERIFYPEER => true,
]);
$answer = curl_exec($ch);
$status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
curl_close($ch);
if ($answer === false) reply(502, ['error' => 'supabase']);
if ($status === 401 || $status === 403) reply(401, ['error' => 'signin']);
if ($status !== 200 || trim((string) $answer) !== 'true') reply(403, ['error' => 'admin']);

// ---------- Delete photos stored here earlier ----------

$contentType = strtolower((string) ($_SERVER['CONTENT_TYPE'] ?? ''));
if (str_starts_with($contentType, 'application/json')) {
    $input = json_decode((string) file_get_contents('php://input', false, null, 0, 65536), true);
    if (!is_array($input) || ($input['action'] ?? '') !== 'delete' || !is_array($input['urls'] ?? null)) {
        reply(400, ['error' => 'request']);
    }
    $urls = array_slice($input['urls'], 0, MAX_DELETE);
    $deleted = 0;
    $root = realpath($filesDir);
    foreach ($urls as $url) {
        if (!is_string($url) || !str_starts_with($url, $publicBase)) continue;
        $name = substr($url, strlen($publicBase));
        if (!preg_match(NAME_PATTERN, $name)) continue;
        $path = realpath($filesDir . '/' . $name);
        if ($root === false || $path === false || !str_starts_with($path, $root . DIRECTORY_SEPARATOR)) continue;
        if (is_file($path) && unlink($path)) $deleted++;
    }
    reply(200, ['deleted' => $deleted]);
}

// ---------- Store one photo ----------

$file = $_FILES['photo'] ?? null;
if (!is_array($file) || is_array($file['error'] ?? null)) reply(400, ['error' => 'nofile']);
if ($file['error'] === UPLOAD_ERR_INI_SIZE || $file['error'] === UPLOAD_ERR_FORM_SIZE) reply(413, ['error' => 'size']);
if ($file['error'] !== UPLOAD_ERR_OK || !is_uploaded_file($file['tmp_name'])) reply(400, ['error' => 'nofile']);

$size = (int) $file['size'];
if ($size <= 0 || $size > (int) $config['max_bytes']) reply(413, ['error' => 'size']);

// The file's real contents decide its type, never its name or what the browser says.
$mime = (new finfo(FILEINFO_MIME_TYPE))->file($file['tmp_name']);
if (!isset(TYPES[$mime])) reply(415, ['error' => 'type']);
$info = @getimagesize($file['tmp_name']);
if ($info === false || ($info['mime'] ?? '') !== $mime) reply(415, ['error' => 'type']);
[$width, $height] = $info;
if ($width < 1 || $height < 1 || $width > MAX_SIDE || $height > MAX_SIDE) reply(415, ['error' => 'dimensions']);

$folder = gmdate('Y') . '/' . gmdate('m');
$dir = $filesDir . '/' . $folder;
if (!is_dir($dir) && !mkdir($dir, 0755, true) && !is_dir($dir)) reply(500, ['error' => 'storage']);

$name = bin2hex(random_bytes(16)) . '.' . TYPES[$mime];
if (!move_uploaded_file($file['tmp_name'], $dir . '/' . $name)) reply(500, ['error' => 'storage']);
@chmod($dir . '/' . $name, 0644);

reply(201, ['url' => $publicBase . $folder . '/' . $name, 'width' => $width, 'height' => $height]);
