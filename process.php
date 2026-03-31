<?php
/**
 * WandrAI — process.php
 * ================================================================
 * GEMINI TOOL CALLING FLOW:
 *  1. User query aati hai
 *  2. System prompt inject hota hai
 *  3. Gemini tool call karta hai → get_destination_info
 *  4. PHP DB function execute karta hai
 *  5. DB mein nahi → "Unavailable" error return
 *     DB mein hai → data Gemini ko wapas diya
 *  6. Gemini DB data se itinerary banata hai → user ko show
 * ================================================================
 */

// ── Configuration ─────────────────────────────────────────────
define('GEMINI_API_KEY', 'AIzaSyAt0O_DZU5HCNhO1kR0-s4ek-r10pNvrqo');
define('GEMINI_MODEL',   'gemini-2.5-flash');
define('GEMINI_API_URL', 'https://generativelanguage.googleapis.com/v1beta/models/' . GEMINI_MODEL . ':generateContent?key=' . GEMINI_API_KEY);

define('DB_HOST',    'localhost');
define('DB_NAME',    'travel_planner');
define('DB_USER',    'root');
define('DB_PASS',    '');
define('DB_CHARSET', 'utf8mb4');

// ── Headers ───────────────────────────────────────────────────
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

// ── Database Connection ───────────────────────────────────────
function getDB(): PDO {
    static $pdo = null;
    if ($pdo === null) {
        $dsn = "mysql:host=" . DB_HOST . ";dbname=" . DB_NAME . ";charset=" . DB_CHARSET;
        $pdo = new PDO($dsn, DB_USER, DB_PASS, [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ]);
    }
    return $pdo;
}

// ── Read & Decode Request ─────────────────────────────────────
$rawInput = file_get_contents('php://input');
$input    = json_decode($rawInput, true);

if (!$input || !isset($input['action'])) {
    jsonError('Invalid request. Missing action.');
    exit;
}

$action = trim($input['action']);

// ── Route Actions ─────────────────────────────────────────────
switch ($action) {

    // ==========================================================
    // ACTION: generate — Tool Calling Flow
    // ==========================================================
    case 'generate':
        $destination = sanitize($input['destination'] ?? '');
        $days        = (int)($input['days']          ?? 0);
        $budget      = (float)($input['budget']      ?? 0);
        $travelStyle = sanitize($input['travelStyle'] ?? 'Cultural');

        if (!$destination || $days < 1 || $days > 30 || $budget < 100) {
            jsonError('Invalid input values.');
            exit;
        }

        // ── STEP 2: System Prompt ─────────────────────────────
        $systemPrompt = "You are WandrAI, a smart travel planner.
RULES:
- ALWAYS call 'get_destination_info' tool FIRST before doing anything
- If tool returns found=false: respond ONLY with the text: DESTINATION_UNAVAILABLE
- If tool returns found=true: use that DB data to create the itinerary
- Never guess or make up destination info — always rely on tool result
- Final itinerary must be a raw JSON array only — no markdown, no extra text";

        $dailyBudget = round($budget / $days, 0);
        $userMessage = "Plan a {$days}-day trip to {$destination}. Budget: \${$budget} total (~\${$dailyBudget}/day). Style: {$travelStyle}. Check DB first using the tool.";

        // ── STEP 3: Tool Definition ───────────────────────────
        $tools = [[
            'function_declarations' => [
                [
                    'name'        => 'get_destination_info',
                    'description' => 'Check if a destination exists in our database and get its details. MUST be called before creating any itinerary.',
                    'parameters'  => [
                        'type'       => 'object',
                        'properties' => [
                            'destination' => [
                                'type'        => 'string',
                                'description' => 'Country or destination name to look up in database'
                            ]
                        ],
                        'required' => ['destination']
                    ]
                ]
            ]
        ]];

        $messages = [
            ['role' => 'user', 'parts' => [['text' => $userMessage]]]
        ];

        // ── FIRST GEMINI CALL (with tools) ────────────────────
        $firstResponse = callGeminiWithTools($messages, $tools, $systemPrompt);

        if ($firstResponse === false) {
            jsonError('Failed to connect to Gemini API. Quota exceeded or network error.');
            exit;
        }

        $firstData = json_decode($firstResponse, true);
        error_log("=== FIRST GEMINI CALL === " . substr($firstResponse, 0, 500));

        $candidate = $firstData['candidates'][0]['content'] ?? null;
        if (!$candidate) {
            jsonError('Empty response from Gemini.');
            exit;
        }

        // ── Check: tool call aya ya direct text? ─────────────
        $toolCallParts = [];
        $textParts     = [];
        foreach ($candidate['parts'] as $part) {
            if (isset($part['functionCall']))  $toolCallParts[] = $part;
            elseif (isset($part['text']))      $textParts[]     = $part['text'];
        }

        // Agar tool call nahi aya — direct text check karo
        if (empty($toolCallParts)) {
            $text = implode("\n", $textParts);
            if (stripos($text, 'DESTINATION_UNAVAILABLE') !== false) {
                jsonError("'{$destination}' hamare database mein available nahi hai. Supported destinations: Japan, France, Thailand, Italy, Spain, Indonesia, Morocco, Turkey, USA, Australia, Greece, UAE, India, Portugal, Mexico.");
            } else {
                jsonError('Unexpected response. Please try again.');
            }
            exit;
        }

        // ── STEP 4: PHP DB Function Execute karo ─────────────
        $destInfo      = null;
        $functionResponseParts = [];

        foreach ($toolCallParts as $toolPart) {
            $funcName = $toolPart['functionCall']['name'];
            $funcArgs = $toolPart['functionCall']['args'] ?? [];

            // DB se data fetch karo
            $result = executeDBFunction($funcName, $funcArgs);

            error_log("=== TOOL RESULT [{$funcName}] === " . json_encode($result));

            // Destination DB mein nahi mila → stop
            if ($funcName === 'get_destination_info' && empty($result['found'])) {
                jsonError("'{$destination}' hamare travel database mein nahi hai. Sirf yeh destinations supported hain: Japan, France, Thailand, Italy, Spain, Indonesia, Morocco, Turkey, USA, Australia, Greece, UAE, India, Portugal, Mexico.");
                exit;
            }

            // Destination mila → save karo
            if ($funcName === 'get_destination_info' && !empty($result['found'])) {
                $destInfo = $result['destination'];
            }

            // FunctionResponse part banao
            $functionResponseParts[] = [
                'functionResponse' => [
                    'name'     => $funcName,
                    'response' => ['result' => $result]
                ]
            ];
        }

        // ── STEP 5: Tool result Gemini ko wapas do ────────────
        // Model ka tool call message add karo
        $messages[] = ['role' => 'model', 'parts' => $candidate['parts']];

        // DB result add karo
        $messages[] = ['role' => 'user', 'parts' => $functionResponseParts];

        // Final itinerary instruction add karo
        $messages[] = ['role' => 'user', 'parts' => [['text' =>
            "Now create the {$days}-day itinerary using the destination data from the tool.

STRICT RULES:
1. Return ONLY a raw JSON array — no markdown, no code fences, no wrapper object
2. Exactly {$days} elements
3. Each element must have these exact keys:
   - \"day\"            : integer (1, 2, 3...)
   - \"title\"          : short day theme string
   - \"morning\"        : detailed morning activity (2-3 sentences)
   - \"afternoon\"      : detailed afternoon activity (2-3 sentences)
   - \"evening\"        : detailed evening + dinner (2-3 sentences)
   - \"estimated_cost\" : number in USD for that day
   - \"notes\"          : 1 helpful travel tip

Use the popular cities from DB data. Match {$travelStyle} travel style. Budget: ~\${$dailyBudget}/day."
        ]]];

        // ── SECOND GEMINI CALL → Final itinerary ─────────────
        $secondResponse = callGeminiWithTools($messages, [], $systemPrompt);

        if ($secondResponse === false) {
            jsonError('Failed to generate itinerary. Please try again.');
            exit;
        }

        $secondData = json_decode($secondResponse, true);
        $finalText  = $secondData['candidates'][0]['content']['parts'][0]['text'] ?? '';

        error_log("=== SECOND GEMINI CALL === " . substr($finalText, 0, 500));

        if (!$finalText) {
            jsonError('Could not generate itinerary. Please try again.');
            exit;
        }

        // ── STEP 6: Parse & Return ────────────────────────────
        $itinerary = parseItinerary($finalText, $days);

        echo json_encode([
            'success'   => true,
            'destInfo'  => $destInfo,
            'itinerary' => $itinerary,
            'raw'       => $finalText,
        ]);
        break;

    // ==========================================================
    // ACTION: save
    // ==========================================================
    case 'save':
        $destination = sanitize($input['destination'] ?? '');
        $days        = (int)($input['days']          ?? 0);
        $budget      = (float)($input['budget']      ?? 0);
        $travelStyle = sanitize($input['travelStyle'] ?? '');
        $itinerary   = $input['itinerary']            ?? [];
        $raw         = $input['raw']                  ?? '';

        if (!$destination || $days < 1) {
            jsonError('Missing required fields to save trip.');
            exit;
        }

        try {
            $db   = getDB();
            $stmt = $db->prepare("
                INSERT INTO trips
                    (destination, days, budget, travel_style, itinerary_json, itinerary_text, created_at)
                VALUES
                    (:destination, :days, :budget, :travel_style, :itinerary_json, :itinerary_text, NOW())
            ");
            $stmt->execute([
                ':destination'    => $destination,
                ':days'           => $days,
                ':budget'         => $budget,
                ':travel_style'   => $travelStyle,
                ':itinerary_json' => json_encode($itinerary),
                ':itinerary_text' => $raw,
            ]);
            echo json_encode(['success' => true, 'trip_id' => $db->lastInsertId()]);
        } catch (PDOException $e) {
            jsonError('Database error: ' . $e->getMessage());
        }
        break;

    // ==========================================================
    // ACTION: history
    // ==========================================================
    case 'history':
        try {
            $db   = getDB();
            $stmt = $db->query("
                SELECT id, destination, days, budget, travel_style,
                       itinerary_json, itinerary_text, created_at
                FROM trips
                ORDER BY created_at DESC
                LIMIT 20
            ");
            echo json_encode(['success' => true, 'trips' => $stmt->fetchAll()]);
        } catch (PDOException $e) {
            echo json_encode(['success' => false, 'trips' => [], 'error' => $e->getMessage()]);
        }
        break;

    // ==========================================================
    // ACTION: destinations (autocomplete)
    // ==========================================================
    case 'destinations':
        try {
            $db   = getDB();
            $stmt = $db->query("SELECT country FROM destinations ORDER BY country ASC");
            echo json_encode(['success' => true, 'destinations' => array_column($stmt->fetchAll(), 'country')]);
        } catch (PDOException $e) {
            echo json_encode(['success' => false, 'destinations' => []]);
        }
        break;

    default:
        jsonError('Unknown action: ' . $action);
}

// ================================================================
//  STEP 4 — DB FUNCTION EXECUTION
// ================================================================
function executeDBFunction(string $funcName, array $args): array {
    if ($funcName === 'get_destination_info') {
        $dest = $args['destination'] ?? '';
        try {
            $db   = getDB();
            $stmt = $db->prepare("
                SELECT * FROM destinations
                WHERE LOWER(country) LIKE LOWER(:dest)
                LIMIT 1
            ");
            $stmt->execute([':dest' => '%' . $dest . '%']);
            $row = $stmt->fetch();

            if (!$row) {
                return [
                    'found'   => false,
                    'message' => "'{$dest}' is not available in our travel database."
                ];
            }

            return [
                'found'       => true,
                'destination' => $row,
                'message'     => "Destination found. Use this data to build the itinerary."
            ];

        } catch (PDOException $e) {
            return ['found' => false, 'message' => 'DB error: ' . $e->getMessage()];
        }
    }

    return ['error' => "Unknown function: $funcName"];
}

// ================================================================
//  GEMINI API CALL — With Tool Support
// ================================================================
function callGeminiWithTools(array $messages, array $tools, string $systemPrompt): string|false {

    $payload = [
        'system_instruction' => [
            'parts' => [['text' => $systemPrompt]]
        ],
        'contents'         => $messages,
        'generationConfig' => [
            'temperature'     => 0.5,
            'maxOutputTokens' => 8000,
        ],
    ];

    // Tools sirf tab add karo jab diye hain
    if (!empty($tools)) {
        $payload['tools'] = $tools;
    }

    $ch = curl_init(GEMINI_API_URL);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => json_encode($payload),
        CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
        CURLOPT_TIMEOUT        => 60,
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => false,
    ]);

    $response  = curl_exec($ch);
    $httpCode  = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlError = curl_error($ch);
    curl_close($ch);

    if ($curlError) {
        error_log("Gemini cURL error: " . $curlError);
        return false;
    }

    if ($httpCode !== 200) {
        error_log("Gemini HTTP {$httpCode}: " . substr($response, 0, 500));
        return false;
    }

    return $response;
}

// ================================================================
//  PARSE ITINERARY — Same as your original, works perfectly
// ================================================================
function parseItinerary(string $rawText, int $days): array {

    // Markdown fences hataو
    $cleaned = trim(preg_replace('/^```(?:json)?\s*|\s*```$/s', '', $rawText));

    $parsed = json_decode($cleaned, true);

    if (json_last_error() !== JSON_ERROR_NONE) {
        error_log("JSON parse error: " . json_last_error_msg());
        error_log("Cleaned sample: " . substr($cleaned, 0, 500));
        return buildFallback($days);
    }

    // Agar object wrap mein aaya ho
    if (is_array($parsed) && !isset($parsed[0])) {
        foreach (['itinerary', 'days', 'plan', 'schedule', 'trip'] as $key) {
            if (isset($parsed[$key]) && is_array($parsed[$key])) {
                $parsed = $parsed[$key];
                break;
            }
        }
        if (!isset($parsed[0])) {
            $first = reset($parsed);
            if (is_array($first)) $parsed = array_values($parsed);
        }
    }

    if (!is_array($parsed) || count($parsed) === 0) {
        error_log("Parsed result empty.");
        return buildFallback($days);
    }

    // Required keys ensure karo
    $required = ['day', 'title', 'morning', 'afternoon', 'evening', 'estimated_cost', 'notes'];
    foreach ($parsed as $index => $dayData) {
        foreach ($required as $key) {
            if (!isset($dayData[$key])) {
                $parsed[$index][$key] = ($key === 'estimated_cost') ? 0 : 'Not specified';
            }
        }
    }

    return $parsed;
}

// ================================================================
//  FALLBACK ITINERARY
// ================================================================
function buildFallback(int $days): array {
    $fallback = [];
    for ($i = 1; $i <= $days; $i++) {
        $fallback[] = [
            'day'            => $i,
            'title'          => "Day $i",
            'morning'        => 'To be planned',
            'afternoon'      => 'To be planned',
            'evening'        => 'To be planned',
            'estimated_cost' => 0,
            'notes'          => '',
        ];
    }
    return $fallback;
}

// ================================================================
//  UTILITY
// ================================================================
function sanitize(string $val): string {
    return htmlspecialchars(strip_tags(trim($val)), ENT_QUOTES, 'UTF-8');
}

function jsonError(string $msg): void {
    echo json_encode(['success' => false, 'error' => $msg]);
}
