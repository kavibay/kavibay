<?php
/**
 * Notify form: one POST, one mail to the operator. No list, no database.
 *
 * Upload the contents of landing/ as the Apache document root. mail() must be
 * allowed (typical on managed PHP). From must be a mailbox on the domain or
 * many hosts will silently drop the message — hello@kavibay.com is that box.
 */

declare(strict_types=1);

require __DIR__ . '/auth.inc.php';
kavibay_basic_auth();

const NOTIFY_TO = 'hello@kavibay.com';
const NOTIFY_FROM = 'hello@kavibay.com';
const NOTIFY_FROM_NAME = 'Kavibay';
const RATE_FILE = __DIR__ . '/.notify-rate';
const RATE_MAX = 24;
const RATE_WINDOW = 3600;

function notify_wants_json(): bool
{
    if (($_POST['ajax'] ?? '') === '1') {
        return true;
    }
    $accept = (string) ($_SERVER['HTTP_ACCEPT'] ?? '');
    return str_contains($accept, 'application/json');
}

function notify_respond(string $flag): never
{
    $ok = $flag === 'notified';
    if (notify_wants_json()) {
        http_response_code($ok ? 200 : 400);
        // text/html so a hidden iframe can read the body. JSON-only types are
        // sometimes downloaded instead of rendered.
        header('Content-Type: text/html; charset=UTF-8');
        $json = json_encode(['ok' => $ok, 'flag' => $flag], JSON_THROW_ON_ERROR);
        echo '<!doctype html><meta charset="utf-8"><body>' . $json . '</body>';
        exit;
    }

    header('Location: /?' . $flag . '=1#notify', true, 303);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    header('Allow: POST');
    http_response_code(405);
    header('Content-Type: text/plain; charset=UTF-8');
    echo 'Method not allowed';
    exit;
}

// Bots fill every field. Humans never see this one.
$honeypot = trim((string) ($_POST['b_address'] ?? ''));
if ($honeypot !== '') {
    notify_respond('notified');
}

$email = trim((string) ($_POST['email'] ?? ''));
if ($email === '' || preg_match('/[\r\n]/', $email) === 1) {
    notify_respond('notify-error');
}
if (filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
    notify_respond('notify-error');
}

$ip = (string) ($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0');
if (notify_rate_limited($ip)) {
    notify_respond('rate');
}

$subject = 'Kavibay notify: ' . $email;
$body = "New notify request\n\nEmail: {$email}\n";

$headers = [
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    'From: ' . NOTIFY_FROM_NAME . ' <' . NOTIFY_FROM . '>',
    'Reply-To: ' . $email,
    'X-Mailer: Kavibay-notify',
];

$sent = @mail(NOTIFY_TO, $subject, $body, implode("\r\n", $headers));
if ($sent !== true) {
    notify_respond('notify-error');
}

notify_respond('notified');

/**
 * Caps submissions per IP so a loop cannot fill the inbox. Fails open if the
 * rate file cannot be written (read-only hosting still delivers the mail).
 */
function notify_rate_limited(string $ip): bool
{
    $now = time();
    $hits = [];

    $handle = @fopen(RATE_FILE, 'c+');
    if ($handle === false) {
        return false;
    }
    if (!flock($handle, LOCK_EX)) {
        fclose($handle);
        return false;
    }

    $raw = stream_get_contents($handle);
    $data = is_string($raw) && $raw !== '' ? json_decode($raw, true) : [];
    if (is_array($data) && isset($data[$ip]) && is_array($data[$ip])) {
        foreach ($data[$ip] as $stamp) {
            if (is_int($stamp) && $stamp > $now - RATE_WINDOW) {
                $hits[] = $stamp;
            }
        }
    }

    if (count($hits) >= RATE_MAX) {
        flock($handle, LOCK_UN);
        fclose($handle);
        return true;
    }

    $hits[] = $now;
    $data = is_array($data) ? $data : [];
    $data[$ip] = $hits;

    foreach ($data as $key => $stamps) {
        if (!is_array($stamps)) {
            unset($data[$key]);
            continue;
        }
        $fresh = array_values(array_filter(
            $stamps,
            static fn ($stamp): bool => is_int($stamp) && $stamp > $now - RATE_WINDOW,
        ));
        if ($fresh === []) {
            unset($data[$key]);
        } else {
            $data[$key] = $fresh;
        }
    }

    rewind($handle);
    ftruncate($handle, 0);
    fwrite($handle, json_encode($data, JSON_THROW_ON_ERROR));
    flock($handle, LOCK_UN);
    fclose($handle);

    return false;
}
