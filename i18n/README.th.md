นี่คือเอกสารแปลภาษาไทยของไฟล์ Markdown ต้นฉบับ โดยรักษาโครงสร้างและซินแท็กซ์ทางเทคนิคทั้งหมดไว้เหมือนเดิม

<div align="center">
  <img src="../images/9router.png?1" alt="แดชบอร์ด 9Router" width="800"/>
  
  # 9Router - Free AI Router
  
  **ไม่ต้องหยุดเขียนโค้ด ประหยัดโทเค็น 20-40% ด้วย RTK + สลับอัตโนมัติไปยังโมเดล AI ฟรีและราคาถูก**
  
  **ผู้ให้บริการ AI ฟรีสำหรับ OpenClaw**
  
  <p align="center">
    <img src="../public/providers/openclaw.png" alt="OpenClaw" width="80"/>
  </p>
  
  [![npm](https://img.shields.io/npm/v/9router.svg)](https://www.npmjs.com/package/9router)
  [![Downloads](https://img.shields.io/npm/dm/9router.svg)](https://www.npmjs.com/package/9router)
  [![License](https://img.shields.io/npm/l/9router.svg)](https://github.com/decolua/9router/blob/main/LICENSE)
  
  [🚀 เริ่มต้นใช้งาน](#-quick-start) • [💡 ฟีเจอร์](#-key-features) • [📖 การตั้งค่า](#-setup-guide) • [🌐 เว็บไซต์](https://9router.com)
</div>

---

## 🤔 ทำไมต้อง 9Router?

**หยุดเสียเงินและเจอขีดจำกัด:**

- ❌ โควตาสมาชิกหมดอายุโดยไม่ได้ใช้ทุกเดือน
- ❌ Rate Limit หยุดคุณระหว่างเขียนโค้ด
- ❌ ค่า API แพง ($20-50/เดือน ต่อผู้ให้บริการแต่ละราย)
- ❌ ต้องสลับผู้ให้บริการด้วยตนเอง

**9Router แก้ปัญหาเหล่านี้:**

- ✅ **ประหยัดโทเค็น RTK** - บีบอัดผลลัพธ์จากเครื่องมือ (`git diff`, `grep`, `ls`...) ก่อนส่งให้ LLM
- ✅ **เพิ่มประสิทธิภาพสมาชิก** - ติดตามโควตา ใช้ทุกบิตก่อนรีเซ็ต
- ✅ **สลับอัตโนมัติ** - สมาชิก → ถูก → ฟรี, ไม่มีเวลาหยุดทำงาน
- ✅ **รองรับหลายบัญชี** - Round-robin ระหว่างบัญชีของผู้ให้บริการแต่ละราย
- ✅ **ใช้งานได้ทุกที่** - ใช้ได้กับ Claude Code, Codex, Cursor, Cline, เครื่องมือ CLI ใดก็ได้

---

## 🔄 วิธีการทำงาน

```
┌─────────────┐
│  Your CLI   │  (Claude Code, Codex, OpenClaw, Cursor, Cline...)
│   Tool      │
└──────┬──────┘
       │ http://localhost:20128/v1
       ↓
┌─────────────────────────────────────────────┐
│           9Router (Smart Router)            │
│  • RTK Token Saver (ตัดโทเค็น tool_result) │
│  • แปลงรูปแบบ (OpenAI ↔ Claude)           │
│  • ติดตามโควตา                              │
│  • รีเฟรชโทเค็นอัตโนมัติ                     │
└──────┬──────────────────────────────────────┘
       │
       ├─→ [Tier 1: สมาชิก] Claude Code, Codex, GitHub Copilot
       │   ↓ โควตาหมด
       ├─→ [Tier 2: ถูก] GLM ($0.6/1M), MiniMax ($0.2/1M)
       │   ↓ งบหมด
       └─→ [Tier 3: ฟรี] Kiro, OpenCode Free, Vertex ($300 เครดิตฟรี)

ผลลัพธ์: ไม่ต้องหยุดเขียนโค้ด ค่าใช้จ่ายน้อยที่สุด + ประหยัดโทเค็น 20-40% ด้วย RTK
```

---

## ⚡ เริ่มต้นใช้งาน

**1. ติดตั้งแบบ Global:**

```bash
npm install -g 9router
9router
```

🎉 เปิดแดชบอร์ดที่ `http://localhost:20128`

**2. เชื่อมต่อผู้ให้บริการฟรี (ไม่ต้องสมัคร):**

แดชบอร์ด → Providers → เชื่อมต่อ **Kiro AI** (Claude ฟรีไม่จำกัด) หรือ **OpenCode Free** (ไม่ต้องยืนยันตัวตน) → เสร็จ!

**3. ใช้ในเครื่องมือ CLI ของคุณ:**

```
ตั้งค่า Claude Code/Codex/OpenClaw/Cursor/Cline:
  Endpoint: http://localhost:20128/v1
  API Key: [คัดลอกจากแดชบอร์ด]
  Model: kr/claude-sonnet-4.5
```

**เสร็จแล้ว!** เริ่มเขียนโค้ดด้วยโมเดล AI ฟรี

**วิธีอื่น: รันจากซอร์สโค้ด (เก็บรักษาไว้ใน repo นี้):**

Repo นี้เป็น private package (`9router-app`) ดังนั้นการรันจากซอร์ส/Docker คือเส้นทางพัฒนาท้องถิ่นที่คาดไว้

```bash
cp .env.example .env
npm install
PORT=20128 NEXT_PUBLIC_BASE_URL=http://localhost:20128 npm run dev
```

โหมด Production:

```bash
npm run build
PORT=20128 HOSTNAME=0.0.0.0 NEXT_PUBLIC_BASE_URL=http://localhost:20128 npm run start
```

URL ค่าเริ่มต้น:
- แดชบอร์ด: `http://localhost:20128/dashboard`
- OpenAI-compatible API: `http://localhost:20128/v1`

---

## 🛠️ เครื่องมือ CLI ที่รองรับ

9Router ทำงานได้อย่างราบรื่นกับเครื่องมือเขียนโค้ด AI ทุกประเภท:

<div align="center">
  <table>
    <tr>
      <td align="center" width="120">
        <img src="../public/providers/claude.png" width="60" alt="Claude Code"/><br/>
        <b>Claude-Code</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/openclaw.png" width="60" alt="OpenClaw"/><br/>
        <b>OpenClaw</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/codex.png" width="60" alt="Codex"/><br/>
        <b>Codex</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/opencode.png" width="60" alt="OpenCode"/><br/>
        <b>OpenCode</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/cursor.png" width="60" alt="Cursor"/><br/>
        <b>Cursor</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/antigravity.png" width="60" alt="Antigravity"/><br/>
        <b>Antigravity</b>
      </td>
    </tr>
    <tr>
      <td align="center" width="120">
        <img src="../public/providers/cline.png" width="60" alt="Cline"/><br/>
        <b>Cline</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/continue.png" width="60" alt="Continue"/><br/>
        <b>Continue</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/droid.png" width="60" alt="Droid"/><br/>
        <b>Droid</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/roo.png" width="60" alt="Roo"/><br/>
        <b>Roo</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/copilot.png" width="60" alt="Copilot"/><br/>
        <b>Copilot</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/kilocode.png" width="60" alt="Kilo Code"/><br/>
        <b>Kilo Code</b>
      </td>
    </tr>
  </table>
</div>

---

## ผู้ให้บริการที่รองรับ

### 🔐 ผู้ให้บริการ OAuth

<div align="center">
  <table>
    <tr>
      <td align="center" width="120">
        <img src="../public/providers/claude.png" width="60" alt="Claude Code"/><br/>
        <b>Claude-Code</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/antigravity.png" width="60" alt="Antigravity"/><br/>
        <b>Antigravity</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/codex.png" width="60" alt="Codex"/><br/>
        <b>Codex</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/github.png" width="60" alt="GitHub"/><br/>
        <b>GitHub</b>
      </td>
      <td align="center" width="120">
        <img src="../public/providers/cursor.png" width="60" alt="Cursor"/><br/>
        <b>Cursor</b>
      </td>
    </tr>
  </table>
</div>

### 🆓 ผู้ให้บริการฟรี

<div align="center">
  <table>
    <tr>
      <td align="center" width="150">
        <img src="../public/providers/kiro.png" width="70" alt="Kiro"/><br/>
        <b>Kiro AI</b><br/>
        <sub>Claude 4.5 + GLM-5 + MiniMax • ไม่จำกัด ฟรี</sub>
      </td>
      <td align="center" width="150">
        <img src="../public/providers/opencode.png" width="70" alt="OpenCode"/><br/>
        <b>OpenCode Free</b><br/>
        <sub>ไม่ต้องยืนยันตัวตน • ดึงโมเดลอัตโนมัติ • ไม่จำกัด ฟรี</sub>
      </td>
      <td align="center" width="150">
        <img src="../public/providers/gemini.png" width="70" alt="Vertex AI"/><br/>
        <b>Vertex AI</b><br/>
        <sub>Gemini 3 Pro + GLM-5 + DeepSeek • เครดิตฟรี $300</sub>
      </td>
    </tr>
  </table>
</div>

> **หมายเหตุ:** iFlow, Qwen และ Gemini CLI หยุดให้บริการในปี 2026 แล้ว ใช้ Kiro / OpenCode Free / Vertex แทน

### 🔑 ผู้ให้บริการ API Key (40+)

<div align="center">
  <table>
    <tr>
      <td align="center" width="100">
        <img src="../public/providers/openrouter.png" width="50" alt="OpenRouter"/><br/>
        <sub>OpenRouter</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/glm.png" width="50" alt="GLM"/><br/>
        <sub>GLM</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/kimi.png" width="50" alt="Kimi"/><br/>
        <sub>Kimi</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/minimax.png" width="50" alt="MiniMax"/><br/>
        <sub>MiniMax</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/openai.png" width="50" alt="OpenAI"/><br/>
        <sub>OpenAI</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/anthropic.png" width="50" alt="Anthropic"/><br/>
        <sub>Anthropic</sub>
      </td>
    </tr>
    <tr>
      <td align="center" width="100">
        <img src="../public/providers/gemini.png" width="50" alt="Gemini"/><br/>
        <sub>Gemini</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/deepseek.png" width="50" alt="DeepSeek"/><br/>
        <sub>DeepSeek</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/groq.png" width="50" alt="Groq"/><br/>
        <sub>Groq</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/xai.png" width="50" alt="xAI"/><br/>
        <sub>xAI</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/mistral.png" width="50" alt="Mistral"/><br/>
        <sub>Mistral</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/perplexity.png" width="50" alt="Perplexity"/><br/>
        <sub>Perplexity</sub>
      </td>
    </tr>
    <tr>
      <td align="center" width="100">
        <img src="../public/providers/together.png" width="50" alt="Together"/><br/>
        <sub>Together AI</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/fireworks.png" width="50" alt="Fireworks"/><br/>
        <sub>Fireworks</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/cerebras.png" width="50" alt="Cerebras"/><br/>
        <sub>Cerebras</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/cohere.png" width="50" alt="Cohere"/><br/>
        <sub>Cohere</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/nvidia.png" width="50" alt="NVIDIA"/><br/>
        <sub>NVIDIA</sub>
      </td>
      <td align="center" width="100">
        <img src="../public/providers/siliconflow.png" width="50" alt="SiliconFlow"/><br/>
        <sub>SiliconFlow</sub>
      </td>
    </tr>
  </table>
  <p><i>...และผู้ให้บริการอีกกว่า 20 ราย รวมถึง Nebius, Chutes, Hyperbolic และ OpenAI/Anthropic compatible endpoints แบบกำหนดเอง</i></p>
</div>

---

## 💡 ฟีเจอร์หลัก

| ฟีเจอร์ | ทำอะไร | ทำไมถึงสำคัญ |
|---------|--------------|----------------|
| 🚀 **RTK Token Saver** ([RTK](https://github.com/rtk-ai/rtk) ⭐40K) | บีบอัดผลลัพธ์จากเครื่องมือ (`git diff`, `grep`, `ls`, `tree`...) ก่อนส่งให้ LLM | ประหยัด **โทเค็น input 20-40%** ต่อคำขอ |
| 🧠 **Headroom Token Saver** ([Headroom](https://github.com/chopratejas/headroom)) | พร็อกซี `/v1/compress` ภายนอกก่อนเลือกผู้ให้บริการ | ประหยัดโทเค็นบริบทมากขึ้นโดยไม่ต้องเปลี่ยน client |
| 🪨 **Caveman Mode** ([Caveman](https://github.com/JuliusBrussee/caveman) ⭐52K) | ฉีด caveman-speak prompt → LLM ตอบสั้นกระชับ เนื้อหาทางเทคนิคยังครบถ้วน | ประหยัด **โทเค็น output สูงสุด 65%** |
| 🐴 **Ponytail** ([Ponytail](https://github.com/DietrichGebert/ponytail)) | ฉีด prompt "lazy senior dev" → LLM เขียนโค้ดน้อยที่สุด YAGNI-first (Lite/Full/Ultra) | **โทเค็น output น้อยลง, ไม่ต้อง refactor มาก** |
| 🎯 **Smart 3-Tier Fallback** | เลือกเส้นทางอัตโนมัติ: สมาชิก → ถูก → ฟรี | ไม่ต้องหยุดเขียนโค้ด, ไม่มีเวลาหยุดทำงาน |
| 📊 **ติดตามโควตาแบบ Real-Time** | นับโทเค็นแบบ live + นับถอยหลังรีเซ็ต | เพิ่มประสิทธิภาพมูลค่าสมาชิก |
| 🔄 **แปลงรูปแบบ** | OpenAI ↔ Claude ↔ Gemini ↔ Cursor ↔ Kiro ↔ Vertex | ใช้ได้กับเครื่องมือ CLI ทุกประเภท |
| 👥 **รองรับหลายบัญชี** | หลายบัญชีต่อผู้ให้บริการ | Load balancing + สำรองข้อมูล |
| 🔄 **รีเฟรชโทเค็นอัตโนมัติ** | OAuth token รีเฟรชอัตโนมัติ | ไม่ต้องล็อกอินซ้ำด้วยตนเอง |
| 🎨 **Combo กำหนดเอง** | สร้างการผสมผสานโมเดลไม่จำกัด | ปรับแต่ง fallback ตามความต้องการ |
| 📝 **บันทึก Request** | โหมด debug พร้อม log request/response ครบถ้วน | แก้ไขปัญหาได้ง่าย |
| 💾 **ซิงค์คลาวด์** | ซิงค์การตั้งค่าระหว่างอุปกรณ์ | การตั้งค่าเดียวกันทุกที่ |
| 📊 **วิเคราะห์การใช้งาน** | ติดตามโทเค็น, ค่าใช้จ่าย, แนวโน้มตามเวลา | ปรับแต่งค่าใช้จ่าย |
| 🌐 **Deploy ได้ทุกที่** | Localhost, VPS, Docker, Cloudflare Workers | ตัวเลือก deploy ที่ยืดหยุ่น |

<details>
<summary><b>📖 รายละเอียดฟีเจอร์</b></summary>

### 🚀 RTK Token Saver

ผลลัพธ์จากเครื่องมือ (`git diff`, `grep`, `find`, `ls`, `tree`, log dumps...) มักกินงบประมาณ prompt 30-50% RTK ตรวจสอบและบีบอัดอย่างชาญฉลาดแบบ lossless **ก่อน**คำขอถึง LLM:

- **ตัวกรอง:** `git-diff`, `git-status`, `grep`, `find`, `ls`, `tree`, `dedup-log`, `smart-truncate`, `read-numbered`, `search-list`
- **ตรวจจับอัตโนมัติ:** ไม่ต้องตั้งค่า — RTK .peek 1KB แรกของแต่ละ `tool_result` และเลือกตัวกรองที่ถูกต้อง
- **ปลอดภัยโดยการออกแบบ:** ถ้าตัวกรองล้มเหลว, ขว้าง error, หรือทำให้ผลลัพธ์ใหญ่ขึ้น RTK จะเก็บข้อความต้นฉบับไว้โดยเงียบๆ ไม่มี error ทำให้คำขอของคุณล้มเหลว
- **ใช้ได้ทุกที่:** ใช้ได้กับทุกรูปแบบ (OpenAI, Claude, Gemini, Cursor, Kiro, OpenAI Responses) เพราะทำงาน **ก่อน**การแปลงรูปแบบใดๆ
- **เปิดใช้งานเป็นค่าเริ่มต้น:** ปิด/เปิดได้ตลอดเวลาใน แดชบอร์ด → ตั้งค่า Endpoint

```
ไม่ใช้ RTK: ส่ง 47K โทเค็นให้ LLM
ใช้ RTK:    ส่ง 28K โทเค็นให้ LLM   (ประหยัด 40% · บริบทเดียวกัน · คำตอบเดียวกัน)
```

### 🧠 Headroom Token Saver

Headroom เป็นตัวเลือกและทำงานแยกกัน 9Router เรียก endpoint `/v1/compress` ของ Headroom จากนั้นยังคงเลือกเส้นทาง, fallback, auth และติดตามการใช้งานตามปกติ:

```
Client → 9Router → Headroom /v1/compress → 9Router → provider
```

ตั้งค่าท้องถิ่น:

```bash
pip install "headroom-ai[proxy]"
headroom proxy --port 8787
```

เปิดใช้งานใน แดชบอร์ด → Endpoint → Token Saver → Headroom URL ค่าเริ่มต้น: `http://localhost:8787`

ตัวอย่าง Docker:

```bash
# Headroom service ใน Docker network เดียวกัน
http://host.docker.internal:8787
```

ถ้า Headroom ดับหรือคืน error, 9Router จะ fail open และส่งคำขอต้นฉบับ

### 🐴 Ponytail (Lazy Senior Dev)

Ponytail ฉีด prompt *"lazy senior dev"* เข้าไปในทุกคำขอ ทำให้ LLM เขียนโค้ดน้อยที่สุดแบบ YAGNI-first — ลบมากกว่าเพิ่ม, stdlib มากกว่า dep ใหม่, one-liner มากกว่า abstraction

- **Lite** — สร้างตามที่ขอ, บอกชื่อทางเลือกที่ lazy กว่า
- **Full** — บังคับ YAGNI ladder: stdlib → native → existing deps → one-liner → minimal code
- **Ultra** — YAGNI extremist: ลบก่อน, ส่ง one-liner, ตั้งคำถามกับ requirement ที่เหลือในคำตอบเดียวกัน

```
ไม่ใช้ Ponytail: โค้ดเยอะ, abstraction เยอะ, "เผื่อไว้" scaffolding
ใช้ Ponytail:    diff สั้นที่สุดที่ทำงานได้, ไม่เพิ่ม abstraction ที่ไม่ได้ขอ, โทเค็นน้อยลง
```

ไม่มีวันแลก: input validation, error handling ที่ป้องกัน data loss, security, accessibility หรือสิ่งที่ขอมาอย่างชัดเจน เปิดใช้งานใน แดชบอร์ด → Endpoint → Ponytail ใช้คู่กับ Caveman (ความกระชับ output) และ RTK (การบีบอัด input) ได้

### 🎯 Smart 3-Tier Fallback

สร้าง combo พร้อม fallback อัตโนมัติ:

```
Combo: "my-coding-stack"
  1. cc/claude-opus-4-6        (สมาชิกของคุณ)
  2. glm/glm-4.7               (สำรองราคาถูก, $0.6/1M)
  3. if/kimi-k2-thinking       (fallback ฟรี)

→ สลับอัตโนมัติเมื่อโควตาหมดหรือเกิด error
```

### 📊 ติดตามโควตาแบบ Real-Time

- การใช้โทเค็นต่อผู้ให้บริการ
- นับถอยหลังรีเซ็ต (5 ชั่วโมง, รายวัน, รายสัปดาห์)
- ประมาณการค่าใช้จ่ายสำหรับชั้นแบบเสียค่าใช้จ่าย
- รายงานค่าใช้จ่ายรายเดือน

### 🔄 แปลงรูปแบบ

แปลงรูปแบบได้อย่างราบรื่น:
- **OpenAI** ↔ **Claude** ↔ **Gemini** ↔ **Cursor** ↔ **Kiro** ↔ **Vertex** ↔ **Antigravity** ↔ **Ollama** ↔ **OpenAI Responses**
- เครื่องมือ CLI ของคุณส่งรูปแบบ OpenAI → 9Router แปลง → ผู้ให้บริการได้รับรูปแบบต้นฉบับ
- ใช้ได้กับเครื่องมือใดก็ได้ที่รองรับ custom OpenAI endpoints

### 👥 รองรับหลายบัญชี

- เพิ่มหลายบัญชีสำหรับผู้ให้บริการแต่ละราย
- เลือกเส้นทาง round-robin หรือตามลำดับความสำคัญอัตโนมัติ
- Fallback ไปยังบัญชีถัดไปเมื่อบัญชีหนึ่งชนโควตา

### 🔄 รีเฟรชโทเค็นอัตโนมัติ

- OAuth token รีเฟรชอัตโนมัติก่อนหมดอายุ
- ไม่ต้องยืนยันตัวตนใหม่ด้วยตนเอง
- ประสบการณ์ที่ราบรื่นบนผู้ให้บริการทุกราย

### 🎨 Combo กำหนดเอง

- สร้างการผสมผสานโมเดลไม่จำกัด
- ผสมชั้นสมาชิก, ราคาถูกและฟรี
- ตั้งชื่อ combo เพื่อเข้าถึงง่าย
- แชร์ combo ระหว่างอุปกรณ์ด้วยการซิงค์คลาวด์

### 📝 บันทึก Request

- เปิดโหมด debug เพื่อดู log request/response ครบถ้วน
- ติดตาม API calls, headers และ payloads
- แก้ไขปัญหาการเชื่อมต่อ
- Export log เพื่อวิเคราะห์

### 💾 ซิงค์คลาวด์

- ซิงค์ผู้ให้บริการ, combo และการตั้งค่าระหว่างอุปกรณ์
- ซิงค์เบื้องหลังอัตโนมัติ
- จัดเก็บข้อมูลแบบเข้ารหัสปลอดภัย
- เข้าถึงการตั้งค่าของคุณจากทุกที่

### 📊 วิเคราะห์การใช้งาน

- ติดตามการใช้โทเค็นตามผู้ให้บริการและโมเดล
- ประมาณการค่าใช้จ่ายและแนวโน้มค่าใช้จ่าย
- รายงานและข้อมูลเชิงลึกรายเดือน
- ปรับแต่งค่าใช้จ่าย AI ของคุณ

### 🌐 Deploy ได้ทุกที่

- 💻 **Localhost** - ค่าเริ่มต้น, ทำงานออฟไลน์
- ☁️ **VPS/Cloud** - แชร์ระหว่างอุปกรณ์
- 🐳 **Docker** - Deploy ด้วยคำสั่งเดียว
- 🚀 **Cloudflare Workers** - เครือข่าย edge ทั่วโลก

</details>

---

## 💰 สรุปราคา

| ประเภท | ผู้ให้บริการ | ค่าใช้จ่าย | รีเซ็ตโควตา | ดีที่สุดสำหรับ |
|------|----------|------|-------------|----------|
| **💳 สมาชิก** | Claude Code (Pro) | $20/เดือน | 5 ชม. + รายสัปดาห์ | มีสมาชิกอยู่แล้ว |
| | Codex (Plus/Pro) | $20-200/เดือน | 5 ชม. + รายสัปดาห์ | ผู้ใช้ OpenAI |
| | GitHub Copilot | $10-19/เดือน | รายเดือน | ผู้ใช้ GitHub |
| **💰 ราคาถูก** | GLM-4.7 | $0.6/1M | ทุกวัน 10:00 AM | สำรองงบ |
| | MiniMax M2.1 | $0.2/1M | 5 ชั่วโมง | ถูกที่สุด |
| | Kimi K2 | $9/เดือน คงที่ | 10M โทเค็น/เดือน | ค่าใช้จ่ายที่คาดเดาได้ |
| **🆓 ฟรี** | Kiro | $0 | ไม่จำกัด | Claude ฟรี |
| | OpenCode Free | $0 | ไม่จำกัด | ไม่ต้องยืนยันตัวตน |
| | Vertex AI | $0 | $300 เครดิตฟรี | Gemini 3 Pro |

**💡 เคล็ดลับ:** เริ่มจาก combo Kiro (Claude ฟรีไม่จำกัด) + OpenCode Free (ไม่ต้องยืนยันตัวตน) = ค่าใช้จ่าย $0!

---

## 🎯 กรณีการใช้งาน

### กรณีที่ 1: "ฉันมีสมาชิก Claude Pro"

**ปัญหา:** โควตาหมดอายุโดยไม่ได้ใช้, Rate Limit ตอนเขียนโค้ดหนัก

**วิธีแก้:**
```
Combo: "maximize-claude"
  1. cc/claude-opus-4-6        (ใช้สมาชิกเต็มที่)
  2. glm/glm-4.7               (สำรองราคาถูกเมื่อโควตาหมด)
  3. kr/claude-sonnet-4.5       (fallback ฉุกเฉินฟรี)

ค่าใช้จ่ายรายเดือน: $20 (สมาชิก) + ~$5 (สำรอง) = $25 รวม
เทียบกับ $20 + ชนโควตา = ผิดหวัง
```

### กรณีที่ 2: "ฉันต้องการค่าใช้จ่ายเป็นศูนย์"

**ปัญหา:** ไม่มีงบจ่ายสมาชิก, ต้องการ AI เขียนโค้ดที่เชื่อถือได้

**วิธีแก้:**
```
Combo: "free-forever"
  1. kr/claude-sonnet-4.5       (Claude ฟรีไม่จำกัด)
  2. oc/*                       (OpenCode Free ไม่ต้องยืนยันตัวตน)
  3. vertex/gemini-3.1-pro-preview (Vertex $300 เครดิตฟรี)

ค่าใช้จ่ายรายเดือน: $0
คุณภาพ: โมเดลพร้อมใช้งาน production
```

### กรณีที่ 3: "ฉันต้องเขียนโค้ด 24/7 ไม่มีสะดุด"

**ปัญหา:** Deadline, ไม่สามารถหยุดทำงานได้

**วิธีแก้:**
```
Combo: "always-on"
  1. cc/claude-opus-4-6        (คุณภาพดีที่สุด)
  2. cx/gpt-5.5                (สมาชิกที่สอง)
  3. glm/glm-5.1               (ราคาถูก, รีเซ็ตทุกวัน)
  4. minimax/MiniMax-M2.7      (ถูกที่สุด, รีเซ็ต 5 ชม.)
  5. kr/claude-sonnet-4.5       (ฟรีไม่จำกัด)

ผลลัพธ์: 5 ชั้น fallback = ไม่มีเวลาหยุดทำงาน
ค่าใช้จ่ายเดือน: $20-200 (สมาชิก) + $10-20 (สำรอง)
```

### กรณีที่ 4: "ฉันต้องการ AI ฟรีใน OpenClaw"

**ปัญหา:** ต้องการ AI assistant ในแอปพลิเคชันแชท (WhatsApp, Telegram, Slack...), ฟรีทั้งหมด

**วิธีแก้:**
```
Combo: "openclaw-free"
  1. kr/claude-sonnet-4.5       (Claude ฟรีไม่จำกัด)
  2. kr/glm-5                   (GLM ฟรีไม่จำกัด)
  3. kr/MiniMax-M2.5            (MiniMax ฟรีไม่จำกัด)

ค่าใช้จ่ายรายเดือน: $0
เข้าถึงผ่าน: WhatsApp, Telegram, Slack, Discord, iMessage, Signal...
```

---

## ❓ คำถามที่พบบ่อย

<details>
<summary><b>💳 9Router เก็บเงินฉันหรือไม่?</b></summary>

**ไม่.** 9Router เป็นซอฟต์แวร์ฟรีแบบ open source ที่ทำงานบนเครื่องของคุณเอง มันไม่มีวันเรียกเก็บเงินจากคุณ

**คุณจ่ายเงินเฉพาะ:**
- ✅ **ผู้ให้บริการสมาชิก** (Claude Code $20/เดือน, Codex $20-200/เดือน) → จ่ายตรงให้พวกเขาบนเว็บไซต์ของพวกเขา
- ✅ **ผู้ให้บริการราคาถูก** (GLM, MiniMax) → จ่ายตรงให้พวกเขา, 9Router แค่เลือกเส้นทางคำขอของคุณ
- ❌ **ตัว 9Router เอง** → **ไม่มีวันเรียกเก็บเงินใดๆ ทั้งสิ้น**

9Router เป็น proxy/router ท้องถิ่น มันไม่มีบัตรเครดิตของคุณ, ไม่สามารถส่งใบแจ้งหนี้ได้ และไม่มีระบบชำระเงิน เป็นซอฟต์แวร์ฟรีทั้งหมด

</details>

<details>
<summary><b>🆓 ผู้ให้บริการฟรีไม่จำกัดจริงหรือ?</b></summary>

**จริง!** ผู้ให้บริการที่ระบุว่าฟรี (Kiro, OpenCode Free, Vertex) ไม่จำกัดจริงๆ **ไม่มีค่าใช้จ่ายแอบแฝง**

นี่คือบริการฟรีที่บริษัทต่างๆ ให้บริการ:
- **Kiro**: Claude ฟรีไม่จำกัดผ่าน AWS Builder ID
- **OpenCode Free**: ไม่ต้องยืนยันตัวตน, ดึงโมเดลอัตโนมัติ
- **Vertex AI**: $300 เครดิตฟรีสำหรับ Gemini 3 Pro

9Router แค่เลือกเส้นทางคำขอของคุณไปหาพวกเขา — ไม่มี "กับดัก" หรือการเรียกเก็บเงินในอนาคต เป็นบริการที่ฟรีจริงๆ และ 9Router ทำให้ใช้งานง่ายด้วยการรองรับ fallback

</details>

<details>
<summary><b>💰 ทำอย่างไรเพื่อลดค่าใช้จ่าย AI จริงของฉัน?</b></summary>

**กลยุทธ์ Free First:**

1. **เริ่มจาก combo ฟรี 100%:**
   ```
   1. kr/claude-sonnet-4.5 (Claude ฟรีไม่จำกัด)
   2. oc/* (OpenCode Free ไม่ต้องยืนยันตัวตน)
   3. vertex/gemini-3.1-pro-preview ($300 เครดิตฟรี)
   ```
   **ค่าใช้จ่าย: $0/เดือน**

2. **เพิ่มสำรองราคาถูก** เมื่อจำเป็นเท่านั้น:
   ```
   4. glm/glm-5.1 ($0.6/1M โทเค็น)
   ```
   **ค่าใช้จ่ายเพิ่มเติม:** จ่ายเฉพาะที่ใช้

3. **ใช้ผู้ให้บริการสมาชิก** ก็ต่อเมื่อมีอยู่แล้ว:
   - 9Router ช่วยเพิ่มประสิทธิภาพมูลค่าของพวกเขาผ่านการติดตามโควตา

**ผลลัพธ์:** ผู้ใช้ส่วนใหญ่สามารถทำงานที่ $0/เดือน โดยใช้เฉพาะชั้นฟรี!

</details>

---

## 🐛 การแก้ไขปัญหา

**"Language model did not provide messages"**
- โควตาผู้ให้บริการหมด → ตรวจสอบตัวติดตามโควตาในแดชบอร์ด
- วิธีแก้: ใช้ combo fallback หรือสลับไปชั้นที่ถูกกว่า

**Rate Limiting**
- สมาชิกหมดโควตา → Fallback ไป GLM/MiniMax
- เพิ่ม combo: `cc/claude-opus-4-6 → glm/glm-5.1 → kr/claude-sonnet-4.5`

**OAuth Token หมดอายุ**
- รีเฟรชอัตโนมัติโดย 9Router
- ถ้าปัญหายังคงอยู่: แดชบอร์ด → ผู้ให้บริการ → เชื่อมต่อใหม่

**ค่าใช้จ่ายสูง**
- เปิดใช้ RTK ใน แดชบอร์ด → ตั้งค่า Endpoint (เปิดเป็นค่าเริ่มต้น, ประหยัด 20-40% โทเค็น)
- ตรวจสอบสถิติการใช้งานในแดชบอร์ด
- สลับโมเดลหลักไป GLM/MiniMax
- ใช้ชั้นฟรี (Kiro, OpenCode Free, Vertex) สำหรับงานที่ไม่สำคัญ

**แดชบอร์ดเปิดผิดพอร์ต**
- ตั้ง `PORT=20128` และ `NEXT_PUBLIC_BASE_URL=http://localhost:20128`

**ล็อกอินครั้งแรกไม่ทำงาน**
- ตรวจสอบ `INITIAL_PASSWORD` ใน `.env`
- ถ้ายังไม่ตั้งค่า รหัสผ่านสำรองคือ `123456`

**ไม่มี request log ใต้ `logs/`**
- ตั้ง `ENABLE_REQUEST_LOGS=true`

---

## 🛠️ Tech Stack

- **Runtime**: Node.js 20+
- **Framework**: Next.js 16
- **UI**: React 19 + Tailwind CSS 4
- **Database**: SQLite (better-sqlite3 / node:sqlite / sql.js fallback)
- **Streaming**: Server-Sent Events (SSE)
- **Auth**: OAuth 2.0 (PKCE) + JWT + API Keys

---

## 📝 API Reference

### Chat Completions

```bash
POST http://localhost:20128/v1/chat/completions
Authorization: Bearer your-api-key
Content-Type: application/json

{
  "model": "cc/claude-opus-4-6",
  "messages": [
    {"role": "user", "content": "เขียนฟังก์ชันเพื่อ..."}
  ],
  "stream": true
}
```

### List Models

```bash
GET http://localhost:20128/v1/models
Authorization: Bearer your-api-key

→ คืนค่าโมเดลทั้งหมด + combo ในรูปแบบ OpenAI
```

---

## 📧 สนับสนุน

- **เว็บไซต์**: [9router.com](https://9router.com)
- **GitHub**: [github.com/decolua/9router](https://github.com/decolua/9router)
- **Issues**: [github.com/decolua/9router/issues](https://github.com/decolua/9router/issues)

---

## 👥 ผู้มีส่วนร่วม

ขอขอบคุณผู้มีส่วนร่วมทุกคนที่ช่วยทำให้ 9Router ดียิ่งขึ้น!

[![Contributors](https://contrib.rocks/image?repo=decolua/9router&max=150&columns=15&anon=1)](https://github.com/decolua/9router/graphs/contributors)

---

## 📄 ลิขสิทธิ์

MIT License - ดู [LICENSE](../LICENSE) สำหรับรายละเอียด

---

<div align="center">
  <sub>สร้างด้วย ❤️ สำหรับนักพัฒนาที่เขียนโค้ด 24/7</sub>
</div>
