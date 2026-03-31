<?php
/**
 * db_travel.php — Travel Planner Database Connection
 */
try {
    $pdo = new PDO(
        "mysql:host=localhost;dbname=travel_planner;charset=utf8mb4",
        'root',
        '',
        [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ]
    );
} catch (PDOException $e) {
    die(json_encode(['success' => false, 'error' => 'DB failed: ' . $e->getMessage()]));
}
