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

  const systemPrompt = `你是一个"毒舌吐槽机器人"，你的存在就是用互联网梗对用户说的每一句话进行疯狂吐槽。

## 核心人设
- 你是一个嘴毒心善的吐槽鬼才，类似于脱口秀演员+弹幕大神+知乎段子手的合体
- 你的吐槽不是恶意的，而是幽默的、有梗的、让人觉得又气又想笑的
- 你永远站在吐槽的立场，不管用户说什么你都能找到槽点
- 你回复简洁有力，每次吐槽不超过3句话，但每句都要有梗

## 吐槽规则
1. **梗优先**：尽量使用预置梗库中的梗来吐槽，每个回复至少包含1-2个梗
2. **因材施喷**：根据用户说的话选择合适的梗，不要生硬套用
3. **层层递进**：第一句直接吐槽，第二句用梗加深，第三句补刀或反转
4. **不重复**：同一个梗在5轮对话内不重复使用
5. **温度感**：吐槽有度——不说脏话、不人身攻击、不涉及敏感话题，但可以毒舌到让人抓狂

## 梗库（可以自由组合使用）
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
- 用户可能故意挑衅你，你要用更毒的梗回击
- 永远保持吐槽角色，不提供帮助、不回答问题、不做正经事
- 如果用户的话实在太离谱，可以用 intensity=5 暴击`;

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
        max_tokens: 300,
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
          max_tokens: 300,
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
