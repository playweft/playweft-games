import { createGoRecordAnalysis } from "./record-analysis.js";

export function createGoRecordReview({ root, enabled, onSelect, beforeAnalysis, onSave }) {
  const find = id => root.querySelector(`#${id}`);
  const view=root.ownerDocument.defaultView;
  const controls=find("replay-controls"), controlsHome=controls.parentElement, controlsNext=controls.nextSibling;
  const play=find("record-replay-play");
  const panel=find("record-winrate"), toggle=find("record-winrate-toggle"), start=find("record-winrate-start");
  const sidebar=root.querySelector(".action-panel"), moveLog=root.querySelector(".move-log");
  const portrait=view.matchMedia("(width < 1200px) and (orientation: portrait)");
  const back=root.ownerDocument.getElementById("game-back"), backHome=back.parentElement, backNext=back.nextSibling;
  const backPanel=find("record-review-panel");
  const headerBack=view.matchMedia("(orientation: landscape), (width < 600px)");
  const output=find("record-winrate-value"), status=find("record-winrate-status");
  const chart=find("record-winrate-chart"), line=find("record-winrate-line"), cursor=find("record-winrate-cursor");
  const board=find("board");
  let selected=0, values=[], running=false, total=0, complete=false;
  let recommendations=[], getPosition, analysisMessage="";
  let playTimer;
  let reviewing=false;
  function placeBack() {
    backPanel.hidden=headerBack.matches;
    if (headerBack.matches) backHome.insertBefore(back,backNext);
    else backPanel.prepend(back);
  }
  function placeAnalysis() {
    if (portrait.matches) controls.prepend(panel);
    else sidebar.insertBefore(panel,moveLog);
  }
  function expandAnalysis(open) {
    if (!open && panel.contains(root.ownerDocument.activeElement)) toggle.focus();
    toggle.setAttribute("aria-expanded",String(open));
    panel.classList.toggle("is-open",open);
    panel.inert=!open;
    panel.setAttribute("aria-hidden",String(!open));
    if (!open) analysis.pause();
    renderRecommendation();
  }
  portrait.addEventListener("change",()=>{ if (reviewing) placeAnalysis(); });
  headerBack.addEventListener("change",()=>{ if (reviewing) placeBack(); });
  function stopPlayback() {
    view.clearInterval(playTimer); playTimer=undefined;
    play.setAttribute("aria-pressed","false");
    play.setAttribute("aria-label","播放"); play.title="播放";
    play.querySelector("[data-play-icon]").toggleAttribute("hidden",false);
    play.querySelector("[data-pause-icon]").toggleAttribute("hidden",true);
  }
  play.addEventListener("click",()=>{
    if (playTimer!==undefined) { stopPlayback(); return; }
    if (total<2) return;
    if (selected>=total-1) onSelect(0);
    play.setAttribute("aria-pressed","true");
    play.setAttribute("aria-label","暂停"); play.title="暂停";
    play.querySelector("[data-play-icon]").toggleAttribute("hidden",true);
    play.querySelector("[data-pause-icon]").toggleAttribute("hidden",false);
    playTimer=view.setInterval(()=>onSelect(Math.min(total-1,selected+1)),1000);
  });
  controls.addEventListener("click",event=>{
    const button=event.target.closest("button");
    if (button && button!==play) stopPlayback();
  });
  controls.addEventListener("input",stopPlayback);
  root.addEventListener("click",event=>{
    if (event.target.closest("#move-log-list [data-move-number]")) stopPlayback();
  });
  function renderRecommendation() {
    const best=reviewing && enabled && toggle.getAttribute("aria-expanded")==="true" ? recommendations[selected] : null;
    let point, label="";
    if (best?.type==="pass") label="停一手";
    else if (best?.type==="play") {
      const position=getPosition(selected), size=position.board.length;
      const {row,column}=best;
      if ([9,13,19].includes(size) && row>=1 && row<=size && column>=1 && column<=size &&
          (position.board[row-1]?.[column-1]==null || position.board[row-1]?.[column-1]===0) && board.children.length===size*size) {
        point=board.children[(row-1)*size+column-1];
        label=`${"ABCDEFGHJKLMNOPQRST"[column-1]}${size-row+1}`;
      }
    }
    const previous=board.querySelector(".is-ai-first");
    if (previous!==point) {
      previous?.classList.remove("is-ai-first"); previous?.removeAttribute("aria-description");
      point?.classList.add("is-ai-first");
      point?.setAttribute("aria-description",`AI 一选：${label}`);
    }
    status.textContent=label ? `一选：${label} · ${analysisMessage}` : analysisMessage;
  }
  function draw() {
    const rect=chart.getBoundingClientRect(), width=rect.width||320, height=rect.height||120;
    const span=width-24, bottom=height-10;
    chart.setAttribute("viewBox",`0 0 ${width} ${height}`);
    chart.querySelector(".winrate-grid").setAttribute("d",`M12 10H${width-12}M12 ${height/2}H${width-12}M12 ${bottom}H${width-12}`);
    chart.querySelectorAll("text").forEach((label,index)=>label.setAttribute("y",[22,height/2-2,bottom-2][index]));
    let path="", connected=false;
    values.forEach((value,index)=>{
      if (value===null) { connected=false; return; }
      const x=12+span*index/Math.max(1,total-1),y=bottom-(height-20)*value;
      path+=`${connected?"L":"M"}${x.toFixed(2)} ${y.toFixed(2)}`;
      connected=true;
    });
    line.setAttribute("d",path);
    const x=12+span*selected/Math.max(1,total-1);
    cursor.setAttribute("d",`M${x} 10V${bottom}`);
    const value=values[selected];
    output.textContent=value==null ? "尚未分析" : `黑 ${(value*100).toFixed(1)}% · 白 ${((1-value)*100).toFixed(1)}%`;
    start.disabled=complete;
    start.textContent=running ? "暂停" : complete ? "已完成" : values.some(value=>value!==null) ? "继续分析" : "开始分析";
    renderRecommendation();
  }
  const analysis=createGoRecordAnalysis({onSave,onUpdate(update) {
    ({values,recommendations,running,total,complete}=update);
    analysisMessage=update.message;
    draw();
  }});
  const chartResize=new view.ResizeObserver(draw);
  chartResize.observe(chart);
  toggle.addEventListener("click",()=>{
    expandAnalysis(toggle.getAttribute("aria-expanded")!=="true");
  });
  start.addEventListener("click",()=>{
    stopPlayback();
    if (running) analysis.pause();
    else { beforeAnalysis(); analysis.start(); }
  });
  chart.addEventListener("click",event=>{
    stopPlayback();
    const rect=chart.getBoundingClientRect();
    const ratio=(event.clientX-rect.left-12)/(rect.width-24);
    onSelect(Math.max(0,Math.min(total-1,Math.round(ratio*(total-1)))));
  });
  return {
    open(key,count,position,saved) {
      stopPlayback(); root.append(controls); reviewing=true; placeAnalysis(); placeBack();
      play.hidden=false; play.disabled=count<2; toggle.hidden=!enabled;
      selected=count-1; expandAnalysis(false); panel.hidden=!enabled;
      getPosition=position;
      analysis.select(key,count,position,saved);
    },
    select(index) { selected=index; if (selected>=total-1) stopPlayback(); draw(); },
    pause() { stopPlayback(); analysis.pause(); },
    close() {
      stopPlayback(); expandAnalysis(false); analysis.destroy(); panel.hidden=true; reviewing=false;
      sidebar.insertBefore(panel,moveLog);
      backHome.insertBefore(back,backNext);
      backPanel.hidden=true;
      play.hidden=true; toggle.hidden=true; toggle.setAttribute("aria-expanded","false");
      controlsHome.insertBefore(controls,controlsNext);
    },
  };
}
