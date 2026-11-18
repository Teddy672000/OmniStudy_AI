// Vercel Serverless Function: gọi Gemini bằng API Key giấu trong biến môi trường GEMINI_API_KEY.
// Tự động thử model dự phòng nếu model được chọn không còn hoạt động (Google thường ngừng các model cũ).

const ALLOWED_MODELS = [
    'gemini-flash-latest',
    'gemini-flash-lite-latest',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-2.0-flash'
];
const FALLBACK_ORDER = ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-flash-lite-latest', 'gemini-2.5-flash-lite', 'gemini-2.0-flash'];
const MAX_PROMPT_CHARS = 60000;

async function callGemini(modelName, prompt, apiKey) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent`;
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: 'application/json' }
        })
    });
    const data = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, data };
}

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

    let body = req.body || {};
    if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch { body = {}; }
    }
    const { prompt, model } = body;

    if (!prompt || typeof prompt !== 'string') return res.status(400).json({ error: 'Thiếu nội dung cần phân tích' });
    if (prompt.length > MAX_PROMPT_CHARS) return res.status(413).json({ error: 'Tài liệu quá dài, vui lòng rút gọn' });

    // Lấy API Key từ biến môi trường của Vercel (người dùng không thể thấy)
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'Máy chủ chưa cấu hình GEMINI_API_KEY' });

    const first = ALLOWED_MODELS.includes(model) ? model : FALLBACK_ORDER[0];
    const candidates = [first, ...FALLBACK_ORDER.filter(m => m !== first)];

    let lastError = { status: 502, message: 'Không gọi được Gemini' };
    for (const modelName of candidates) {
        try {
            const result = await callGemini(modelName, prompt, apiKey);
            if (result.ok && result.data?.candidates?.length) {
                return res.status(200).json({ ...result.data, modelUsed: modelName });
            }
            lastError = { status: result.status || 502, message: result.data?.error?.message || `Model ${modelName} không phản hồi` };
            // Lỗi do khoá API / quyền truy cập: thử model khác cũng vô ích
            if (result.status === 401 || result.status === 403) break;
        } catch (error) {
            lastError = { status: 502, message: error.message };
        }
    }

    return res.status(lastError.status >= 400 ? lastError.status : 502).json({ error: lastError.message });
}
