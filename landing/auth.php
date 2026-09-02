<?php
/**
 * Serves the HTML pages after Basic Auth. Apache DirectoryIndex and /imprint
 * rewrite here so the .html files are never sent without a login.
 */

declare(strict_types=1);

require __DIR__ . '/auth.inc.php';
kavibay_basic_auth();

$allowed = [
    'index.html' => true,
    'imprint.html' => true,
    'privacy.html' => true,
];
$page = (string) ($_GET['file'] ?? 'index.html');
if (!isset($allowed[$page])) {
    http_response_code(404);
    header('Content-Type: text/plain; charset=UTF-8');
    echo 'Not found';
    exit;
}

header('Content-Type: text/html; charset=UTF-8');
readfile(__DIR__ . '/' . $page);
