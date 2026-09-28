// dev-server.mjs — 本地开发服务器
// 用法: node dev-server.mjs
// 前端 http://localhost:8888  API http://localhost:8888/api/chat

import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 8888;
const PUBLIC_DIR = join(__dirname, 'public');
const DATA_DIR = join(__dirname, 'data');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

// 读取梗库
function loadMemes() {
  try {
    const raw = readFileSync(join(DATA_DIR, 'memes.json'), 'utf-8');
    return JSON.parse(raw).memes || [];
  } catch {
    return [];
  }
}

function formatMemes(memes) {
  if (!memes.length) return '（梗库暂时为空）';
  return memes.map((m, i) =>
    `${i + 1}. 「${m.phrase}」— ${m.meaning}（来源: ${m.origin}，用法: ${m.usage}）`
  ).join('\n');
}

// 解析 DeepSeek 返回
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

async function callDeepSeek(messages, apiKey) {
  const memes = loadMemes();
  const memesText = formatMemes(memes);

  const systemPrompt = `你是一个"毒舌吐槽机器人"，你的存在就是用互联网梗对用户说的每一句话进行疯狂吐槽。

## 核心人设
- 你是一个嘴毒心善的吐槽鬼才，类似于脱口秀演员+弹幕大神+知乎段子手的合体
- 你的吐槽不是恶意的，而是幽默的、有梗的、让人觉得又气又想笑的
- 你永远站在吐槽的立场，不管用户说什么你都能找到槽点
- 你回复简洁有力，每次吐槽不超过3句话，但每句都要有梗

## 吐槽规则
1. 梗优先：尽量使用预置梗库中的梗来吐槽，每个回复至少包含1-2个梗
2. 因材施喷：根据用户说的话选择合适的梗，不要生硬套用
3. 层层递进：第一句直接吐槽，第二句用梗加深，第三句补刀或反转
4. 不重复：同一个梗在5轮对话内不重复使用
5. 温度感：吐槽有度——不说脏话、不人身攻击、不涉及敏感话题，但可以毒舌到让人抓狂

## 梗库
${memesText}

## 输出格式
你必须以 JSON 格式回复，包含以下字段：
{
  "roast": "你的吐槽正文（1-3句话，包含梗）",
  "meme_used": ["你用到的梗短语列表"],
  "intensity": 1到5的数字,
  "emoji": "一个代表这次吐槽情绪的emoji",
  "comeback_hint": "给用户的暗示，引导继续对话"
}

## 注意
- 用户可能说很正常的话，你也要找到槽点
- 永远保持吐槽角色，不提供帮助、不回答问题、不做正经事
- 如果用户的话实在太离谱，可以用 intensity=5 暴击`;

  const apiMessages = [
    { role: 'system', content: systemPrompt },
    ...messages.map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
    }))
  ];

  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: apiMessages,
      max_tokens: 300,
      temperature: 0.9,
      response_format: { type: 'json_object' }
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`DeepSeek API ${res.status}: ${errText}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || '';

  if (!content.trim()) {
    // 空内容兜底：去掉 response_format 重试
    const retry = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: apiMessages,
        max_tokens: 300,
        temperature: 0.9
      })
    });
    if (retry.ok) {
      const retryData = await retry.json();
      const retryContent = retryData.choices?.[0]?.message?.content || '';
      if (retryContent.trim()) return parseRoastResponse(retryContent);
    }
    return {
      roast: '你这话把梗王整沉默了...真的，栓Q。',
      meme_used: ['栓Q'], intensity: 3, emoji: '😶',
      comeback_hint: '要不要换个说法试试？'
    };
  }

  return parseRoastResponse(content);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = url.pathname;

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // API 路由
  if (pathname.startsWith('/api/chat') && req.method === 'POST') {
    const apiKey = process.env.DEEPSEEK_API_KEY;

    if (!apiKey) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        roast: '梗王还没配好钥匙呢，这属实是有点芭比Q了。',
        meme_used: ['芭比Q了'], intensity: 3, emoji: '🔑',
        comeback_hint: '请设置环境变量 DEEPSEEK_API_KEY。去 platform.deepseek.com 申请。'
      }));
      return;
    }

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { messages = [] } = JSON.parse(body);

        if (!messages.length) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            roast: '你倒是说点什么啊？让梗王喷空气吗？',
            meme_used: ['大无语事件'], intensity: 2, emoji: '🙄',
            comeback_hint: '随便说点什么，梗王准备好了。'
          }));
          return;
        }

        const result = await callDeepSeek(messages, apiKey);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      } catch (err) {
        console.error('API error:', err);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          roast: '不是哥们，服务器都让你整出bug了。你先别说了。',
          meme_used: ['不是哥们'], intensity: 4, emoji: '💀',
          comeback_hint: '服务器开小差了，稍后再试？'
        }));
      }
    });
    return;
  }

  // 静态文件
  let filePath = join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);

  if (!existsSync(filePath)) {
    // SPA 回退
    filePath = join(PUBLIC_DIR, 'index.html');
  }

  if (!existsSync(filePath)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('404 Not Found');
    return;
  }

  const ext = extname(filePath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  try {
    const data = readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  } catch {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('500 Internal Server Error');
  }
});

server.listen(PORT, () => {
  console.log(`\n🔥 梗王吐槽机 本地开发服务器已启动`);
  console.log(`   前端:  http://localhost:${PORT}`);
  console.log(`   API:   http://localhost:${PORT}/api/chat`);
  console.log(`   梗库:  ${loadMemes().length} 条梗已加载`);

  if (!process.env.DEEPSEEK_API_KEY) {
    console.log(`\n   ⚠️  未检测到 DEEPSEEK_API_KEY 环境变量`);
    console.log(`   请先设置: export DEEPSEEK_API_KEY=your_key_here`);
    console.log(`   申请地址: https://platform.deepseek.com\n`);
  } else {
    console.log(`   ✅ DeepSeek API Key 已配置\n`);
  }
});
