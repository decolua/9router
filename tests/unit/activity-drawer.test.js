import { it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import * as views from '../../src/app/(dashboard)/dashboard/usage/components/RequestDetailsTab.js';
const render = (value, output = false) => renderToStaticMarkup(React.createElement(views.ActivityPayloadView, { value, output }));
it('explains missing and historical truncated payloads without implying empty model output', () => {
 expect(views.ActivityPayloadView).toBeTypeOf('function');
 expect(render(null)).toContain('Not captured');
 expect(render({_truncated:true,_originalSize:941619})).toContain('cannot be recovered');
 expect(render('[Empty streaming response]',true)).toContain('not proof of an empty model response');
 expect(render({_unavailable:true,reason:'Raw SSE not stored'})).toContain('Raw SSE not stored');
});
it('renders tool-only output and clearly labels semantic upstream summaries', () => {
 expect(views.ActivityPayloadView).toBeTypeOf('function');
 const html=render({content:'',thinking:'Synthetic thought',tool_calls:[{id:'c',function:{name:'lookup',arguments:'{}'}}],capture:{kind:'semantic_upstream_summary',truncated:true}},true);
 for(const text of ['Tool calls','lookup','Synthetic thought','Semantic upstream summary','Capture limit reached']) expect(html).toContain(text);
 expect(html).not.toContain('[No content]');
 const source=readFileSync(new URL('../../src/app/(dashboard)/dashboard/usage/components/RequestDetailsTab.js',import.meta.url),'utf8');
 expect(source).toContain('<ActivityPayloadView value={selectedDetail.response} output');
 expect(source).not.toContain('Provider Response (Raw)');
 expect(source).not.toContain('Client Response (Final)');
});
