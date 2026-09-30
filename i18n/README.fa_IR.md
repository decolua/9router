<div align="center">
  <img src="./images/9router.png?1" alt="داشبورد 9Router" width="800"/>
  
  # 9Router - مسیریاب رایگان هوش مصنوعی و ذخیره‌ساز توکن
  
  **هرگز کدنویسی را متوقف نکنید. با RTK بین ۲۰ تا ۴۰٪ در توکن‌ها صرفه‌جویی کنید + بازگشت خودکار به مدل‌های رایگان و ارزان هوش مصنوعی.**
  
  **همه ابزارهای کدنویسی مبتنی بر هوش مصنوعی (Claude Code، Cursor، Antigravity، Copilot، Codex، Gemini، OpenCode، Cline، OpenClaw...) را به بیش از ۴۰ ارائه‌دهنده و ۱۰۰+ مدل متصل کنید.**
  
  [![npm](https://img.shields.io/npm/v/9router.svg)](https://www.npmjs.com/package/9router)
  [![Downloads](https://img.shields.io/npm/dm/9router.svg)](https://www.npmjs.com/package/9router)
  [![Docker Pulls](https://img.shields.io/docker/pulls/decolua/9router.svg?logo=docker&label=Docker%20pulls)](https://hub.docker.com/r/decolua/9router)
  [![GHCR](https://img.shields.io/badge/GHCR-decolua%2F9router-blue?logo=github)](https://github.com/decolua/9router/pkgs/container/9router)
  [![License](https://img.shields.io/npm/l/9router.svg)](https://github.com/decolua/9router/blob/main/LICENSE)

<a href="https://trendshift.io/repositories/22628" target="_blank"><img src="https://trendshift.io/api/badge/repositories/22628" alt="decolua%2F9router | Trendshift" style="width: 250px; height: 55px;" width="250" height="55"/></a>

[🚀 شروع سریع](#-شروع-سریع) • [💡 ویژگی‌ها](#-ویژگی‌های-کلیدی) • [📖 راه‌اندازی](#-راهنمای-راه‌اندازی) • [🌐 وب‌سایت](https://9router.com)

[🇻🇳 Tiếng Việt](./i18n/README.vi.md) • [🇨🇳 中文](./i18n/README.zh-CN.md) • [🇯🇵 日本語](./i18n/README.ja-JP.md) • [🇷🇺 Русский](./i18n/README.ru.md) • [🇮🇷 فارسی](./i18n/README.fa_IR.md)

</div>

---

## 🤔 چرا 9Router؟

**هدررفت پول، توکن و برخورد با محدودیت‌ها را متوقف کنید:**

- ❌ سهمیه اشتراک هر ماه بدون استفاده منقضی می‌شود
- ❌ محدودیت نرخ درخواست، شما را در میانه کدنویسی متوقف می‌کند
- ❌ خروجی ابزارها (git diff، grep، ls...) به سرعت توکن می‌سوزانند
- ❌ APIهای گران قیمت (۲۰ تا ۵۰ دلار در ماه برای هر ارائه‌دهنده)
- ❌ جابجایی دستی بین ارائه‌دهندگان

**9Router این مشکلات را حل می‌کند:**

- ✅ **ذخیره‌ساز توکن RTK** - فشرده‌سازی خودکار محتوای tool_result، صرفه‌جویی ۲۰ تا ۴۰٪ توکن در هر درخواست
- ✅ **حداکثر استفاده از اشتراک‌ها** - پیگیری سهمیه، استفاده از هر ذره قبل از بازنشانی
- ✅ **بازگشت خودکار** - اشتراک → ارزان → رایگان، بدون توقف
- ✅ **چند حساب کاربری** - چرخش گردشی بین حساب‌ها برای هر ارائه‌دهنده
- ✅ **جهانی** - با Claude Code، Codex، Cursor، Cline و هر ابزار خط فرمان کار می‌کند

---

## 🔄 نحوه عملکرد

```
┌─────────────┐
│  ابزار خط   │  (Claude Code, Codex, OpenClaw, Cursor, Cline...)
│  فرمان شما  │
└──────┬──────┘
       │ http://localhost:20128/v1
       ↓
┌─────────────────────────────────────────────┐
│           9Router (مسیریاب هوشمند)          │
│  • ذخیره‌ساز توکن RTK (کاهش توکن‌های tool_result) │
│  • ترجمه قالب (OpenAI ↔ Claude)             │
│  • پیگیری سهمیه                             │
│  • بازسازی خودکار توکن                      │
└──────┬──────────────────────────────────────┘
       │
       ├─→ [لایه ۱: اشتراک] Claude Code, Codex, GitHub Copilot
       │   ↓ اتمام سهمیه
       ├─→ [لایه ۲: ارزان] GLM (۰.۶ دلار/میلیون), MiniMax (۰.۲ دلار/میلیون)
       │   ↓ محدودیت بودجه
       └─→ [لایه ۳: رایگان] Kiro, OpenCode Free, Vertex (۳۰۰ دلار اعتبار)

نتیجه: هرگز کدنویسی را متوقف نکنید، حداقل هزینه + صرفه‌جویی ۲۰-۴۰٪ توکن با RTK
```

---

## ⚡ شروع سریع

**۱. نصب سراسری:**

```bash
npm install -g 9router
9router
```

🎉 داشبورد در آدرس `http://localhost:20128` باز می‌شود

**۲. اتصال یک ارائه‌دهنده رایگان (بدون نیاز به ثبت‌نام):**

داشبورد → ارائه‌دهندگان → اتصال **Kiro AI** (کلود رایگان نامحدود) یا **OpenCode Free** (بدون احراز هویت) → انجام شد!

**۳. استفاده در ابزار خط فرمان خود:**

```
تنظیمات Claude Code/Codex/OpenClaw/Cursor/Cline:
  آدرس端点: http://localhost:20128/v1
  کلید API: [کپی از داشبورد]
  مدل: kr/claude-sonnet-4.5
```

**کار تمام!** با مدل‌های رایگان هوش مصنوعی کدنویسی را شروع کنید.

**روش جایگزین: اجرا از سورس (این مخزن):**

بسته این مخزن خصوصی است (`9router-app`)، بنابراین اجرا از سورس/داکر مسیر معمول توسعه محلی است.

```bash
cp .env.example .env
npm install
PORT=20128 NEXT_PUBLIC_BASE_URL=http://localhost:20128 npm run dev
```

حالت تولید:

```bash
npm run build
PORT=20128 HOSTNAME=0.0.0.0 NEXT_PUBLIC_BASE_URL=http://localhost:20128 npm run start
```

آدرس‌های پیش‌فرض:

- داشبورد: `http://localhost:20128/dashboard`
- API سازگار با OpenAI: `http://localhost:20128/v1`

---

## راهنماهای تصویری

<div align="center">

<table>
  <tr>
  <td align="center" width="320">
  <a href="https://www.youtube.com/watch?v=X69n5Lm06Yw">
    <img src="https://img.youtube.com/vi/X69n5Lm06Yw/maxresdefault.jpg" alt="صرفه‌جویی در هزینه LLM با 9Router" width="300"/>
  </a><br/>
  <b>🇻🇳 ویتنامی</b><br/>
  <sub>صرفه‌جویی در هزینه LLM برای OpenClaw با 9Router<br/>توسط <a href="https://www.youtube.com/c/M%C3%ACAIblog">Mì AI</a></sub>
</td>
<td align="center" width="320">
      <a href="https://youtu.be/VQAw612S27Y">
        <img src="https://img.youtube.com/vi/VQAw612S27Y/maxresdefault.jpg" alt="راه‌اندازی نامحدود رایگان 9Router + Claude Code" width="300"/>
      </a><br/>
      <b>🇵🇰 اردو / हिन्दी</b><br/>
      <sub>راه‌اندازی نامحدود رایگان 9Router + Claude Code<br/>توسط <a href="https://www.youtube.com/@BuildAIWithHamid">Build AI With Hamid</a></sub>
    </td>
    <td align="center" width="320">
      <a href="https://www.youtube.com/watch?v=raEyZPg5xE0">
        <img src="https://img.youtube.com/vi/raEyZPg5xE0/maxresdefault.jpg" alt="آموزش راه‌اندازی 9Router" width="300"/>
      </a><br/>
      <b>🇺🇸 انگلیسی</b><br/>
      <sub>راه‌اندازی رایگان 9Router + Claude Code<br/>توسط <a href="https://www.youtube.com/@BuildAIWithHamid">Build AI With Hamid</a></sub>
    </td>
    
  </tr>
  <tr>
  <td align="center" width="320">
      <a href="https://youtu.be/3dF5GIYMrcQ?si=bAyfyiHbARJQAHj_">
        <img src="https://img.youtube.com/vi/3dF5GIYMrcQ/hqdefault.jpg" alt="آموزش راه‌اندازی 9Router" width="300"/>
      </a><br/>
      <b>🇺🇸 انگلیسی</b><br/>
      <sub>راه‌اندازی رایگان 9Router + Claude Code<br/>توسط <a href="https://www.youtube.com/@BuildAIWithHamid">Build AI With Hamid</a></sub>
    </td>
    <td align="center" width="320">
      <a href="https://www.youtube.com/watch?v=o3qYCyjrFYg">
        <img src="https://img.youtube.com/vi/o3qYCyjrFYg/maxresdefault.jpg" alt="Claude Code رایگان برای همیشه" width="300"/>
      </a><br/>
      <b>🇺🇸 انگلیسی</b><br/>
      <sub>Claude Code رایگان برای همیشه — مدل‌های نامحدود<br/>توسط <a href="https://www.youtube.com/@BuildAIWithHamid">Build AI With Hamid</a></sub>
    </td>
    <td align="center" width="320">
      <a href="https://www.youtube.com/watch?v=Ttpc26m39Dw">
        <img src="https://img.youtube.com/vi/Ttpc26m39Dw/maxresdefault.jpg" alt="راه‌اندازی رایگان Claude CLI" width="300"/>
      </a><br/>
      <b>🇺🇸 انگلیسی</b><br/>
      <sub>راه‌اندازی رایگان Claude CLI با 9Router 🚀<br/>توسط <a href="https://www.youtube.com/@CodeVerseSoban">CodeVerse Soban</a></sub>
    </td>
    
  </tr>
  <tr>
  <td align="center" width="320">
      <a href="https://www.youtube.com/watch?v=G-5A_D5Pm6Y">
        <img src="https://img.youtube.com/vi/G-5A_D5Pm6Y/maxresdefault.jpg" alt="نصب کامل OpenClaw رایگان" width="300"/>
      </a><br/>
      <b>🇻🇳 ویتنامی</b><br/>
      <sub>نصب کامل OpenClaw رایگان از صفر تا صد + 9Router<br/>توسط <a href="https://www.youtube.com/@maigia">Mai Gia</a></sub>
    </td>
    <td align="center" width="320">
      <a href="https://www.youtube.com/watch?v=JXmg8_gccgE">
        <img src="https://img.youtube.com/vi/JXmg8_gccgE/maxresdefault.jpg" alt="OpenClaw رایگان با Claude Opus" width="300"/>
      </a><br/>
      <b>🇺🇸 انگلیسی</b><br/>
      <sub>OpenClaw رایگان + Claude Opus 4.6<br/>توسط <a href="https://www.youtube.com/@BuildAIWithHamid">Build AI With Hamid</a></sub>
    </td>
    <td align="center" width="320">
      <a href="https://www.youtube.com/watch?v=CkVZZUSTXAI">
        <img src="https://img.youtube.com/vi/CkVZZUSTXAI/mqdefault.jpg" alt="راه‌اندازی رایگان Claude CLI" width="300"/>
      </a><br/>
      <b>🇮🇩 اندونزیایی</b><br/>
      <sub>کدنویسی ۲۴ ساعته بدون محدودیت نرخ! صرفه‌جویی ۶۵٪ توکن هوش مصنوعی | آموزش راه‌اندازی سریع 9Router 🚀<br/>توسط <a href="https://www.youtube.com/@krisswuh">Krisswuh</a></sub>
    </td>
    
  </tr>
  
  <tr>
  <td align="center" width="320">
      <a href="https://www.youtube.com/watch?v=TXGv4eofe1I">
        <img src="https://img.youtube.com/vi/TXGv4eofe1I/mqdefault.jpg" alt="روش استقرار 9Router در Hugging Face رایگان و همیشه روشن! | جایگزین VPS با ۱۶ گیگابایت رم" width="300"/>
      </a><br/>
      <b>🇮🇩 اندونزیایی</b><br/>
      <sub>روش استقرار 9Router در Hugging Face رایگان و همیشه روشن! | جایگزین VPS با ۱۶ گیگابایت رم<br/>توسط <a href="https://www.youtube.com/@krisswuh">Krisswuh</a></sub>
    </td>
  </tr>

</table>

</div>

> 🎬 **درباره 9Router ویدیو ساخته‌اید؟** یک [درخواست Pull](https://github.com/decolua/9router/pulls) برای افزودن ویدیوی خود به این بخش ارسال کنید — ما آن را ادغام خواهیم کرد!

---

## 🛠️ ابزارهای خط فرمان پشتیبانی شده

9Router به‌طور یکپارچه با تمام ابزارهای اصلی کدنویسی هوش مصنوعی کار می‌کند:

<div align="center">
  <table>
    <tr>
      <td align="center" width="120">
        <img src="./public/providers/claude.png" width="60" alt="Claude Code"/><br/>
        <b>Claude-Code</b>
      </td>
      <td align="center" width="120">
        <img src="./public/providers/openclaw.png" width="60" alt="OpenClaw"/><br/>
        <b>OpenClaw</b>
      </td>
      <td align="center" width="120">
        <img src="./public/providers/codex.png" width="60" alt="Codex"/><br/>
        <b>Codex</b>
      </td>
      <td align="center" width="120">
        <img src="./public/providers/opencode.png" width="60" alt="OpenCode"/><br/>
        <b>OpenCode</b>
      </td>
      <td align="center" width="120">
        <img src="./public/providers/cursor.png" width="60" alt="Cursor"/><br/>
        <b>Cursor</b>
      </td>
      <td align="center" width="120">
        <img src="./public/providers/antigravity.png" width="60" alt="Antigravity"/><br/>
        <b>Antigravity</b>
      </td>
    </tr>
    <tr>
      <td align="center" width="120">
        <img src="./public/providers/cline.png" width="60" alt="Cline"/><br/>
        <b>Cline</b>
      </td>
      <td align="center" width="120">
        <img src="./public/providers/continue.png" width="60" alt="Continue"/><br/>
        <b>Continue</b>
      </td>
      <td align="center" width="120">
        <img src="./public/providers/droid.png" width="60" alt="Droid"/><br/>
        <b>Droid</b>
      </td>
      <td align="center" width="120">
        <img src="./public/providers/roo.png" width="60" alt="Roo"/><br/>
        <b>Roo</b>
      </td>
      <td align="center" width="120">
        <img src="./public/providers/copilot.png" width="60" alt="Copilot"/><br/>
        <b>Copilot</b>
      </td>
      <td align="center" width="120">
        <img src="./public/providers/kilocode.png" width="60" alt="Kilo Code"/><br/>
        <b>Kilo Code</b>
      </td>
    </tr>
  </table>
</div>

---

## 🌐 ارائه‌دهندگان پشتیبانی شده

### 🔐 ارائه‌دهندگان OAuth

<div align="center">
  <table>
    <tr>
      <td align="center" width="120">
        <img src="./public/providers/claude.png" width="60" alt="Claude Code"/><br/>
        <b>Claude-Code</b>
      </td>
      <td align="center" width="120">
        <img src="./public/providers/antigravity.png" width="60" alt="Antigravity"/><br/>
        <b>Antigravity</b>
      </td>
      <td align="center" width="120">
        <img src="./public/providers/codex.png" width="60" alt="Codex"/><br/>
        <b>Codex</b>
      </td>
      <td align="center" width="120">
        <img src="./public/providers/github.png" width="60" alt="GitHub"/><br/>
        <b>GitHub</b>
      </td>
      <td align="center" width="120">
        <img src="./public/providers/cursor.png" width="60" alt="Cursor"/><br/>
        <b>Cursor</b>
      </td>
      <td align="center" width="120">
        <img src="./public/providers/kimchi.png" width="60" alt="Kimchi"/><br/>
        <b>Kimchi</b>
      </td>
    </tr>
  </table>
</div>

### 🆓 ارائه‌دهندگان رایگان

<div align="center">
  <table>
    <tr>
      <td align="center" width="150">
        <img src="./public/providers/kiro.png" width="70" alt="Kiro"/><br/>
        <b>Kiro AI</b><br/>
        <sub>Claude 4.5 + GLM-5 + MiniMax<br/>نامحدود رایگان</sub>
      </td>
      <td align="center" width="150">
        <img src="./public/providers/opencode.png" width="70" alt="OpenCode Free"/><br/>
        <b>OpenCode Free</b><br/>
        <sub>بدون احراز هویت • دریافت خودکار مدل‌ها<br/>نامحدود رایگان</sub>
      </td>
      <td align="center" width="150">
        <img src="./public/providers/gemini.png" width="70" alt="Vertex AI"/><br/>
        <b>Vertex AI</b><br/>
        <sub>Gemini 3 Pro + GLM-5 + DeepSeek<br/>۳۰۰ دلار اعتبار رایگان</sub>
      </td>
    </tr>
  </table>
</div>

> **توجه:** لایه‌های رایگان iFlow، Qwen و Gemini CLI در سال ۲۰۲۶ متوقف شدند. به جای آنها از Kiro / OpenCode Free / Vertex استفاده کنید.

### 🔑 ارائه‌دهندگان کلید API (۴۰+)

<div align="center">
  <table>
    <tr>
      <td align="center" width="100">
        <img src="./public/providers/openrouter.png" width="50" alt="OpenRouter"/><br/>
        <sub>OpenRouter</sub>
      </td>
      <td align="center" width="100">
        <img src="./public/providers/glm.png" width="50" alt="GLM"/><br/>
        <sub>GLM</sub>
      </td>
      <td align="center" width="100">
        <img src="./public/providers/kimi.png" width="50" alt="Kimi"/><br/>
        <sub>Kimi</sub>
      </td>
      <td align="center" width="100">
        <img src="./public/providers/minimax.png" width="50" alt="MiniMax"/><br/>
        <sub>MiniMax</sub>
      </td>
      <td align="center" width="100">
        <img src="./public/providers/openai.png" width="50" alt="OpenAI"/><br/>
        <sub>OpenAI</sub>
      </td>
      <td align="center" width="100">
        <img src="./public/providers/anthropic.png" width="50" alt="Anthropic"/><br/>
        <sub>Anthropic</sub>
      </td>
    </tr>
    <tr>
      <td align="center" width="100">
        <img src="./public/providers/gemini.png" width="50" alt="Gemini"/><br/>
        <sub>Gemini</sub>
      </td>
      <td align="center" width="100">
        <img src="./public/providers/deepseek.png" width="50" alt="DeepSeek"/><br/>
        <sub>DeepSeek</sub>
      </td>
      <td align="center" width="100">
        <img src="./public/providers/groq.png" width="50" alt="Groq"/><br/>
        <sub>Groq</sub>
      </td>
      <td align="center" width="100">
        <img src="./public/providers/xai.png" width="50" alt="xAI"/><br/>
        <sub>xAI</sub>
      </td>
      <td align="center" width="100">
        <img src="./public/providers/mistral.png" width="50" alt="Mistral"/><br/>
        <sub>Mistral</sub>
      </td>
      <td align="center" width="100">
        <img src="./public/providers/perplexity.png" width="50" alt="Perplexity"/><br/>
        <sub>Perplexity</sub>
      </td>
    </tr>
    <tr>
      <td align="center" width="100">
        <img src="./public/providers/together.png" width="50" alt="Together"/><br/>
        <sub>Together AI</sub>
      </td>
      <td align="center" width="100">
        <img src="./public/providers/fireworks.png" width="50" alt="Fireworks"/><br/>
        <sub>Fireworks</sub>
      </td>
      <td align="center" width="100">
        <img src="./public/providers/cerebras.png" width="50" alt="Cerebras"/><br/>
        <sub>Cerebras</sub>
      </td>
      <td align="center" width="100">
        <img src="./public/providers/cohere.png" width="50" alt="Cohere"/><br/>
        <sub>Cohere</sub>
      </td>
      <td align="center" width="100">
        <img src="./public/providers/nvidia.png" width="50" alt="NVIDIA"/><br/>
        <sub>NVIDIA</sub>
      </td>
      <td align="center" width="100">
        <img src="./public/providers/siliconflow.png" width="50" alt="SiliconFlow"/><br/>
        <sub>SiliconFlow</sub>
      </td>
    </tr>
  </table>
  <p><i>...و بیش از ۲۰ ارائه‌دهنده دیگر از جمله Nebius، Chutes، Hyperbolic و نقاط پایانی سفارشی سازگار با OpenAI/Anthropic</i></p>
</div>

---

## 💡 ویژگی‌های کلیدی

| ویژگی                                                                           | عملکرد                                                                                | اهمیت آن                                         |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------- |
| 🚀 **ذخیره‌ساز توکن RTK** ([RTK](https://github.com/rtk-ai/rtk) ⭐۴۰هزار)         | فشرده‌سازی خروجی ابزارها (`git diff`، `grep`، `ls`، `tree`...) قبل از ارسال به LLM        | صرفه‌جویی **۲۰ تا ۴۰٪ توکن ورودی** در هر درخواست |
| 🧠 **ذخیره‌ساز توکن Headroom** ([Headroom](https://github.com/chopratejas/headroom)) | پروکسی خارجی اختیاری `/v1/compress` قبل از مسیریابی به ارائه‌دهنده                      | صرفه‌جویی توکن‌های زمینه بیشتر بدون تغییر کلاینت |
| 🪨 **حالت غارنشین** ([Caveman](https://github.com/JuliusBrussee/caveman) ⭐۵۲هزار)   | تزریق پرامپت حالت غارنشین → پاسخ‌های مختصر LLM با حفظ محتوای فنی                        | صرفه‌جویی **تا ۶۵٪ توکن خروجی**                 |
| 🐴 **دم‌اسب** ([Ponytail](https://github.com/DietrichGebert/ponytail))          | تزریق پرامپت "توسعه‌دهنده ارشد تنبل" → کدنویسی حداقلی و YAGNI-first (سبک/کامل/فوق‌سبک) | **توکن خروجی کمتر، بازنویسی کمتر**              |
| 🎯 **بازگشت هوشمند ۳ لایه**                                                      | مسیریابی خودکار: اشتراک → ارزان → رایگان                                                  | هرگز کدنویسی متوقف نمی‌شود، بدون توقف            |
| 📊 **پیگیری سهمیه به‌روز**                                                   | تعداد توکن زنده + شمارش معکوس بازنشانی                                                  | حداکثر استفاده از اشتراک                        |
| 🔄 **ترجمه قالب**                                                         | OpenAI ↔ Claude ↔ Gemini ↔ Cursor ↔ Kiro ↔ Vertex                                        | کار با هر ابزار خط فرمان                         |
| 👥 **پشتیبانی از چند حساب**                                                      | چند حساب برای هر ارائه‌دهنده                                                             | توزیع بار + افزونگی                       |
| 🔄 **بازسازی خودکار توکن**                                                         | توکن‌های OAuth به‌طور خودکار بازسازی می‌شوند                                               | بدون نیاز به ورود مجدد دستی                     |
| 🎨 **ترکیب‌های سفارشی**                                                              | ایجاد ترکیب‌های نامحدود مدل                                                      | تنظیم بازگشت بر اساس نیاز شما                     |
| 📝 **ثبت درخواست**                                                            | حالت اشکال‌زدایی با لاگ‌های کامل درخواست/پاسخ                                               | عیب‌یابی آسان مسائل                              |
| 💾 **همگام‌سازی ابری**                                                                 | همگام‌سازی تنظیمات بین دستگاه‌ها                                                               | همان تنظیمات در همه جا                            |
| 📊 **تحلیل استفاده**                                                            | پیگیری توکن‌ها، هزینه، روندها در طول زمان                                                     | بهینه‌سازی هزینه‌ها                                 |
| 🌐 **استقرار در هر جا**                                                            | لوکال‌هست، VPS، داکر، Cloudflare Workers                                               | گزینه‌های استقرار انعطاف‌پذیر                      |

<details>
<summary><b>📖 جزئیات ویژگی‌ها</b></summary>

### 🚀 ذخیره‌ساز توکن RTK

خروجی ابزارها (`git diff`، `grep`، `find`، `ls`، `tree`، دامپ لاگ‌ها...) اغلب ۳۰ تا ۵۰٪ از بودجه پرامپت شما را مصرف می‌کنند. RTK آنها را شناسایی کرده و فشرده‌سازی هوشمند و بدون افت کیفیت **قبل از رسیدن درخواست به LLM** اعمال می‌کند:

- **فیلترها:** `git-diff`، `git-status`، `grep`، `find`، `ls`، `tree`، `dedup-log`، `smart-truncate`، `read-numbered`، `search-list`
- **تشخیص خودکار:** نیازی به تنظیمات نیست — RTK یک کیلوبایت اول هر `tool_result` را بررسی کرده و فیلتر مناسب را انتخاب می‌کند.
- **ایمن در طراحی:** اگر فیلتری با شکست مواجه شود، خطا دهد یا خروجی را بزرگ‌تر کند، RTK بی‌صدا متن اصلی را نگه می‌دارد. خطاها هرگز درخواست شما را خراب نمی‌کنند.
- **جهانی:** در همه فرمت‌ها (OpenAI، Claude، Gemini، Cursor، Kiro، OpenAI Responses) کار می‌کند زیرا **قبل از** هرگونه ترجمه قالب اجرا می‌شود.
- **روشن پیش‌فرض:** در هر زمان در داشبورد → تنظیمات نقطه پایانی قابل تغییر است.

```
بدون RTK: ۴۷ هزار توکن ارسال شده به LLM
با RTK:    ۲۸ هزار توکن ارسال شده به LLM   (۴۰٪ صرفه‌جویی · همان زمینه · همان پاسخ)
```

### 🧠 ذخیره‌ساز توکن Headroom

Headroom اختیاری است و به‌طور جداگانه اجرا می‌شود. 9Router نقطه پایانی محلی `/v1/compress` Headroom را فراخوانی کرده، سپس مسیریابی معمولی، بازگشت، احراز هویت و پیگیری مصرف را ادامه می‌دهد:

```
کلاینت → 9Router → Headroom /v1/compress → 9Router → ارائه‌دهنده
```

راه‌اندازی محلی:

```bash
pip install "headroom-ai[proxy]"
headroom proxy --port 8787
```

در داشبورد → نقطه پایانی → ذخیره‌ساز توکن → Headroom فعال کنید. آدرس پیش‌فرض: `http://localhost:8787`.

مثال‌های داکر:

```bash
# سرویس Headroom در همان شبکه داکر
http://headroom:8787

# Headroom در حال اجرا روی ماشین میزبان
http://host.docker.internal:8787
```

اگر Headroom از کار بیفتد یا خطا برگرداند، 9Router به‌حالت بازگشت باز می‌شود و درخواست اصلی را ارسال می‌کند.

### 🐴 دم‌اسب (توسعه‌دهنده ارشد تنبل)

دم‌اسب یک پرامپت سیستمی _"توسعه‌دهنده ارشد تنبل"_ را به هر درخواست تزریق می‌کند و LLM را به سمت کدنویسی حداقلی و YAGNI-first سوق می‌دهد — حذف به جای افزودن، کتابخانه استاندارد به جای وابستگی‌های جدید، یک خطی به جای انتزاعات. اقتباس شده از [DietrichGebert/ponytail](https://github.com/DietrichGebert/ponytail).

- **سبک** — آنچه خواسته شده را بساز، جایگزین تنبل‌تر را نام ببر.
- **کامل** — نردبان YAGNI اعمال می‌شود: کتابخانه استاندارد → بومی → وابستگی‌های موجود → یک خطی → حداقل کد.
- **فوق‌سبک** — افراط‌گرای YAGNI: اول حذف، یک خطی را ارسال کن، بقیه نیازمندی را در همان پاسخ به چالش بکش.

```
بدون دم‌اسب: کد پرحجم، انتزاعات اضافی، داربست‌های "فقط در صورت نیاز"
با دم‌اسب:    کوتاه‌ترین دیف کاری، بدون انتزاعات درخواست نشده، توکن کمتر
```

هرگز موارد زیر را قربانی نمی‌کند: اعتبارسنجی ورودی، مدیریت خطا که از از دست رفتن داده جلوگیری می‌کند، امنیت، دسترس‌پذیری، یا هر چیزی که به‌صراحت درخواست شده باشد. در داشبورد → نقطه پایانی → دم‌اسب فعال کنید. با حالت غارنشین (مختصر بودن خروجی) و RTK (فشرده‌سازی ورودی) ترکیب می‌شود.

### 🎯 بازگشت هوشمند ۳ لایه

ترکیب‌هایی با بازگشت خودکار ایجاد کنید:

```
ترکیب: "my-coding-stack"
  1. cc/claude-opus-4-6        (اشتراک شما)
  2. glm/glm-4.7               (پشتیبان ارزان، ۰.۶ دلار/میلیون)
  3. if/kimi-k2-thinking       (بازگشت رایگان)

→ وقتی سهمیه تمام شود یا خطا رخ دهد، به‌طور خودکار تغییر می‌کند
```

### 📊 پیگیری سهمیه به‌روز

- مصرف توکن به ازای هر ارائه‌دهنده
- شمارش معکوس بازنشانی (۵ ساعته، روزانه، هفتگی)
- تخمین هزینه برای لایه‌های پولی
- گزارش‌های هزینه ماهانه

### 🔄 ترجمه قالب

ترجمه یکپارچه بین قالب‌ها:

- **OpenAI** ↔ **Claude** ↔ **Gemini** ↔ **Cursor** ↔ **Kiro** ↔ **Vertex** ↔ **Antigravity** ↔ **Ollama** ↔ **OpenAI Responses**
- ابزار خط فرمان شما قالب OpenAI ارسال می‌کند → 9Router ترجمه می‌کند → ارائه‌دهنده قالب بومی دریافت می‌کند
- با هر ابزاری که از نقاط پایانی سفارشی OpenAI پشتیبانی می‌کند کار می‌کند

### 👥 پشتیبانی از چند حساب

- افزودن چند حساب برای هر ارائه‌دهنده
- مسیریابی خودکار گردشی یا اولویت‌محور
- بازگشت به حساب بعدی وقتی یکی به سهمیه رسید

### 🔄 بازسازی خودکار توکن

- توکن‌های OAuth به‌طور خودکار قبل از انقضا بازسازی می‌شوند
- بدون نیاز به احراز هویت مجدد دستی
- تجربه یکپارچه در همه ارائه‌دهندگان

### 🎨 ترکیب‌های سفارشی

- ایجاد ترکیب‌های نامحدود مدل
- ترکیب لایه‌های اشتراک، ارزان و رایگان
- نام‌گذاری ترکیب‌ها برای دسترسی آسان
- اشتراک‌گذاری ترکیب‌ها بین دستگاه‌ها با همگام‌سازی ابری

### 📝 ثبت درخواست

- فعال‌سازی حالت اشکال‌زدایی برای لاگ‌های کامل درخواست/پاسخ
- پیگیری فراخوانی‌های API، هدرها و محموله‌ها
- عیب‌یابی مسائل یکپارچه‌سازی
- خروجی لاگ‌ها برای تحلیل

### 💾 همگام‌سازی ابری

- همگام‌سازی ارائه‌دهندگان، ترکیب‌ها و تنظیمات بین دستگاه‌ها
- همگام‌سازی خودکار در پس‌زمینه
- ذخیره‌سازی رمزگذاری شده امن
- دسترسی به تنظیمات خود از هر جا

#### نکات اجرای ابری

- در تولید از متغیرهای سمت سرور ابری استفاده کنید:
  - `BASE_URL` (آدرس داخلی بازگشت برای برنامه‌ریز همگام‌سازی)
  - `CLOUD_URL` (آدرس پایه نقطه پایانی همگام‌سازی ابری)
- `NEXT_PUBLIC_BASE_URL` و `NEXT_PUBLIC_CLOUD_URL` همچنان برای سازگاری/رابط کاربری پشتیبانی می‌شوند، اما زمان اجرای سرور اکنون `BASE_URL`/`CLOUD_URL` را اولویت می‌دهد.
- درخواست‌های همگام‌سازی ابری اکنون از زمان‌بندی + رفتار شکست سریع برای جلوگیری از هنگ کردن رابط کاربری در صورت عدم دسترسی شبکه ابری/DNS استفاده می‌کنند.

### 📊 تحلیل استفاده

- پیگیری مصرف توکن به ازای هر ارائه‌دهنده و مدل
- تخمین هزینه و روندهای هزینه
- گزارش‌های ماهانه و بینش‌ها
- بهینه‌سازی هزینه هوش مصنوعی

> **💡 مهم - درک هزینه‌های داشبورد:**
>
> "هزینه" نمایش داده شده در تحلیل استفاده **فقط برای پیگیری و مقایسه** است.
> خود 9Router **هرگز از شما هزینه‌ای دریافت نمی‌کند**. شما فقط مستقیماً به ارائه‌دهندگان هزینه می‌پردازید (در صورت استفاده از خدمات پولی).
>
> **مثال:** اگر داشبورد شما "۲۹۰ دلار هزینه کل" را هنگام استفاده از مدل‌های iFlow نشان می‌دهد، این مبلغ چیزی است که در صورت استفاده مستقیم از APIهای پولی پرداخت می‌کردید. هزینه واقعی شما = **۰ دلار** (iFlow رایگان نامحدود است).
>
> به آن به عنوان "ردیاب پس‌انداز" فکر کنید که نشان می‌دهد با استفاده از مدل‌های رایگان یا مسیریابی از طریق 9Router چقدر صرفه‌جویی می‌کنید!

### 🌐 استقرار در هر جا

- 💻 **لوکال‌هست** - پیش‌فرض، آفلاین کار می‌کند
- ☁️ **VPS/ابر** - اشتراک‌گذاری بین دستگاه‌ها
- 🐳 **داکر** - استقرار با یک دستور
- 🚀 **Cloudflare Workers** - شبکه لبه جهانی

</details>

---

## 💰 قیمت‌گذاری در یک نگاه

| لایه                | ارائه‌دهنده              | هزینه         | بازنشانی سهمیه      | بهترین استفاده                                |
| ------------------- | --------------------- | ------------ | ---------------- | --------------------------------------- |
| **🚀 ذخیره‌ساز توکن**  | **RTK (ساخته شده)**    | **رایگان**     | همیشه روشن        | **صرفه‌جویی ۲۰-۴۰٪ توکن در هر درخواست** |
| **💳 اشتراک** | Claude Code (Pro/Max) | ۲۰-۲۰۰ دلار/ماه   | ۵ ساعته + هفتگی      | قبلاً اشتراک دارید                      |
|                     | Codex (Plus/Pro)      | ۲۰-۲۰۰ دلار/ماه   | ۵ ساعته + هفتگی      | کاربران OpenAI                            |
|                     | GitHub Copilot        | ۱۰-۱۹ دلار/ماه    | ماهانه          | کاربران GitHub                            |
|                     | Cursor IDE            | ۲۰ دلار/ماه       | ماهانه          | کاربران Cursor                            |
| **💰 ارزان**        | GLM-5.1 / GLM-4.7     | ۰.۶ دلار/میلیون      | روزانه ساعت ۱۰ صبح       | پشتیبان بودجه                           |
|                     | MiniMax M2.7          | ۰.۲ دلار/میلیون      | ۵ ساعته گردشی   | ارزان‌ترین گزینه                         |
|                     | Kimi K2.5             | ۹ دلار/ماه مسطح   | ۱۰ میلیون توکن/ماه    | هزینه قابل پیش‌بینی                        |
| **🆓 رایگان**         | Kiro AI               | ۰ دلار           | نامحدود        | Claude 4.5 + GLM-5 + MiniMax رایگان       |
|                     | OpenCode Free         | ۰ دلار           | نامحدود        | بدون احراز هویت، دریافت خودکار مدل‌ها              |
|                     | Vertex AI             | ۳۰۰ دلار اعتبار | حساب‌های جدید GCP | Gemini 3 Pro + DeepSeek + GLM-5         |

**💡 نکته حرفه‌ای:** ترکیب RTK + Kiro AI + OpenCode Free = **۰ دلار هزینه + ۲۰-۴۰٪ صرفه‌جویی توکن**!

---

### 📊 درک هزینه‌ها و صورتحساب 9Router

**واقعیت صورتحساب 9Router:**

✅ **نرم‌افزار 9Router = رایگان برای همیشه** (منبع باز، هرگز هزینه‌ای دریافت نمی‌کند)  
✅ **"هزینه‌های" داشبورد = فقط نمایش/پیگیری** (صورتحساب واقعی نیستند)  
✅ **شما مستقیماً به ارائه‌دهندگان هزینه می‌پردازید** (اشتراک‌ها یا هزینه‌های API)  
✅ **ارائه‌دهندگان رایگان واقعاً رایگان هستند** (iFlow، Kiro، Qwen = ۰ دلار نامحدود)  
❌ **9Router هرگز صورتحساب ارسال نمی‌کند** یا کارت شما را شارژ نمی‌کند

**نحوه عملکرد نمایش هزینه:**

داشبورد **هزینه‌های تخمینی** را نشان می‌دهد گویی مستقیماً از APIهای پولی استفاده می‌کنید. این **صورتحساب نیست** - این یک ابزار مقایسه برای نشان دادن پس‌انداز شماست.

**سناریوی مثال:**

```
نمایش داشبورد:
• تعداد درخواست‌ها: ۱,۶۶۲
• کل توکن‌ها: ۴۷ میلیون
• هزینه نمایشی: ۲۹۰ دلار

بررسی واقعیت:
• ارائه‌دهنده: iFlow (رایگان نامحدود)
• پرداخت واقعی: ۰.۰۰ دلار
• منظور از ۲۹۰ دلار: مبلغی که با استفاده از مدل‌های رایگان پس‌انداز کرده‌اید!
```

**قوانین پرداخت:**

- **ارائه‌دهندگان اشتراک** (Claude Code، Codex): مستقیماً از طریق وب‌سایت‌هایشان به آنها پرداخت کنید
- **ارائه‌دهندگان ارزان** (GLM، MiniMax): مستقیماً به آنها پرداخت کنید، 9Router فقط مسیریابی می‌کند
- **ارائه‌دهندگان رایگان** (iFlow، Kiro، Qwen): واقعاً برای همیشه رایگان، بدون هزینه پنهان
- **9Router**: هرگز هیچ هزینه‌ای دریافت نمی‌کند، همیشه

---

## 🎯 موارد استفاده

### مورد ۱: "من اشتراک Claude Pro دارم"

**مشکل:** سهمیه بدون استفاده منقضی می‌شود، محدودیت نرخ در حین کدنویسی سنگین

**راه‌حل:**

```
ترکیب: "maximize-claude"
  1. cc/claude-opus-4-7        (استفاده کامل از اشتراک)
  2. glm/glm-5.1               (پشتیبان ارزان وقتی سهمیه تمام شد)
  3. kr/claude-sonnet-4.5      (بازگشت اضطراری رایگان)

هزینه ماهانه: ۲۰ دلار (اشتراک) + حدود ۵ دلار (پشتیبان) = ۲۵ دلار کل
در مقابل ۲۰ دلار + برخورد با محدودیت = ناامیدی
```

### مورد ۲: "من هزینه صفر می‌خواهم"

**مشکل:** توانایی پرداخت اشتراک را ندارم، به هوش مصنوعی کدنویسی قابل اعتماد نیاز دارم

**راه‌حل:**

```
ترکیب: "free-forever"
  1. kr/claude-sonnet-4.5      (Claude 4.5 رایگان نامحدود)
  2. kr/glm-5                  (GLM-5 رایگان از طریق Kiro)
  3. oc/<auto>                 (OpenCode Free، بدون احراز هویت)

هزینه ماهانه: ۰ دلار
کیفیت: مدل‌های آماده تولید + RTK صرفه‌جویی ۲۰-۴۰٪ توکن
```

### مورد ۳: "به کدنویسی ۲۴/۷ بدون وقفه نیاز دارم"

**مشکل:** ضرب‌الاجل‌ها، توانایی پرداخت هزینه توقف را ندارم

**راه‌حل:**

```
ترکیب: "always-on"
  1. cc/claude-opus-4-7        (بهترین کیفیت)
  2. cx/gpt-5.5                (اشتراک دوم)
  3. glm/glm-5.1               (ارزان، بازنشانی روزانه)
  4. minimax/MiniMax-M2.7      (ارزان‌ترین، بازنشانی ۵ ساعته)
  5. kr/claude-sonnet-4.5      (رایگان نامحدود)

نتیجه: ۵ لایه بازگشت = بدون توقف
هزینه ماهانه: ۲۰-۲۰۰ دلار (اشتراک‌ها) + ۱۰-۲۰ دلار (پشتیبان)
```

### مورد ۴: "من هوش مصنوعی رایگان در OpenClaw می‌خواهم"

**مشکل:** به دستیار هوش مصنوعی در برنامه‌های پیام‌رسان (واتساپ، تلگرام، اسلک...) نیاز دارم، کاملاً رایگان

**راه‌حل:**

```
ترکیب: "openclaw-free"
  1. kr/claude-sonnet-4.5      (Claude 4.5 رایگان)
  2. kr/glm-5                  (GLM-5 رایگان)
  3. kr/MiniMax-M2.5           (MiniMax رایگان)

هزینه ماهانه: ۰ دلار
دسترسی از طریق: واتساپ، تلگرام، اسلک، دیسکورد، iMessage، سیگنال...
```

---

## ❓ سوالات متداول

<details>
<summary><b>📊 چرا داشبورد من هزینه‌های بالا نشان می‌دهد؟</b></summary>

داشبورد مصرف توکن شما را پیگیری کرده و **هزینه‌های تخمینی** را نشان می‌دهد گویی مستقیماً از APIهای پولی استفاده می‌کنید. این **صورتحساب واقعی نیست** - این یک مرجع برای نشان دادن میزان پس‌انداز شما با استفاده از مدل‌های رایگان یا اشتراک‌های موجود از طریق 9Router است.

**مثال:**

- **داشبورد نشان می‌دهد:** "۲۹۰ دلار هزینه کل"
- **واقعیت:** شما از iFlow (رایگان نامحدود) استفاده می‌کنید
- **هزینه واقعی شما:** **۰.۰۰ دلار**
- **منظور از ۲۹۰ دلار:** مبلغی که با استفاده از مدل‌های رایگان به جای APIهای پولی **پس‌انداز** کرده‌اید!

نمایش هزینه یک "ردیاب پس‌انداز" است تا به شما در درک الگوهای مصرف و فرصت‌های بهینه‌سازی کمک کند.

</details>

<details>
<summary><b>💳 آیا توسط 9Router شارژ می‌شوم؟</b></summary>

**خیر.** 9Router نرم‌افزاری رایگان و منبع باز است که روی رایانه خودتان اجرا می‌شود. هرگز از شما هزینه‌ای دریافت نمی‌کند.

**شما فقط پرداخت می‌کنید:**

- ✅ **ارائه‌دهندگان اشتراک** (Claude Code ۲۰ دلار/ماه، Codex ۲۰-۲۰۰ دلار/ماه) → مستقیماً در وب‌سایت‌هایشان به آنها پرداخت کنید
- ✅ **ارائه‌دهندگان ارزان** (GLM، MiniMax) → مستقیماً به آنها پرداخت کنید، 9Router فقط درخواست‌های شما را مسیریابی می‌کند
- ❌ **خود 9Router** → **هرگز هیچ هزینه‌ای دریافت نمی‌کند، همیشه**

9Router یک پروکسی/مسیریاب محلی است. کارت اعتباری شما را ندارد، نمی‌تواند صورتحساب ارسال کند و سیستم صورتحساب ندارد. این نرم‌افزار کاملاً رایگان است.

</details>

<details>
<summary><b>🆓 آیا ارائه‌دهندگان رایگان واقعاً نامحدود هستند؟</b></summary>

**بله!** ارائه‌دهندگان رایگان فعلی (Kiro، OpenCode Free، Vertex) واقعاً رایگان هستند و **هزینه پنهانی ندارند**.

اینها خدمات رایگانی هستند که توسط آن شرکت‌ها ارائه می‌شوند:

- **Kiro AI**: Claude 4.5 + GLM-5 + MiniMax نامحدود رایگان از طریق AWS Builder ID / Google / GitHub OAuth
- **OpenCode Free**: پروکسی عبوری بدون احراز هویت، مدل‌ها به‌طور خودکار از `opencode.ai/zen/v1/models` دریافت می‌شوند
- **Vertex AI**: ۳۰۰ دلار اعتبار رایگان برای حساب‌های جدید Google Cloud (۹۰ روز)

9Router فقط درخواست‌های شما را به آنها مسیریابی می‌کند - هیچ "دام" یا صورتحساب آینده‌ای وجود ندارد. آنها واقعاً خدمات رایگان هستند و 9Router استفاده از آنها را با پشتیبانی از بازگشت آسان می‌کند.

**لایه‌های رایگان متوقف شده (دیگر توصیه نمی‌شوند):**

- ❌ **iFlow**: قبلاً رایگان نامحدود بود، اکنون به پولی تغییر کرده است (۲۰۲۶)
- ❌ **Qwen Code**: لایه رایگان OAuth توسط علی‌بابا در ۲۰۲۶-۰۴-۱۵ متوقف شد
- ❌ **Gemini CLI**: همچنان کار می‌کند، اما استفاده از آن با ابزارهای غیر CLI (Claude، Codex، Cursor...) ممکن است منجر به مسدود شدن حساب شود — فقط در صورت استفاده از خود Gemini CLI از آن استفاده کنید

</details>

<details>
<summary><b>💰 چگونه هزینه‌های واقعی هوش مصنوعی خود را به حداقل برسانم؟</b></summary>

**استراتژی اولویت با رایگان:**

۱. **با ترکیب ۱۰۰٪ رایگان شروع کنید:**

   ```
   1. gc/gemini-3-flash (۱۸۰ هزار توکن/ماه رایگان از گوگل)
   2. if/kimi-k2-thinking (نامحدود رایگان از iFlow)
   3. qw/qwen3-coder-plus (نامحدود رایگان از Qwen)
   ```

   **هزینه: ۰ دلار/ماه**

۲. **در صورت نیاز، پشتیبان ارزان اضافه کنید:**

   ```
   4. glm/glm-4.7 (۰.۶ دلار/میلیون توکن)
   ```

   **هزینه اضافی: فقط برای چیزی که واقعاً استفاده می‌کنید پرداخت کنید**

۳. **از ارائه‌دهندگان اشتراک در آخر استفاده کنید:**
   - فقط در صورتی که از قبل آنها را دارید
   - 9Router با پیگیری سهمیه به حداکثر رساندن ارزش آنها کمک می‌کند

**نتیجه:** اکثر کاربران می‌توانند با استفاده فقط از لایه‌های رایگان با ۰ دلار/ماه کار کنند!

</details>

<details>
<summary><b>📈 اگر مصرف من ناگهان افزایش یابد چه؟</b></summary>

بازگشت هوشمند 9Router از هزینه‌های غافلگیرکننده جلوگیری می‌کند:

**سناریو:** شما در یک ماراتن کدنویسی هستید و سهمیه‌های خود را تمام می‌کنید

**بدون 9Router:**

- ❌ برخورد با محدودیت نرخ → کار متوقف می‌شود → ناامیدی
- ❌ یا: به‌طور تصادفی صورت‌حساب‌های عظیم API جمع می‌کنید

**با 9Router:**

- ✅ اشتراک به حد مجاز می‌رسد → بازگشت خودکار به لایه ارزان
- ✅ لایه ارزان گران می‌شود → بازگشت خودکار به لایه رایگان
- ✅ هرگز کدنویسی را متوقف نکنید → هزینه‌های قابل پیش‌بینی

**شما کنترل دارید:** محدودیت‌های هزینه را برای هر ارائه‌دهنده در داشبورد تنظیم کنید و 9Router به آنها احترام می‌گذارد.

</details>

---

## 📖 راهنمای راه‌اندازی

<details>
<summary><b>🔐 ارائه‌دهندگان اشتراک (حداکثر کردن ارزش)</b></summary>

### Claude Code (Pro/Max)

```bash
داشبورد → ارائه‌دهندگان → اتصال Claude Code
→ ورود OAuth → بازسازی خودکار توکن
→ پیگیری سهمیه ۵ ساعته + هفتگی

مدل‌ها:
  cc/claude-opus-4-7
  cc/claude-opus-4-6
  cc/claude-sonnet-4-6
  cc/claude-haiku-4-5-20251001
```

**نکته حرفه‌ای:** از Opus برای کارهای پیچیده و Sonnet برای سرعت استفاده کنید. 9Router سهمیه را به ازای هر مدل پیگیری می‌کند!

### OpenAI Codex (Plus/Pro)

```bash
داشبورد → ارائه‌دهندگان → اتصال Codex
→ ورود OAuth (پورت ۱۴۵۵)
→ بازنشانی ۵ ساعته + هفتگی

مدل‌ها:
  cx/gpt-5.5
  cx/gpt-5.4
  cx/gpt-5.3-codex
  cx/gpt-5.2-codex
```

### GitHub Copilot

```bash
داشبورد → ارائه‌دهندگان → اتصال GitHub
→ OAuth از طریق GitHub
→ بازنشانی ماهانه (اول ماه)

مدل‌ها:
  gh/gpt-5.4
  gh/claude-opus-4.7
  gh/claude-sonnet-4.6
  gh/gemini-3.1-pro-preview
  gh/grok-code-fast-1
```

### Cursor IDE

```bash
داشبورد → ارائه‌دهندگان → اتصال Cursor
→ ورود OAuth
→ اشتراک ماهانه

مدل‌ها:
  cu/claude-4.6-opus-max
  cu/claude-4.5-sonnet-thinking
  cu/gpt-5.3-codex
```

</details>

<details>
<summary><b>💰 ارائه‌دهندگان ارزان (پشتیبان)</b></summary>

### GLM-5.1 / GLM-4.7 (بازنشانی روزانه، ۰.۶ دلار/میلیون)

۱. ثبت‌نام: [Zhipu AI](https://open.bigmodel.cn/)
۲. دریافت کلید API از Coding Plan
۳. داشبورد → افزودن کلید API:
   - ارائه‌دهنده: `glm`
   - کلید API: `your-key`

**استفاده:** `glm/glm-5.1`، `glm/glm-5`، `glm/glm-4.7`

**نکته حرفه‌ای:** Coding Plan ۳ برابر سهمیه با ۱/۷ هزینه ارائه می‌دهد! بازنشانی روزانه ساعت ۱۰:۰۰ صبح.

### MiniMax M2.7 (بازنشانی ۵ ساعته، ۰.۲۰ دلار/میلیون)

۱. ثبت‌نام: [MiniMax](https://www.minimax.io/)
۲. دریافت کلید API
۳. داشبورد → افزودن کلید API

**استفاده:** `minimax/MiniMax-M2.7`، `minimax/MiniMax-M2.5`

**نکته حرفه‌ای:** ارزان‌ترین گزینه برای زمینه طولانی (۱ میلیون توکن)!

### Kimi K2.5 (۹ دلار/ماه مسطح)

۱. اشتراک: [Moonshot AI](https://platform.moonshot.ai/)
۲. دریافت کلید API
۳. داشبورد → افزودن کلید API

**استفاده:** `kimi/kimi-k2.5`، `kimi/kimi-k2.5-thinking`

**نکته حرفه‌ای:** ۹ دلار/ماه ثابت برای ۱۰ میلیون توکن = هزینه مؤثر ۰.۹۰ دلار/میلیون!

</details>

<details>
<summary><b>🆓 ارائه‌دهندگان رایگان (توصیه شده)</b></summary>

### Kiro AI (Claude 4.5 + GLM-5 + MiniMax رایگان)

```bash
داشبورد → اتصال Kiro
→ AWS Builder ID، AWS IAM Identity Center، Google، یا GitHub
→ استفاده نامحدود

مدل‌ها:
  kr/claude-sonnet-4.5
  kr/claude-haiku-4.5
  kr/glm-5
  kr/MiniMax-M2.5
  kr/qwen3-coder-next
  kr/deepseek-3.2
```

**نکته حرفه‌ای:** بهترین گزینه رایگان برای Claude. بدون کلید API، بدون پرداخت، کاملاً نامحدود.

### OpenCode Free (بدون احراز هویت، دریافت خودکار مدل‌ها)

```bash
داشبورد → اتصال OpenCode Free
→ بدون نیاز به ورود (پروکسی عبوری)
→ مدل‌ها به‌طور خودکار از opencode.ai/zen/v1/models دریافت می‌شوند
```

**نکته حرفه‌ای:** سریع‌ترین راه‌اندازی. فقط متصل شوید و کدنویسی را شروع کنید.

### Vertex AI (۳۰۰ دلار اعتبار رایگان برای حساب‌های جدید GCP)

```bash
داشبورد → اتصال Vertex AI
→ آپلود JSON حساب سرویس Google Cloud
→ فعال‌سازی API Vertex AI در پروژه GCP خود

مدل‌ها:
  vertex/gemini-3.1-pro-preview
  vertex/gemini-3-flash-preview
  vertex/gemini-2.5-flash

Vertex Partner (Anthropic / DeepSeek / GLM / Qwen از طریق Vertex):
  vertex-partner/glm-5-maas
  vertex-partner/deepseek-v3.2-maas
  vertex-partner/qwen3-next-80b-a3b-thinking-maas
```

**نکته حرفه‌ای:** حساب‌های جدید Google Cloud ۳۰۰ دلار اعتبار رایگان به مدت ۹۰ روز دریافت می‌کنند. برای کدنویسی روزانه کافی است.

</details>

<details>
<summary><b>🎨 ایجاد ترکیب‌ها</b></summary>

### مثال ۱: حداکثر اشتراک → پشتیبان ارزان

```
داشبورد → ترکیب‌ها → ایجاد جدید

نام: premium-coding
مدل‌ها:
  1. cc/claude-opus-4-7 (اشتراک اصلی)
  2. glm/glm-5.1 (پشتیبان ارزان، ۰.۶ دلار/میلیون)
  3. minimax/MiniMax-M2.7 (ارزان‌ترین بازگشت، ۰.۲۰ دلار/میلیون)

استفاده در CLI: premium-coding

مثال هزینه ماهانه (۱۰۰ میلیون توکن):
  ۸۰ میلیون از طریق Claude (اشتراک): ۰ دلار اضافی
  ۱۵ میلیون از طریق GLM: ۹ دلار
  ۵ میلیون از طریق MiniMax: ۱ دلار
  کل: ۱۰ دلار + اشتراک شما
```

### مثال ۲: فقط رایگان (هزینه صفر)

```
نام: free-combo
مدل‌ها:
  1. kr/claude-sonnet-4.5 (Claude 4.5 رایگان نامحدود)
  2. kr/glm-5 (GLM-5 رایگان از طریق Kiro)
  3. vertex/gemini-3.1-pro-preview (۳۰۰ دلار اعتبار رایگان)

هزینه: ۰ دلار برای همیشه (+ صرفه‌جویی ۲۰-۴۰٪ توکن با RTK)!
```

</details>

<details>
<summary><b>🔧 یکپارچه‌سازی با CLI</b></summary>

### Cursor IDE

```
تنظیمات → مدل‌ها → پیشرفته:
  آدرس پایه API OpenAI: http://localhost:20128/v1
  کلید API OpenAI: [از داشبورد 9router]
  مدل: cc/claude-opus-4-7
```

یا از ترکیب استفاده کنید: `premium-coding`

### Claude Code

ویرایش `~/.claude/config.json`:

```json
{
  "anthropic_api_base": "http://localhost:20128/v1",
  "anthropic_api_key": "your-9router-api-key"
}
```

### Codex CLI

```bash
export OPENAI_BASE_URL="http://localhost:20128"
export OPENAI_API_KEY="your-9router-api-key"

codex "your prompt"
```

### OpenClaw

**گزینه ۱ — داشبورد (توصیه می‌شود):**

```
داشبورد → ابزارهای CLI → OpenClaw → انتخاب مدل → اعمال
```

**گزینه ۲ — دستی:** ویرایش `~/.openclaw/openclaw.json`:

```json
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "9router/kr/claude-sonnet-4.5"
      }
    }
  },
  "models": {
    "providers": {
      "9router": {
        "baseUrl": "http://127.0.0.1:20128/v1",
        "apiKey": "sk_9router",
        "api": "openai-completions",
        "models": [
          {
            "id": "kr/claude-sonnet-4.5",
            "name": "Claude Sonnet 4.5 (Kiro Free)"
          }
        ]
      }
    }
  }
}
```

> **توجه:** OpenClaw فقط با 9Router محلی کار می‌کند. برای جلوگیری از مشکلات وضوح IPv6 از `127.0.0.1` به جای `localhost` استفاده کنید.

### Cline / Continue / RooCode

```
ارائه‌دهنده: سازگار با OpenAI
آدرس پایه: http://localhost:20128/v1
کلید API: [از داشبورد]
مدل: cc/claude-opus-4-7
```

</details>

<details>
<summary><b>🚀 استقرار</b></summary>

### استقرار در VPS

```bash
# کلون و نصب
git clone https://github.com/decolua/9router.git
cd 9router
npm install
npm run build

# پیکربندی
export JWT_SECRET="your-secure-secret-change-this"
export INITIAL_PASSWORD="your-password"
export DATA_DIR="/var/lib/9router"
export PORT="20128"
export HOSTNAME="0.0.0.0"
export NODE_ENV="production"
export NEXT_PUBLIC_BASE_URL="http://localhost:20128"
export NEXT_PUBLIC_CLOUD_URL="https://9router.com"
export API_KEY_SECRET="endpoint-proxy-api-key-secret"
export MACHINE_ID_SALT="endpoint-proxy-salt"

# شروع
npm run start

# یا استفاده از PM2
npm install -g pm2
pm2 start npm --name 9router -- start
pm2 save
pm2 startup
```

### داکر

تصاویر منتشر شده (چند پلتفرم `linux/amd64` + `linux/arm64`):

- Docker Hub: [`decolua/9router`](https://hub.docker.com/r/decolua/9router)
- GHCR: [`ghcr.io/decolua/9router`](https://github.com/decolua/9router/pkgs/container/9router)

**شروع سریع (استفاده از تصویر منتشر شده):**

```bash
docker run -d \
  --name 9router \
  -p 20128:20128 \
  -v "$HOME/.9router:/app/data" \
  -e DATA_DIR=/app/data \
  decolua/9router:latest
```

→ باز کردن http://localhost:20128

**ساخت از سورس (توسعه):**

```bash
git clone https://github.com/decolua/9router.git
cd 9router/app
docker build -t 9router .
docker run -d --name 9router -p 20128:20128 \
  -v "$HOME/.9router:/app/data" -e DATA_DIR=/app/data 9router
```

**پیش‌فرض‌های کانتینر:**

- `PORT=20128`
- `HOSTNAME=0.0.0.0`

**دستورات مفید:**

```bash
docker logs -f 9router
docker restart 9router
docker stop 9router && docker rm 9router
docker pull decolua/9router:latest   # به‌روزرسانی به آخرین نسخه
```

**ماندگاری داده:** `$HOME/.9router/db/data.sqlite` در میزبان ↔ `/app/data/db/data.sqlite` در کانتینر.

### متغیرهای محیطی

| متغیر                                             | پیش‌فرض                                  | توضیحات                                                                         |
| ---------------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------- |
| `JWT_SECRET`                                         | تولید خودکار (`~/.9router/jwt-secret`) | راز امضای JWT برای کوکی احراز هویت داشبورد (برای اشتراک بین نمونه‌ها بازنویسی کنید)   |
| `INITIAL_PASSWORD`                                   | `123456`                                 | رمز عبور اولین ورود در صورت عدم وجود هش ذخیره شده                                      |
| `DATA_DIR`                                           | `~/.9router`                             | مکان اصلی داده‌های برنامه (SQLite در `$DATA_DIR/db/data.sqlite`)                       |
| `PORT`                                               | پیش‌فرض فریم‌ورک                        | پورت سرویس (`۲۰۱۲۸` در مثال‌ها)                                                  |
| `HOSTNAME`                                           | پیش‌فرض فریم‌ورک                        | هاست بایند (داکر پیش‌فرض `۰.۰.۰.۰` است)                                            |
| `NODE_ENV`                                           | پیش‌فرض زمان اجرا                          | برای استقرار `production` را تنظیم کنید                                                         |
| `BASE_URL`                                           | `http://localhost:20128`                 | آدرس پایه داخلی سمت سرور که توسط کارهای همگام‌سازی ابری استفاده می‌شود                               |
| `CLOUD_URL`                                          | `https://9router.com`                    | آدرس پایه نقطه پایانی همگام‌سازی ابری سمت سرور                                            |
| `NEXT_PUBLIC_BASE_URL`                               | `http://localhost:3000`                  | آدرس پایه عمومی/سازگار با گذشته (برای زمان اجرای سرور `BASE_URL` را ترجیح دهید)          |
| `NEXT_PUBLIC_CLOUD_URL`                              | `https://9router.com`                    | آدرس ابری عمومی/سازگار با گذشته (برای زمان اجرای سرور `CLOUD_URL` را ترجیح دهید)        |
| `API_KEY_SECRET`                                     | `endpoint-proxy-api-key-secret`          | راز HMAC برای کلیدهای API تولید شده                                                  |
| `MACHINE_ID_SALT`                                    | `endpoint-proxy-salt`                    | نمک برای هش کردن شناسه ماشین پایدار                                                  |
| `ENABLE_REQUEST_LOGS`                                | `false`                                  | لاگ‌های درخواست/پاسخ را در `logs/` فعال می‌کند                                         |
| `AUTH_COOKIE_SECURE`                                 | `false`                                  | کوکی احراز هویت `Secure` را اعمال می‌کند (در پشت پروکسی معکوس HTTPS `true` تنظیم کنید)                  |
| `REQUIRE_API_KEY`                                    | `false`                                  | اعمال کلید API Bearer در مسیرهای `/v1/*` (برای استقرارهای در معرض اینترنت توصیه می‌شود) |
| `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY` | خالی                                    | پروکسی خروجی اختیاری برای فراخوانی‌های ارائه‌دهنده بالا دست                                 |
| `SEARXNG_URL`                                        | `http://localhost:8888/search`           | نقطه پایانی برای ارائه‌دهنده جستجوی وب SearXNG ساخته شده بدون احراز هویت                     |

نکات:

- متغیرهای پروکسی با حروف کوچک نیز پشتیبانی می‌شوند: `http_proxy`، `https_proxy`، `all_proxy`، `no_proxy`.
- `.env` در تصویر داکر تعبیه نشده است (`.dockerignore`)؛ پیکربندی زمان اجرا را با `--env-file` یا `-e` تزریق کنید.
- در ویندوز، می‌توان از `APPDATA` برای وضوح مسیر ذخیره‌سازی محلی استفاده کرد.
- `INSTANCE_NAME` در مستندات قدیمی/الگوهای env ظاهر می‌شود، اما در حال حاضر در زمان اجرا استفاده نمی‌شود.

### فایل‌های زمان اجرا و ذخیره‌سازی

- وضعیت اصلی برنامه: `${DATA_DIR}/db/data.sqlite` (SQLite — ارائه‌دهندگان، ترکیب‌ها، نام‌های مستعار، کلیدها، تنظیمات، تاریخچه استفاده)
- پشتیبان‌گیری خودکار: `${DATA_DIR}/db/backups/`
- لاگ‌های اختیاری درخواست/مترجم: `<repo>/logs/...` وقتی `ENABLE_REQUEST_LOGS=true`
- هر دو `${DATA_DIR}` و `~/.9router` در یک کانتینر داکر به یک مکان اشاره می‌کنند — symlink `/root/.9router -> /app/data` در زمان ساخت ایجاد می‌شود.

</details>

---

## 📊 مدل‌های موجود

<details>
<summary><b>مشاهده همه مدل‌های موجود</b></summary>

**Claude Code (`cc/`)** - Pro/Max:

- `cc/claude-opus-4-7`
- `cc/claude-opus-4-6`
- `cc/claude-sonnet-4-6`
- `cc/claude-sonnet-4-5-20250929`
- `cc/claude-haiku-4-5-20251001`

**Codex (`cx/`)** - Plus/Pro:

- `cx/gpt-5.5`
- `cx/gpt-5.4`
- `cx/gpt-5.3-codex`
- `cx/gpt-5.2-codex`
- `cx/gpt-5.1-codex-max`

**GitHub Copilot (`gh/`)**:

- `gh/gpt-5.4`
- `gh/claude-opus-4.7`
- `gh/claude-sonnet-4.6`
- `gh/gemini-3.1-pro-preview`
- `gh/grok-code-fast-1`

**Cursor (`cu/`)** - اشتراک:

- `cu/claude-4.6-opus-max`
- `cu/claude-4.5-sonnet-thinking`
- `cu/gpt-5.3-codex`
- `cu/kimi-k2.5`

**GLM (`glm/`)** - ۰.۶ دلار/میلیون:

- `glm/glm-5.1`
- `glm/glm-5`
- `glm/glm-4.7`

**MiniMax (`minimax/`)** - ۰.۲ دلار/میلیون:

- `minimax/MiniMax-M2.7`
- `minimax/MiniMax-M2.5`

**Kimi (`kimi/`)** - ۹ دلار/ماه مسطح:

- `kimi/kimi-k2.5`
- `kimi/kimi-k2.5-thinking`

**Kiro (`kr/`)** - رایگان نامحدود:

- `kr/claude-sonnet-4.5`
- `kr/claude-haiku-4.5`
- `kr/glm-5`
- `kr/MiniMax-M2.5`
- `kr/qwen3-coder-next`
- `kr/deepseek-3.2`

**OpenCode Free (`oc/`)** - رایگان بدون احراز هویت:

- دریافت خودکار از `opencode.ai/zen/v1/models`

**Vertex AI (`vertex/`)** - ۳۰۰ دلار اعتبار رایگان:

- `vertex/gemini-3.1-pro-preview`
- `vertex/gemini-3-flash-preview`
- `vertex/gemini-2.5-flash`
- `vertex-partner/glm-5-maas`
- `vertex-partner/deepseek-v3.2-maas`

</details>

---

## 🐛 عیب‌یابی

**"مدل زبان پیامی ارائه نکرد"**

- سهمیه ارائه‌دهنده تمام شده → پیگیری سهمیه در داشبورد را بررسی کنید
- راه‌حل: از بازگشت ترکیبی استفاده کنید یا به لایه ارزان‌تر تغییر دهید

**محدودیت نرخ درخواست**

- سهمیه اشتراک تمام شده → بازگشت به GLM/MiniMax
- ترکیب اضافه کنید: `cc/claude-opus-4-7 → glm/glm-5.1 → kr/claude-sonnet-4.5`

**توکن OAuth منقضی شده است**

- توسط 9Router به‌طور خودکار بازسازی می‌شود
- اگر مشکل ادامه داشت: داشبورد → ارائه‌دهنده → اتصال مجدد

**هزینه‌های بالا**

- RTK را در داشبورد → تنظیمات نقطه پایانی فعال کنید (پیش‌فرض روشن است، ۲۰-۴۰٪ توکن صرفه‌جویی می‌کند)
- آمار مصرف را در داشبورد بررسی کنید
- مدل اصلی را به GLM/MiniMax تغییر دهید
- برای کارهای غیر حیاتی از لایه رایگان (Kiro، OpenCode Free، Vertex) استفاده کنید

**داشبورد در پورت اشتباه باز می‌شود**

- `PORT=20128` و `NEXT_PUBLIC_BASE_URL=http://localhost:20128` را تنظیم کنید

**اولین ورود کار نمی‌کند**

- `INITIAL_PASSWORD` را در `.env` بررسی کنید
- در صورت تنظیم نشدن، رمز عبور پیش‌فرض `123456` است

**لاگ‌های درخواست در `logs/` وجود ندارد**

- `ENABLE_REQUEST_LOGS=true` را تنظیم کنید

---

## 🛠️ پشته فنی

- **زمان اجرا**: Node.js 20+
- **فریم‌ورک**: Next.js 16
- **UI**: React 19 + Tailwind CSS 4
- **پایگاه داده**: SQLite (better-sqlite3 / node:sqlite / بازگشت sql.js)
- **پخش جریانی**: رویدادهای ارسال شده از سرور (SSE)
- **احراز هویت**: OAuth 2.0 (PKCE) + JWT + کلیدهای API

---

## 📝 مرجع API

### تکمیل‌های چت

```bash
POST http://localhost:20128/v1/chat/completions
Authorization: Bearer your-api-key
Content-Type: application/json

{
  "model": "cc/claude-opus-4-6",
  "messages": [
    {"role": "user", "content": "Write a function to..."}
  ],
  "stream": true
}
```

### لیست مدل‌ها

```bash
GET http://localhost:20128/v1/models
Authorization: Bearer your-api-key

→ همه مدل‌ها + ترکیب‌ها را در قالب OpenAI برمی‌گرداند
```

## 📧 پشتیبانی

- **وب‌سایت**: [9router.com](https://9router.com)
- **GitHub**: [github.com/decolua/9router](https://github.com/decolua/9router)
- **مسائل**: [github.com/decolua/9router/issues](https://github.com/decolua/9router/issues)

---

## 👥 مشارکت‌کنندگان

با تشکر از همه مشارکت‌کنندگانی که به بهتر شدن 9Router کمک کردند!

[![Contributors](https://contrib.rocks/image?repo=decolua/9router&max=150&columns=15&anon=1&v=20260309)](https://github.com/decolua/9router/graphs/contributors)

---

## 📊 نمودار ستاره

[![Star Chart](https://starchart.cc/decolua/9router.svg?variant=adaptive)](https://starchart.cc/decolua/9router)

## 🔀 فورک‌ها

**[OmniRoute](https://github.com/diegosouzapw/OmniRoute)** — یک فورک کامل TypeScript از 9Router. بیش از ۳۶ ارائه‌دهنده، بازگشت خودکار ۴ لایه، APIهای چندوجهی (تصاویر، جاسازی‌ها، صدا، TTS)، قطع‌کننده مدار، حافظه پنهان معنایی، ارزیابی‌های LLM و داشبوردی زیبا اضافه می‌کند. بیش از ۳۶۸ تست واحد. از طریق npm و داکر در دسترس است.

---

## 🙏 قدردانی

ساخته شده بر روی شانه‌های غول‌ها:

- **[CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)** — پیاده‌سازی اصلی Go که الهام‌بخش این پورت جاوااسکریپت بود.
- **[RTK](https://github.com/rtk-ai/rtk)** ![Stars](https://img.shields.io/github/stars/rtk-ai/rtk?style=flat&color=yellow) — ذخیره‌ساز توکن Rust. 9Router خط لوله فشرده‌سازی آن را به JS منتقل می‌کند → **۲۰-۴۰٪- توکن ورودی** در هر درخواست.
- **[Caveman](https://github.com/JuliusBrussee/caveman)** ![Stars](https://img.shields.io/github/stars/JuliusBrussee/caveman?style=flat&color=yellow) توسط **[@JuliusBrussee](https://github.com/JuliusBrussee)** — پرامپت ویروسی _"چرا از توکن زیاد استفاده کنی وقتی توکن کم کار را انجام می‌دهد"_. 9Router پرامپت آن را تطبیق می‌دهد → **۶۵٪- توکن خروجی**.
- **[Ponytail](https://github.com/DietrichGebert/ponytail)** ![Stars](https://img.shields.io/github/stars/DietrichGebert/ponytail?style=flat&color=yellow) توسط **[@DietrichGebert](https://github.com/DietrichGebert)** — مهارت _"توسعه‌دهنده ارشد تنبل"_. 9Router نردبان YAGNI-first آن را تزریق می‌کند → **توکن کمتر، کد کمتر، دیف‌های کوتاه‌تر**.

تشکر فراوان از این نویسندگان — بدون کار آنها، ویژگی‌های ذخیره‌سازی توکن 9Router وجود نداشت. ⭐ آنها را در GitHub بدهید!

---

## 📄 مجوز

مجوز MIT - برای جزئیات به [LICENSE](LICENSE) مراجعه کنید.

---

<div align="center">
  <sub>ساخته شده با ❤️ برای توسعه‌دهندگانی که ۲۴/۷ کدنویسی می‌کنند</sub>
</div>
