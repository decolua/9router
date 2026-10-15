"use client";

import { useId, useRef, useState } from "react";
import { Button, Input, Select } from "@/shared/components";
import { CUSTOM_JSON_DEFAULTS, CUSTOM_JSON_METHODS } from "open-sse/config/customJson.js";
import { buildCustomJsonTemplate, customJsonForm } from "@/shared/utils/customJsonForm";

export default function CustomJsonFields({ value, onChange }) {
  const id = useId();
  const nextField = useRef(0);
  const [fieldError, setFieldError] = useState("");
  const fields = value.extraFields || [];
  const setFields = (extraFields) => onChange({ ...value, extraFields });
  const editField = (index, patch) => setFields(fields.map((field, i) => i === index ? { ...field, ...patch } : field));
  const changeMode = (templateMode) => {
    setFieldError("");
    try {
      if (templateMode === "json") {
        onChange({ ...value, templateMode, requestTemplateText: JSON.stringify(buildCustomJsonTemplate(fields), null, 2) });
      } else {
        const parsed = JSON.parse(value.requestTemplateText);
        if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error("Request template must be a JSON object");
        const converted = customJsonForm({ ...value, requestTemplate: parsed });
        onChange({ ...converted, templateMode });
      }
    } catch (error) { setFieldError(error.message); }
  };
  const update = (key) => (event) => onChange({ ...value, [key]: event.target.value });
  const textareaClass = "w-full rounded-lg border border-border bg-surface-2 p-3 font-mono text-sm text-text-main focus:outline-none focus:ring-2 focus:ring-brand-500/30";
  return (
    <div className="flex flex-col gap-4">
      <Select label="HTTP Method" value={value.method} onChange={update("method")} options={CUSTOM_JSON_METHODS.map((method) => ({ value: method, label: method }))} />
      <Select label="Authentication" value={value.authType} onChange={update("authType")} options={[
        { value: "bearer", label: "Bearer token" }, { value: "api-key", label: "API key in header" }, { value: "none", label: "None" },
      ]} />
      {value.authType === "api-key" && <Input label="API Key Header" aria-label="API Key Header" value={value.authHeader} onChange={update("authHeader")} placeholder="X-API-Key" />}
      <fieldset className="flex min-w-0 flex-col gap-3">
        <legend className="mb-2 text-sm font-medium">Request JSON Template</legend>
        <div className="flex gap-2">
          <Button size="sm" variant={value.templateMode === "fields" ? "primary" : "ghost"} onClick={() => changeMode("fields")}>字段配置</Button>
          <Button size="sm" variant={value.templateMode === "json" ? "primary" : "ghost"} onClick={() => changeMode("json")}>完整 JSON（高级）</Button>
        </div>
        {value.templateMode === "fields" ? <>
          <p className="text-xs text-text-muted">默认发送 model 和 messages。额外字段可选，不添加也能直接使用。</p>
          <pre aria-label="默认请求模板" className={`${textareaClass} overflow-x-auto`}>{JSON.stringify(CUSTOM_JSON_DEFAULTS.requestTemplate, null, 2)}</pre>
          {fields.map((field, index) => (
            <div key={field.id} className="flex flex-col gap-3 rounded-lg border border-border p-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm">额外字段 {index + 1}（可选）</span>
                <Button size="sm" variant="ghost" onClick={() => setFields(fields.filter((_, i) => i !== index))} aria-label={`删除字段 ${index + 1}`}>删除</Button>
              </div>
              <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
                <Input label="字段名" aria-label={`字段名 ${index + 1}`} value={field.name} placeholder="例如 project_id" onChange={(event) => editField(index, { name: event.target.value })} />
                <Select label="值类型" aria-label={`值类型 ${index + 1}`} value={field.type} onChange={(event) => editField(index, { type: event.target.value })} options={[{ value: "text", label: "文本 / 占位符" }, { value: "json", label: "JSON（数字、布尔、数组或对象）" }]} />
              </div>
              <Input label="字段值" aria-label={`字段值 ${index + 1}`} value={field.value} placeholder="例如 demo-project 或 {{prompt}}" onChange={(event) => editField(index, { value: event.target.value })} />
            </div>
          ))}
          <Button size="sm" variant="secondary" onClick={() => setFields([...fields, { id: `${id}-${nextField.current++}`, name: "", type: "text", value: "" }])}>添加字段</Button>
        </> : <>
          <label htmlFor={`${id}-template`} className="sr-only">Request JSON Template</label>
          <textarea id={`${id}-template`} rows={6} spellCheck={false} value={value.requestTemplateText} onChange={update("requestTemplateText")} className={textareaClass} />
          <p className="text-xs text-text-muted">完整 JSON 模式可调整或移除默认字段。已有的自定义模板保持原样。</p>
        </>}
        {fieldError && <p role="alert" className="text-sm text-red-500">{fieldError}</p>}
        <p className="text-xs text-text-muted">{"支持 {{prompt}}（最新用户文本）、{{messages}}（聊天历史）、{{model}}（模型 ID）和 {{request.field}}。完整占位符会保留数组或对象类型。"}</p>
      </fieldset>
      <Input label="Response Field Path" aria-label="Response Field Path" value={value.responsePath} onChange={update("responsePath")} placeholder="data.answer" hint="Examples: answer, data.answer, results[0].text. Use $ to return the entire JSON value." />
      <details>
        <summary className="cursor-pointer text-sm">Custom Headers</summary>
        <label htmlFor={`${id}-headers`} className="sr-only">Custom Headers JSON</label>
        <textarea id={`${id}-headers`} rows={3} spellCheck={false} value={value.headersText} onChange={update("headersText")} className={`${textareaClass} mt-2`} />
        <p className="text-xs text-text-muted">Store the secret API key in the connection. These headers are saved as provider settings.</p>
      </details>
      <p className="text-xs text-text-muted">The endpoint returns JSON. Streaming clients receive the reply after the complete response arrives. Test sends a real request with “ping” as the prompt.</p>
    </div>
  );
}
