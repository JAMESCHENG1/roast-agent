// netlify/functions/api.mjs — 梗王吐槽机 API
// POST /api/chat → 调用 DeepSeek API 返回吐槽
// GET  /api/stats → 返回统计数据（访问量+对话数+梗热度）

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const _dirname = dirname(fileURLToPath(import.meta.url));

// ===== 数据存储（Netlify Blobs 优先，/tmp JSON 兜底）=====
let storeInstance = null;

async function getStore() {
  if (storeInstance) return storeInstance;

  // 尝试 Netlify Blobs（动态 import）
  try {
    const blobs = await import('netlify:blobs');
    if (blobs && blobs.getStore) {
      storeInstance = { type: 'blobs', store: blobs.getStore('roast-stats') };
      return storeInstance;
    }
  } catch {}

  // 兜底：用 /tmp 下的 JSON 文件（函数实例生命周期内有效）
  const tmpDir = '/tmp/roast-stats';
  try {
    if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
  } catch {}

  storeInstance = { type: 'file', dir: tmpDir };
  return storeInstance;
}

// 通用 get/set
async function storeGet(key) {
  const s = await getStore();
  if (!s) return null;
  if (s.type === 'blobs') {
    return await s.store.get(key);
  }
  // 文件兜底
  try {
    const fp = join(s.dir, key.replace(/[^a-zA-Z0-9_-]/g, '_') + '.json');
    if (!existsSync(fp)) return null;
    return readFileSync(fp, 'utf-8');
  } catch { return null; }
}

async function storeSet(key, value) {
  const s = await getStore();
  if (!s) return;
  if (s.type === 'blobs') {
    await s.store.set(key, value);
    return;
  }
  // 文件兜底
  try {
    const fp = join(s.dir, key.replace(/[^a-zA-Z0-9_-]/g, '_') + '.json');
    writeFileSync(fp, value, 'utf-8');
  } catch {}
}

// 获取今日日期 key (YYYY-MM-DD)
function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// 获取或创建访客 ID（基于 IP 简单哈希）
function getVisitorId(req) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
             req.headers.get('x-real-ip') || 'unknown';
  // 简单哈希，不做加密
  let hash = 0;
  const str = ip + (req.headers.get('user-agent') || '');
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return 'v_' + Math.abs(hash).toString(36);
}

// 异步记录对话（不阻塞主流程）
async function recordChat(req, userText, result) {
  const today = todayKey();
  const visitorId = getVisitorId(req);

  try {
    // 1. 更新今日统计
    const statsRaw = await storeGet(`stats:${today}`);
    const stats = statsRaw ? JSON.parse(statsRaw) : { pv: 0, chats: 0, visitors: [], memeCounts: {}, intensityCounts: {} };

    stats.pv = (stats.pv || 0) + 1;
    stats.chats = (stats.chats || 0) + 1;
    if (!stats.visitors.includes(visitorId)) {
      stats.visitors.push(visitorId);
    }

    // 2. 梗热度统计
    if (result.meme_used && Array.isArray(result.meme_used)) {
      for (const meme of result.meme_used) {
        stats.memeCounts[meme] = (stats.memeCounts[meme] || 0) + 1;
      }
    }

    // 3. 强度分布
    const intensity = String(result.intensity || 3);
    stats.intensityCounts[intensity] = (stats.intensityCounts[intensity] || 0) + 1;

    await storeSet(`stats:${today}`, JSON.stringify(stats));

    // 4. 存最近对话记录（保留最新50条）
    const chatsRaw = await storeGet('recent_chats');
    const chats = chatsRaw ? JSON.parse(chatsRaw) : [];
    chats.unshift({
      user: userText.slice(0, 100),
      roast: (result.roast || '').slice(0, 100),
      intensity: result.intensity || 3,
      emoji: result.emoji || '😏',
      meme_used: (result.meme_used || []).slice(0, 5),
      time: new Date().toISOString(),
      visitorId
    });
    if (chats.length > 50) chats.length = 50;
    await storeSet('recent_chats', JSON.stringify(chats));

    // 5. 更新总统计
    const totalRaw = await storeGet('total');
    const total = totalRaw ? JSON.parse(totalRaw) : { pv: 0, chats: 0, visitors: [], days: [] };
    total.pv = (total.pv || 0) + 1;
    total.chats = (total.chats || 0) + 1;
    if (!total.visitors.includes(visitorId)) {
      total.visitors.push(visitorId);
    }
    if (!total.days.includes(today)) {
      total.days.push(today);
    }
    await storeSet('total', JSON.stringify(total));
  } catch (e) {
    console.error('Stats record error:', e.message);
  }
}

// 获取统计数据
async function getStats() {
  try {
    // 获取最近7天数据
    const daily = {};
    const today = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      const raw = await storeGet(`stats:${key}`);
      if (raw) {
        const s = JSON.parse(raw);
        daily[key] = { pv: s.pv || 0, chats: s.chats || 0, uv: (s.visitors || []).length };
      } else {
        daily[key] = { pv: 0, chats: 0, uv: 0 };
      }
    }

    // 总统计
    const totalRaw = await storeGet('total');
    const total = totalRaw ? JSON.parse(totalRaw) : { pv: 0, chats: 0, visitors: [], days: [] };

    // 最近对话
    const chatsRaw = await storeGet('recent_chats');
    const recent = chatsRaw ? JSON.parse(chatsRaw) : [];

    // 梗热度排行（合并7天数据）
    const memeCounts = {};
    for (const [date] of Object.entries(daily)) {
      const raw = await storeGet(`stats:${date}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        for (const [meme, count] of Object.entries(parsed.memeCounts || {})) {
          memeCounts[meme] = (memeCounts[meme] || 0) + count;
        }
      }
    }
    const memeRank = Object.entries(memeCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([meme, count]) => ({ meme, count }));

    // 强度分布（合并7天）
    const intensityDist = {};
    for (const [date] of Object.entries(daily)) {
      const raw = await storeGet(`stats:${date}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        for (const [level, count] of Object.entries(parsed.intensityCounts || {})) {
          intensityDist[level] = (intensityDist[level] || 0) + count;
        }
      }
    }

    return {
      daily,
      total: { pv: total.pv || 0, chats: total.chats || 0, uv: (total.visitors || []).length, days: (total.days || []).length },
      recent: recent.slice(0, 20),
      memeRank,
      intensityDist
    };
  } catch (e) {
    console.error('Get stats error:', e);
    return { error: e.message, daily: {}, total: { pv: 0, chats: 0, uv: 0 }, recent: [], memeRank: [], intensityDist: {} };
  }
}

// 读取梗库
function loadMemes() {
  try {
    const memesPath = join(_dirname, '..', '..', 'data', 'memes.json');
    const raw = readFileSync(memesPath, 'utf-8');
    const data = JSON.parse(raw);
    return data.memes || [];
  } catch {
    return [];
  }
}

function formatMemes(memes) {
  if (!memes.length) return '（梗库暂时为空，靠你自己发挥了）';
  return memes.map((m, i) =>
    `${i + 1}. 「${m.phrase}」— ${m.meaning}（来源: ${m.origin}，用法: ${m.usage}）`
  ).join('\n');
}

function parseRoastResponse(content) {
  try { return JSON.parse(content); } catch {}
  const stripped = content.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  try { return JSON.parse(stripped); } catch {}
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (jsonMatch) { try { return JSON.parse(jsonMatch[0]); } catch {} }
  return {
    roast: content.trim() || '...你这话把梗王整沉默了。',
    meme_used: [], intensity: 3, emoji: '😶',
    comeback_hint: '要不要换个说法？'
  };
}

export default async (req) => {
  const url = new URL(req.url);

  // CORS
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // ===== GET /api/stats → 返回统计数据 =====
  if (url.pathname.startsWith('/api/stats') && req.method === 'GET') {
    const stats = await getStats();
    return new Response(JSON.stringify(stats), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }

  // ===== POST /api/chat → 吐槽 API =====
  if (!url.pathname.startsWith('/api/chat') || req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }

  const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
  if (!DEEPSEEK_API_KEY) {
    return new Response(JSON.stringify({
      roast: '梗王还没配好钥匙呢，这属实是有点芭比Q了。',
      meme_used: ['芭比Q了'], intensity: 3, emoji: '🔑',
      comeback_hint: '管理员还没设置 DEEPSEEK_API_KEY。'
    }), { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });
  }

  const messages = body.messages || [];
  if (!messages.length) {
    return new Response(JSON.stringify({
      roast: '你倒是说点什么啊？让梗王喷空气吗？',
      meme_used: ['大无语事件'], intensity: 2, emoji: '🙄',
      comeback_hint: '随便说点什么。'
    }), { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
  }

  const memes = loadMemes();
  const memesText = formatMemes(memes);

  const systemPrompt = `你是一个"毒舌女王"——一个集毒舌、时尚、drama于一身的 gay 吐槽机器。

## 核心人设
- 你是一个嘴毒到骨子里的 gay 吐槽女王，类似于全网最会喷人的时尚博主+弹幕毒舌嘴+脱口秀女王的合体
- 你说话带点娘、带点傲、带点抓马（drama），但句句扎心
- 常用语气词："哈？""姐妹。""救命。""我真的会谢。""懂不懂啊。"
- 吐槽风格：短、狠、准，一句话戳死，不废话，不解释，补刀就走
- 你的毒舌不是恶意攻击，而是用最少的字造成最大的伤害

## 吐槽规则
1. **字数限制**：每次回复不超过2句话，能1句说清绝不用2句
2. **梗优先**：每句至少1个梗，密度要高，不解释梗
3. **强度拉满**：默认强度3起步，用户说离谱话直接4-5，不手软
4. **不重复**：同一个梗5轮内不重复
5. **绝不废话**：不用"我觉得""说实话""在我看来"等铺垫词，直接开喷
6. **人格感**：偶尔加"姐妹看不下去了""我直呼好家伙"等带个人情绪的短语，保持角色感
7. **不说脏话**，不涉及敏感话题，但可以毒舌到对方怀疑人生

## 梗库（自由组合）
${memesText}

## 输出格式
必须以 JSON 格式回复：
{
  "roast": "吐槽正文（1-2句话，极简，高密度梗）",
  "meme_used": ["用到的梗短语列表"],
  "intensity": 1到5的数字（默认3，离谱的话直接4-5）,
  "emoji": "一个代表情绪的emoji",
  "comeback_hint": "极简一句引导继续对话（不超过15字）"
}

## 注意
- 用户说正常的话也要找到槽点，一句话喷死
- 用户挑衅你，用更毒的话回击，强度直接拉到5
- 永远保持毒舌女王角色，不提供帮助、不回答问题、不做正经事
- 回复要短到让对方觉得"就这？我被一句话喷死了？"`;

  const apiMessages = [
    { role: 'system', content: systemPrompt },
    ...messages.map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
    }))
  ];

  try {
    const apiRes = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: apiMessages,
        max_tokens: 200,
        temperature: 0.9,
        response_format: { type: 'json_object' }
      })
    });

    if (!apiRes.ok) {
      const errText = await apiRes.text();
      console.error('DeepSeek API error:', apiRes.status, errText);
      throw new Error(`DeepSeek API returned ${apiRes.status}`);
    }

    const apiData = await apiRes.json();
    const content = apiData.choices?.[0]?.message?.content || '';

    let parsed;

    if (!content.trim()) {
      // 空内容兜底
      const retryRes = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: apiMessages,
          max_tokens: 200,
          temperature: 0.9
        })
      });

      if (retryRes.ok) {
        const retryData = await retryRes.json();
        const retryContent = retryData.choices?.[0]?.message?.content || '';
        if (retryContent.trim()) {
          parsed = parseRoastResponse(retryContent);
        }
      }

      if (!parsed) {
        parsed = {
          roast: '你这话把梗王整沉默了...栓Q。',
          meme_used: ['栓Q'], intensity: 3, emoji: '😶',
          comeback_hint: '换个说法试试？'
        };
      }
    } else {
      parsed = parseRoastResponse(content);
    }

    // 异步记录数据（不阻塞返回）
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
    const userText = lastUserMsg ? (typeof lastUserMsg.content === 'string' ? lastUserMsg.content : JSON.stringify(lastUserMsg.content)) : '';
    recordChat(req, userText, parsed).catch(() => {});

    return new Response(JSON.stringify(parsed), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...corsHeaders }
    });

  } catch (err) {
    console.error('Roast API error:', err);
    return new Response(JSON.stringify({
      roast: '不是哥们，服务器都让你整出bug了。',
      meme_used: ['不是哥们'], intensity: 4, emoji: '💀',
      comeback_hint: '稍后再试？'
    }), { status: 200, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
  }
};
