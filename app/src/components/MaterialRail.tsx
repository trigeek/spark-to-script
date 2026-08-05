// SPDX-License-Identifier: AGPL-3.0-only

import { ChevronLeft, ChevronRight, CircleAlert, Database, Plus } from "lucide-react";
import { useState } from "react";
import { IconButton } from "./ui";

export function MaterialRail() {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <aside className={`material-rail ${collapsed ? "is-collapsed" : ""}`} aria-label="创作材料">
      <div className="material-rail__heading">
        {!collapsed ? <div><strong>创作材料</strong><span>0 份</span></div> : null}
        <IconButton label={collapsed ? "展开材料" : "收起材料"} onClick={() => setCollapsed(!collapsed)}>{collapsed ? <ChevronRight size={17} /> : <ChevronLeft size={17} />}</IconButton>
      </div>
      {!collapsed ? (
        <>
          <div className="material-rail__scroll">
            <section className="material-group">
              <div className="material-group__title"><span>AI 搜索的材料</span><span>0</span></div>
              <div className="material-empty runtime-material-empty"><Database size={15} /><span>真实搜索尚未接入<br /><small>这里不会显示示例来源</small></span></div>
            </section>
            <section className="material-group">
              <div className="material-group__title"><span>我添加的材料</span><span>0</span></div>
              <div className="material-empty"><CircleAlert size={15} />还没有个人材料</div>
            </section>
          </div>
          <button type="button" className="add-material-button" disabled title="材料添加尚未接入"><Plus size={16} />添加材料</button>
        </>
      ) : null}
    </aside>
  );
}
