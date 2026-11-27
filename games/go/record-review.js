import { createGoRecordAnalysis } from "./record-analysis.js";

export function createGoRecordReview({ root, enabled, onSelect, beforeAnalysis, onSave }) {
  const find = id => root.querySelector(`#${id}`);
  const panel=find("record-winrate"), toggle=find("record-winrate-toggle"), start=find("record-winrate-start");
  const output=find("record-winrate-value"), status=find("record-winrate-status");
  const chart=find("record-winrate-chart"), line=find("record-winrate-line"), cursor=find("record-winrate-cursor");
  let selected=0, values=[], running=false, total=0, complete=false;
  function draw() {
    let path="", connected=false;
    values.forEach((value,index)=>{
      if (value===null) { connected=false; return; }
      const x=12+296*index/Math.max(1,total-1),y=110-100*value;
      path+=`${connected?"L":"M"}${x.toFixed(2)} ${y.toFixed(2)}`;
      connected=true;
    });
    line.setAttribute("d",path);
    const x=12+296*selected/Math.max(1,total-1);
    cursor.setAttribute("d",`M${x} 10V110`);
    const value=values[selected];
    output.textContent=value==null ? "尚未分析" : `黑 ${(value*100).toFixed(1)}% · 白 ${((1-value)*100).toFixed(1)}%`;
    start.disabled=complete;
    start.textContent=running ? "暂停" : complete ? "已完成" : values.some(value=>value!==null) ? "继续分析" : "开始分析";
  }
  const analysis=createGoRecordAnalysis({onSave,onUpdate(update) {
    ({values,running,total,complete}=update);
    status.textContent=update.message;
    draw();
  }});
  toggle.hidden=!enabled;
  toggle.addEventListener("click",()=>{
    panel.hidden=!panel.hidden;
    toggle.setAttribute("aria-expanded",String(!panel.hidden));
    if (panel.hidden) analysis.pause();
  });
  start.addEventListener("click",()=>{
    if (running) analysis.pause();
    else { beforeAnalysis(); analysis.start(); }
  });
  chart.addEventListener("click",event=>{
    const rect=chart.getBoundingClientRect();
    const ratio=(320*(event.clientX-rect.left)/rect.width-12)/296;
    onSelect(Math.max(0,Math.min(total-1,Math.round(ratio*(total-1)))));
  });
  return {
    open(key,count,getPosition,saved) {
      selected=count-1; panel.hidden=true; toggle.setAttribute("aria-expanded","false");
      analysis.select(key,count,getPosition,saved);
    },
    select(index) { selected=index; draw(); },
    pause: analysis.pause,
    close() { analysis.destroy(); panel.hidden=true; toggle.setAttribute("aria-expanded","false"); },
  };
}
