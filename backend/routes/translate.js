const express = require('express');
const router = express.Router();
const https = require('https');
const http = require('http');

const cache = new Map();

function fetchJson(url) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https') ? https : http;
        const req = client.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            timeout: 8000
        }, (res) => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(new Error('Invalid JSON'));
                }
            });
        });
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
        req.on('error', reject);
    });
}

async function translateText(text, from = 'en', to = 'km') {
    if (!text || !text.trim()) return '';
    const cleanText = text.trim();

    const target = (to === 'kh' ? 'km' : (to === 'cn' ? 'zh' : to)).toLowerCase();
    const source = (from === 'kh' ? 'km' : (from === 'cn' ? 'zh' : from)).toLowerCase();

    if (target === source) return cleanText;

    const cacheKey = source + '_' + target + '_' + cleanText;
    if (cache.has(cacheKey)) {
        return cache.get(cacheKey);
    }

    try {
        const url = 'https://api.mymemory.translated.net/get?q=' + encodeURIComponent(cleanText) + '&langpair=' + source + '|' + target;
        const res = await fetchJson(url);
        if (res && res.responseData && res.responseData.translatedText) {
            const translated = res.responseData.translatedText;
            cache.set(cacheKey, translated);
            return translated;
        }
    } catch (e) {
        console.warn('Translate warning:', e.message);
    }

    return cleanText;
}

router.post('/', async (req, res) => {
    try {
        const { text, texts, from = 'en', to = 'km' } = req.body;

        if (Array.isArray(texts)) {
            const results = await Promise.all(texts.map(t => translateText(t, from, to)));
            return res.json({ success: true, from, to, data: results });
        }

        if (typeof text === 'string') {
            const translated = await translateText(text, from, to);
            return res.json({ success: true, from, to, data: translated });
        }

        res.status(400).json({ success: false, message: 'Provide text or texts' });
    } catch (err) {
        console.error('Translation error:', err);
        res.status(500).json({ success: false, message: 'Translation failed' });
    }
});

router.post('/product', async (req, res) => {
    try {
        const { name, description } = req.body;

        const [nameKm, nameZh, descKm, descZh] = await Promise.all([
            name ? translateText(name, 'en', 'km') : '',
            name ? translateText(name, 'en', 'zh') : '',
            description ? translateText(description, 'en', 'km') : '',
            description ? translateText(description, 'en', 'zh') : ''
        ]);

        res.json({
            success: true,
            data: {
                km: { name: nameKm, description: descKm },
                zh: { name: nameZh, description: descZh }
            }
        });
    } catch (err) {
        console.error('Product translate error:', err);
        res.status(500).json({ success: false, message: 'Failed to auto-translate product' });
    }
});

module.exports = router;
