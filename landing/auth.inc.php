<?php
/**
 * HTTP Basic Auth for the public site (pre-launch lock).
 * User/password as requested. FastCGI/PHP-FPM often drops PHP_AUTH_*; restore
 * them from the Authorization header when that happens.
 */

declare(strict_types=1);

const KAVIBAY_AUTH_USER = 'admin';
const KAVIBAY_AUTH_PASS = 'foobar';

function kavibay_basic_auth(): void
{
    $user = (string) ($_SERVER['PHP_AUTH_USER'] ?? '');
    $pass = (string) ($_SERVER['PHP_AUTH_PW'] ?? '');

    if ($user === '' && $pass === '') {
        $header = (string) (
            $_SERVER['HTTP_AUTHORIZATION']
            ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION']
            ?? ''
        );
        if (preg_match('/^Basic\s+(\S+)/i', $header, $match) === 1) {
            $decoded = base64_decode($match[1], true);
            if (is_string($decoded) && str_contains($decoded, ':')) {
                [$user, $pass] = explode(':', $decoded, 2);
            }
        }
    }

    if (hash_equals(KAVIBAY_AUTH_USER, $user) && hash_equals(KAVIBAY_AUTH_PASS, $pass)) {
        return;
    }

    header('WWW-Authenticate: Basic realm="Kavibay"');
    header('HTTP/1.0 401 Unauthorized');
    header('Content-Type: text/plain; charset=UTF-8');
    echo 'Unauthorized';
    exit;
}
