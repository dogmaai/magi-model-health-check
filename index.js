import fetch from "node-fetch";

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;

// MAGIで現在使用中のモデル
const MAGI_MODELS = {
  mistral:   { model: "mistral-small-latest",                          unit: "SOPHIA-5" },
  gemini:    { model: "gemini-3-flash-preview",                        unit: "MELCHIOR-1" },
  groq:      { model: "llama-3.3-70b-versatile",                       unit: "ANIMA" },
  deepseek:  { model: "deepseek-v4-flash",                            unit: "CASPER" },
  qwen:      { model: "qwen-plus",                                     unit: "QWEN" },
  xai:       { model: "grok-4.3",                                     unit: "BALTHASAR" },
};

async function sendTelegram(message) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log("[TELEGRAM] Skipped - no credentials");
    return;
  }
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: "HTML" })
  });
}

async function checkMistral() {
  const res = await fetch("https://api.mistral.ai/v1/models", {
    headers: { "Authorization": "Bearer " + process.env.MISTRAL_API_KEY }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).substring(0, 200)}`);
  const data = await res.json();
  return (data.data || []).map(m => m.id);
}

async function checkGemini() {
  const res = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models?key=" + process.env.GEMINI_API_KEY
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).substring(0, 200)}`);
  const data = await res.json();
  return (data.models || []).map(m => m.name.replace("models/", ""));
}

async function checkGroq() {
  const res = await fetch("https://api.groq.com/openai/v1/models", {
    headers: { "Authorization": "Bearer " + process.env.GROQ_API_KEY }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).substring(0, 200)}`);
  const data = await res.json();
  return (data.data || []).map(m => m.id);
}

async function checkDeepSeek() {
  const res = await fetch("https://api.deepseek.com/models", {
    headers: { "Authorization": "Bearer " + process.env.DEEPSEEK_API_KEY }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).substring(0, 200)}`);
  const data = await res.json();
  return (data.data || []).map(m => m.id);
}

async function checkQwen() {
  const res = await fetch("https://dashscope-intl.aliyuncs.com/compatible-mode/v1/models", {
    headers: { "Authorization": "Bearer " + process.env.QWEN_API_KEY }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).substring(0, 200)}`);
  const data = await res.json();
  return (data.data || []).map(m => m.id);
}

async function checkXAI() {
  const res = await fetch("https://api.x.ai/v1/models", {
    headers: { "Authorization": "Bearer " + process.env.XAI_API_KEY }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).substring(0, 200)}`);
  const data = await res.json();
  return (data.data || []).map(m => m.id);
}

const CHECKERS = {
  mistral:  checkMistral,
  gemini:   checkGemini,
  groq:     checkGroq,
  deepseek: checkDeepSeek,
  qwen:     checkQwen,
  xai:      checkXAI,
};

async function main() {
  console.log("[HEALTH CHECK] Starting model health check v2...");
  const results = [];
  const issues = [];

  for (const [provider, { model, unit }] of Object.entries(MAGI_MODELS)) {
    try {
      const available = await CHECKERS[provider]();
      const isAvailable = available.some(m => m.includes(model) || model.includes(m));

      console.log(`[${provider.toUpperCase()}] ${model} -> ${isAvailable ? "OK" : "NOT FOUND"}`);
      console.log(`  Available: ${available.slice(0,5).join(", ")}...`);

      results.push({ provider, unit, model, status: isAvailable ? "OK" : "MISSING", available: available.length });

      if (!isAvailable) {
        issues.push({ provider, unit, model, available });
      }
    } catch (e) {
      console.error(`[${provider.toUpperCase()}] Error:`, e.message);
      results.push({ provider, unit, model, status: "ERROR", error: e.message });
      issues.push({ provider, unit, model, error: e.message });
    }
  }

  console.log("\n[SUMMARY]");
  for (const r of results) {
    console.log(`  ${r.provider}: ${r.status}`);
  }

  if (issues.length === 0) {
    console.log("[HEALTH CHECK] All models OK");
    await sendTelegram(`MAGI Model Health Check\nAll ${Object.keys(MAGI_MODELS).length} models are available.`);
  } else {
    let msg = "<b>MAGI Model Health Check - ISSUES DETECTED</b>\n\n";
    for (const issue of issues) {
      if (issue.error) {
        msg += `[${issue.provider.toUpperCase()}] ${issue.unit}: API ERROR\n${issue.error}\n\n`;
      } else {
        msg += `[${issue.provider.toUpperCase()}] ${issue.unit}: MODEL NOT FOUND\nExpected: ${issue.model}\nAvailable: ${(issue.available || []).slice(0,3).join(", ")}\n\n`;
      }
    }
    msg += "Action required: Update model name in magi-core.";
    console.log("[ALERT]", msg);
    await sendTelegram(msg);
  }

  console.log("[HEALTH CHECK] Done.");
}

main().catch(async (e) => {
  console.error("[FATAL]", e);
  await sendTelegram("MAGI Model Health Check FATAL ERROR: " + e.message);
  process.exit(1);
});
