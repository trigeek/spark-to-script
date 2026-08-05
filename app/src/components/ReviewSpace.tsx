// SPDX-License-Identifier: AGPL-3.0-only

import { Check, ChevronDown, Clipboard, Download, Info } from "lucide-react";

export function ReviewSpace() {
  return (
    <main className="review-space">
      <div className="review-toolbar">
        <button type="button" className="version-selector" disabled>尚无版本 <ChevronDown size={15} /></button>
        <button type="button" className="quiet-button" disabled>版本历史</button>
        <div className="review-toolbar__spacer" />
        <button type="button" className="quiet-button" disabled><Clipboard size={15} />复制 Markdown</button>
        <button type="button" className="quiet-button" disabled><Download size={15} />下载</button>
      </div>
      <div className="review-canvas">
        <article className="review-document runtime-review-empty" aria-label="逐字稿正文">
          <span>终稿审阅</span><h1>还没有可审阅的正式草稿</h1><p>这里只会显示持久化的正式稿件，不会用静态正文冒充 Agent 结果。</p>
        </article>
      </div>
      <div className="review-bottom-bar">
        <div className="review-count"><span>0</span><div><strong>没有待发送批注</strong><small>等待正式稿件版本</small></div></div>
        <p><Info size={14} />Agent 返回提案后，由你决定是否写入新版本</p>
        <button type="button" className="primary-button primary-button--large" disabled><Check size={17} />标记为终稿</button>
      </div>
    </main>
  );
}
