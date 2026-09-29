// netlify/functions/api.mjs — Netlify Function (Web API 格式)
// 接收 POST /api/chat，调用 DeepSeek API 返回吐槽 JSON

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const _dirname = dirname(fileURLToPath(import.meta.url));

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

// 将梗库格式化为文本
function formatMemes(memes) {
  if (!memes.length) return '（梗库暂时为空，靠你自己发挥了）';
  return memes.map((m, i) =>
    `${i + 1}. 「${m.phrase}」— ${m.meaning}（来源: ${m.origin}，用法: ${m.usage}）`
  ).join('\n');
}

// 解析 DeepSeek 返回内容（三层兜底）
function parseRoastResponse(content) {
  // 第一层：尝试直接 JSON.parse
  try {
    return JSON.parse(content);
  } catch {}

  // 第二层：strip markdown fences 再试
  const stripped = content.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  try {
    return JSON.parse(stripped);
  } catch {}

  // 第三层：正则提取 JSON 对象
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch {}
  }

  // 兜底：原文作为吐槽返回
  return {
    roast: content.trim() || '...你这话把梗王整沉默了。',
    meme_used: [],
    intensity: 3,
    emoji: '😶',
    comeback_hint: '要不要换个说法？'
  };
}

export default async (req) => {
  // 只处理 POST /api/chat
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const url = new URL(req.url);
  if (!url.pathname.startsWith('/api/chat')) {
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // 读取环境变量
  const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
  if (!DEEPSEEK_API_KEY) {
    return new Response(JSON.stringify({
      roast: '梗王还没配好钥匙呢，这属实是有点芭比Q了。',
      meme_used: ['芭比Q了'],
      intensity: 3,
      emoji: '🔑',
      comeback_hint: '管理员还没设置 DEEPSEEK_API_KEY 环境变量哦。'
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // 解析请求体
  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const messages = body.messages || [];

  if (!messages.length) {
    return new Response(JSON.stringify({
      roast: '你倒是说点什么啊？让梗王喷空气吗？',
      meme_used: ['大无语事件'],
      intensity: 2,
      emoji: '🙄',
      comeback_hint: '随便说点什么，梗王准备好了。'
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // 加载梗库并构建系统提示词
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

  // 构建 DeepSeek API 请求
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

    if (!content.trim()) {
      // 空内容兜底：去掉 response_format 重试一次
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
          const parsed = parseRoastResponse(retryContent);
          return new Response(JSON.stringify(parsed), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      }

      return new Response(JSON.stringify({
        roast: '你这话把梗王整沉默了...真的，栓Q。',
        meme_used: ['栓Q'],
        intensity: 3,
        emoji: '😶',
        comeback_hint: '要不要换个说法试试？'
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const parsed = parseRoastResponse(content);
    return new Response(JSON.stringify(parsed), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (err) {
    console.error('Roast API error:', err);
    return new Response(JSON.stringify({
      roast: '不是哥们，服务器都让你整出bug了。你先别说了。',
      meme_used: ['不是哥们'],
      intensity: 4,
      emoji: '💀',
      comeback_hint: '服务器开小差了，稍后再试？'
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};
