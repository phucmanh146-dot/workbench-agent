import {useEffect, useRef, useState} from "react";
import {createRoot} from "react-dom/client";
import "./style.css";

type Project = {id: number; title: string; category: string; deadline: string};
type Task = {id: string; parentId: string | null; title: string; starts: string; ends: string; deadline?:string};
type Draft = {revision?: string; tasks?: Task[]; applied?: boolean};
type Status = "todo" | "doing" | "done";
type Progress = {task_id:string; status:Status; actual_minutes:number|null};
type ReviewStep = "rules" | "goal" | "gap";
type WorkflowStep = ReviewStep | "tasks" | "schedule";
type WorkflowNote = {step:ReviewStep; body:string; stale:number};
type Detail = {project: Project; materials: {id: number; title: string; body: string; source_url?:string; workflow_step?:ReviewStep; stale?:number;topic?:string;kind?:string}[];
  files?:{id:string;name:string;size_bytes:number;material_id:number|null}[];
  goals?:string[];
  receipts?:{id:number;created_at:string;label:string;target:string;day:string|null;body:string}[];
  draft: Draft; official: Task[]; progress:Progress[]; workflow:WorkflowNote[]};
type DayTask = {project_id: number; id: string; title: string; category: string; project_title: string; minutes: number | null; slot_ends: number | null; status:Status; actual_minutes:number|null};
type ArrangeItem={title:string;day:string;start:number;end:number;conflict?:boolean};
type AiArrangePreview={projectId:number;taskId:string;title:string;projectTitle:string;start:number;end:number;estimatedMinutes?:number;sampleCount?:number};
type MarkdownDraft={title:string;body:string};
const estimateText=(item:AiArrangePreview)=>item.estimatedMinutes==null?
  "暂无可比实耗，时长为 AI 粗估":`历史估时 ${item.estimatedMinutes} 分钟 · ${item.sampleCount} 项样本`;
type ScheduleItem={title:string;weekday:number;start?:number;end?:number;
  firstPeriod?:number;lastPeriod?:number;firstWeek?:number;lastWeek?:number};
type MonthTask = Pick<DayTask, "project_id" | "id" | "title" | "category" | "project_title"> & {starts: string; ends: string; parent_id: string | null};
type Page = "临时收集" | "知识库" | "AI 助理" | "AI 拆解" | "待分配池" | "项目排期" | "月总览" | "今日时间表" | "番茄钟" | "项目风险" | "复盘";
type PlanItem = {title: string; day: string | null;start?:number;end?:number;sourceId?:number;evidence?:string;deadline?:string};
type SearchResult = {summary:string; engine?:string; sources:{title:string;url:string;snippet?:string}[]};
type RulePreview = {summary:string;deadline?:string;deadlineEvidence?:string};
type FixedBlock = {id:number; title:string; starts:number; ends:number};
const quarterHours=Array.from({length:66},(_,i)=>450+i*15);

async function api<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const upload=body instanceof FormData;
  const response = await fetch("/api" + path, {
    method, headers:upload?undefined:{"Content-Type":"application/json"},
    body:body===undefined?undefined:upload?body:JSON.stringify(body)
  });
  const data = await response.json();
  if(response.status===404 && path.startsWith("/interruptions/") && String(data.message).startsWith("No static resource"))
    throw new Error("当前运行的后端版本过旧。关闭工作台运行窗口，运行 setup.bat 更新，再用 run.bat 启动。");
  if (!response.ok) throw new Error(data.message || "操作失败，请重试");
  return data;
}

const localDate = new Date();
const today = [localDate.getFullYear(), localDate.getMonth()+1, localDate.getDate()].map(n => String(n).padStart(2,"0")).join("-");
const dateShift = (day: string, offset: number) => {
  const date = new Date(day + "T00:00:00Z");
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0,10);
};
const delta = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from))/86400000);
const time = (minutes: number) => [Math.floor(minutes / 60), minutes % 60].map(n => String(n).padStart(2,"0")).join(":");
const parseClock=(value:string)=>value?Number(value.slice(0,2))*60+Number(value.slice(3)):undefined;
const statusLabels: Record<Status,string> = {todo:"待办",doing:"进行中",done:"已完成"};

function PersonalRules({projectId,busy,run}: {
  projectId:number;busy:boolean;run:(action:()=>Promise<void>)=>Promise<void>;
}) {
  const [rules,setRules]=useState<string>();
  const [error,setError]=useState("");
  const path="/projects/"+projectId+"/memory";
  useEffect(()=>{
    let active=true;
    api<{personalRules:string}>(path).then(result=>{if(active)setRules(result.personalRules);})
      .catch(issue=>{if(active)setError(issue.message);});
    return ()=>{active=false;};
  },[path]);
  return <details>
    <summary>项目共用规则</summary>
    {error && <p className="alert" role="alert">{error}</p>}
    <form onSubmit={event=>{
      event.preventDefault();
      if(rules===undefined)return;
      void run(async()=>{setRules((await api<{body:string}>(path+"/rules","PUT",{body:rules})).body);});
    }}>
      <label>规则和偏好<textarea rows={3} maxLength={4000} value={rules ?? ""} disabled={busy || rules===undefined}
        placeholder="例如：工作日 22:00 结束，比赛优先排周末"
        onChange={event=>setRules(event.target.value)}/></label>
      <div className="actions"><button disabled={busy || rules===undefined}>保存规则</button>
        <a href={"/api"+path} download={"project-"+projectId+"-memory.json"}>导出项目记忆</a></div>
    </form>
  </details>;
}

function HabitMemory({projectId,busy,run,notify,saved}: {
  projectId:number;busy:boolean;run:(action:()=>Promise<void>)=>Promise<void>;
  notify:(message:string)=>void;saved:(detail:Detail)=>void;
}) {
  const [habits,setHabits]=useState<string|undefined>();
  const [draft,setDraft]=useState("");
  const [error,setError]=useState("");
  const path="/projects/"+projectId;
  useEffect(()=>{
    let active=true;
    api<{confirmedHabits:string}>(path+"/memory").then(result=>{if(active)setHabits(result.confirmedHabits);})
      .catch(issue=>{if(active)setError(issue.message);});
    return()=>{active=false;};
  },[path]);
  return <details>
    <summary>习惯记忆{habits===undefined?"":" · "+(habits?"已生成":"未生成")}</summary>
    {error && <p className="alert" role="alert">{error}</p>}
    {habits!==undefined && !!habits && <details><summary>当前已确认的习惯</summary>
      <pre className="material">{habits}</pre>
    </details>}
    {draft ? <form onSubmit={event=>{
      event.preventDefault();
      void run(async()=>{
        saved(await api<Detail>(path+"/memory/habits","PUT",{body:draft}));
        setHabits(draft); setDraft("");
        notify("习惯记忆已确认，写入项目记忆并保存为「项目习惯记忆.md」。");
      });
    }}>
      <label>习惯建议草稿（可编辑后确认）
        <textarea rows={10} maxLength={24000} value={draft} disabled={busy}
          onChange={event=>setDraft(event.target.value)}/></label>
      <div className="actions">
        <button disabled={busy}>确认保存</button>
        <button type="button" disabled={busy} onClick={()=>setDraft("")}>放弃</button>
      </div>
      <p className="muted">确认后写入项目记忆（问答、拆解、排程、复盘都会参考），并保存为项目文件「项目习惯记忆.md」。</p>
    </form> : <div className="actions">
      <button disabled={busy} onClick={()=>void run(async()=>{
        setDraft((await api<{summary:string}>(path+"/memory/habits/preview","POST")).summary);
      })}>{habits?"从历史再次提炼建议":"AI 从历史提炼习惯建议"}</button>
    </div>}
  </details>;
}

function KnowledgeChat({detail,busy,run,saved,notify,dirty,openDraft,openMonth}: {
  detail:Detail; busy:boolean; run:(action:()=>Promise<void>)=>Promise<void>;
  saved:(detail:Detail)=>void; notify:(message:string)=>void;
  dirty:boolean; openDraft:(detail:Detail)=>void;
  openMonth:(detail:Detail,day:string)=>void;
}) {
  type Turn={id:number;question:string;attachment:string;answer:string;action?:string;sources?:string;preview?:string};
  type ChatResult={turns:Turn[];tasks?:Task[];revision?:string;replan?:boolean;savedRevision?:string;arrangement?:ArrangeItem[];
    dayPlan?:{day:string;items:AiArrangePreview[]};sourceTitles?:string[]};
  const [turns,setTurns]=useState<Turn[]>([]);
  const [proposal,setProposal]=useState<ChatResult>();
  const [arrangement,setArrangement]=useState<ArrangeItem[]>();
  const [dayPlan,setDayPlan]=useState<{day:string;items:AiArrangePreview[]}>();
  const [error,setError]=useState("");
  const [latestSources,setLatestSources]=useState<string[]>([]);
  const [historyOpen,setHistoryOpen]=useState(false);
  const path="/projects/"+detail.project.id;
  function previewRows(parentId:string|null):React.ReactNode {
    return proposal?.tasks?.filter(task=>task.parentId===parentId).map(task=><li key={task.id}>
      {task.title} · {task.starts} 至 {task.ends}{task.deadline && " · 截止 "+task.deadline}
      {proposal.tasks?.some(child=>child.parentId===task.id) && <ul>{previewRows(task.id)}</ul>}
    </li>);
  }
  useEffect(()=>{
    let active=true;
    api<Turn[]>(path+"/knowledge-chat").then(data=>{if(active)setTurns(data);})
      .catch(issue=>{if(active)setError(issue.message);});
    return ()=>{active=false;};
  },[path]);
  return <section className="card knowledgeChat">
    <h2>项目对话</h2>
    <details><summary>操作确认记录 · {detail.receipts?.length ?? 0} 条</summary>
      {(detail.receipts ?? []).map(receipt=><details key={receipt.id}>
        <summary>{receipt.label} · {new Date(receipt.created_at).toLocaleString()} · {receipt.target}{receipt.day && " · "+receipt.day}</summary>
        <p className="material">{receipt.body}</p>
      </details>)}
    </details>
    <PersonalRules projectId={detail.project.id} busy={busy} run={run}/>
    <HabitMemory projectId={detail.project.id} busy={busy} run={run} notify={notify} saved={saved}/>
    <details>
      <summary>项目记忆 · {detail.materials.filter(item=>!item.stale).length} 份资料 · {detail.progress.filter(item=>item.status==="done").length} 项已完成</summary>
      <p className="material">{detail.workflow.find(note=>note.step==="goal" && !note.stale)?.body ?? "还没有已确认的项目目标。"}</p>
      <p className="muted">已保存草稿 {detail.draft.tasks?.length ?? 0} 项 · 正式任务 {detail.official.length} 项</p>
    </details>
    {error && <p className="alert" role="alert">{error}</p>}
    {!!turns.length && <details className="chatHistoryPanel" open={historyOpen}
      onToggle={event=>setHistoryOpen(event.currentTarget.open)}>
      <summary>对话记录 · {turns.length} 轮</summary>
      <div className="chatHistory">
      {turns.map((turn,index)=><article key={turn.id}>
        <details className="chatTurn" open={index===turns.length-1 || undefined}>
          <summary>{turn.question.replace(/\s+/g," ").slice(0,55)}{turn.question.length>55?"…":""}</summary>
          <div className="questionBubble">{turn.question}{turn.attachment && <small>附件 · {turn.attachment}</small>}</div>
          <p className="material">{turn.answer}</p>
          {(turn.sources || (index===turns.length-1 && latestSources.join("、"))) && <small>提供给 AI 的资料 · {turn.sources || latestSources.join("、")}</small>}
          {turn.action && <small>操作 · {({answer:"问答",breakdown:"任务拆解",revise:"改稿",replan:"待办重排",arrange:"固定时段",dayArrange:"当日排程",review:"复盘"} as Record<string,string>)[turn.action]}</small>}
          {turn.preview && <details><summary>查看该轮生成记录</summary>
            <p className="muted">此处记录 AI 生成的预览。正式结果以对应项目排期或日程为准。</p>
            <pre className="material">{JSON.stringify(JSON.parse(turn.preview),null,2)}</pre>
          </details>}
          <button disabled={busy} onClick={()=>void run(async()=>{
            saved(await api<Detail>(path+"/materials","POST",{title:"问答 · "+turn.question.slice(0,45),body:turn.answer}));
            notify("答复已保存为项目资料。");
          })}>保存答复为资料</button>
        </details>
      </article>)}
      </div>
    </details>}
    {proposal?.tasks && <details open>
      <summary>排期草稿预览 · {proposal.tasks.length} 项</summary>
      {proposal.replan && <p className="muted">确认会应用整份草稿。也可以先打开项目排期查看并编辑。</p>}
      <ul>{previewRows(null)}</ul>
      {dirty && <p className="notice">请先处理项目排期页里未保存的编辑。</p>}
      <div className="actions">
        {proposal.replan && <button type="button" className="primary" disabled={busy || dirty} onClick={()=>void run(async()=>{
          let revision=proposal.savedRevision;
          const firstChanged=proposal.tasks?.find(task=>!detail.draft.tasks?.some(previous=>
            previous.id===task.id && previous.starts===task.starts && previous.ends===task.ends));
          if(!revision) {
            const draft=await api<Detail>(path+"/draft","PUT",{revision:proposal.revision,tasks:proposal.tasks});
            revision=draft.draft.revision;
            setProposal({...proposal,savedRevision:revision});
            saved(draft);
          }
          openMonth(await api<Detail>(path+"/apply/"+revision,"POST"),firstChanged?.starts ?? today);
          notify("已更新正式项目排期和月总览。");
        })}>确认更新排期和月总览</button>}
        <button type="button" className="primary" disabled={busy || dirty} onClick={()=>void run(async()=>{
          const data=proposal.savedRevision?await api<Detail>(path):
            await api<Detail>(path+"/draft","PUT",{revision:proposal.revision,tasks:proposal.tasks});
          openDraft(data);
          notify("草稿已保存。请核对日期后确认应用。");
        })}>保存并查看草稿</button>
        <button type="button" disabled={busy} onClick={()=>setProposal(undefined)}>放弃预览</button>
      </div>
    </details>}
    {arrangement && !!arrangement.length && <details open>
      <summary>固定时间安排 · {arrangement.length} 项</summary>
      <ul className="revisionResult">{arrangement.map((item,index)=><li key={index}>
        <span>{item.title} · {item.day} · {time(item.start)}–{time(item.end)}</span>
        {item.conflict && <span className="urgent">与已有安排冲突，确认时会跳过</span>}
      </li>)}</ul>
      <div className="actions">
        <button type="button" className="primary" disabled={busy} onClick={()=>void run(async()=>{
          const result=await api<{added:number;skipped:number;detail:Detail}>(path+"/arrange","POST",
            {items:arrangement.map(({title,day,start,end})=>({title,day,start,end}))});
          setArrangement(undefined);
          saved(result.detail);
          notify("已添加 "+result.added+" 项固定时间安排"+(result.skipped
            ?"，"+result.skipped+" 项因时间冲突跳过。"
            :"。可前往今日时间表查看。"));
        })}>确认添加到日程</button>
        <button type="button" disabled={busy} onClick={()=>setArrangement(undefined)}>放弃</button>
      </div>
    </details>}
    {dayPlan && !!dayPlan.items.length && <details open>
      <summary>AI 日程建议 · {dayPlan.day} · {dayPlan.items.length} 项</summary>
      <ul className="revisionResult">{dayPlan.items.map((item,index)=><li key={index}>
        <span>{item.title} · {time(item.start)}–{time(item.end)}</span>
        <small>{item.projectTitle} · {estimateText(item)}</small>
      </li>)}</ul>
      <div className="actions">
        <button type="button" className="primary" disabled={busy} onClick={()=>void run(async()=>{
          await api("/day/"+dayPlan.day+"/ai-arrange/confirm","POST",
            {items:dayPlan.items.map(({projectId,taskId,start,end})=>({projectId,taskId,start,end}))});
          saved(await api<Detail>(path));
          notify("已按 AI 建议写入 "+dayPlan.day+" 的时间表。");
          setDayPlan(undefined);
        })}>应用安排</button>
        <button type="button" disabled={busy} onClick={()=>setDayPlan(undefined)}>放弃</button>
      </div>
    </details>}
    <form onSubmit={event=>{
      event.preventDefault();
      const form=event.currentTarget;
      const data=new FormData(form);
      if(!data.get("materialId"))data.delete("materialId");
      const attachment=data.get("file");
      if(attachment instanceof File && !attachment.size)data.delete("file");
      data.set("assistant","true");
      void run(async()=>{
        const result=await api<ChatResult>(path+"/knowledge-chat","POST",data);
        setTurns(result.turns);
        setHistoryOpen(true);
        setLatestSources(result.sourceTitles ?? []);
        setProposal(result.tasks?result:undefined);
        setArrangement(result.arrangement);
        setDayPlan(result.dayPlan);
        form.reset();
      });
    }}>
      <label>问题<textarea name="question" rows={2} required maxLength={3000} disabled={busy}
        placeholder="例如：查一下当前项目有哪些待办，帮我重新安排接下来的日期"/></label>
      <div className="workflowSources">
        <label>选择项目资料（可选）<select name="materialId" disabled={busy}><option value="">不指定资料</option>
          {detail.materials.filter(item=>!item.stale).map(item=><option value={item.id} key={item.id}>{item.title}</option>)}
        </select></label>
        <label>文件或照片（可选，≤ 4 MB）<input type="file" name="file" disabled={busy} accept=".txt,.md,.csv,.pdf,.docx,.png,.jpg,.jpeg"/></label>
      </div>
      <p className="muted">发送后，选中的正文或附件会交给已配置的模型处理。照片需要模型支持图片输入。</p>
      <button className="primary" disabled={busy}>发送</button>
    </form>
  </section>;
}

function DraftRevision({project,tasks,busy,run,adopt}: {
  project:Project; tasks:Task[]; busy:boolean; run:(action:()=>Promise<void>)=>Promise<void>;
  adopt:(tasks:Task[])=>Promise<void>;
}) {
  const [request,setRequest]=useState("");
  const [preview,setPreview]=useState<{basis:Task[];proposal:Task[]}>();
  const before=new Map(preview?.basis.map(task=>[task.id,task]));
  const after=new Map(preview?.proposal.map(task=>[task.id,task]));
  const changes=[...new Set([...before.keys(),...after.keys()])].flatMap(id=>{
    const old=before.get(id), next=after.get(id);
    if(old && next && old.title===next.title && old.starts===next.starts &&
      old.ends===next.ends && old.parentId===next.parentId && old.deadline===next.deadline) return [];
    return [{id,old,next,label:!old?"新增":!next?"删除":"调整"}];
  });
  const describe=(task:Task,records:Map<string,Task>)=>
    (task.parentId ? (records.get(task.parentId)?.title ?? "")+" / " : "")+
    task.title+" · "+task.starts+" 至 "+task.ends+(task.deadline?" · 截止 "+task.deadline:"");
  return <details className="revisionPanel">
    <summary>请 AI 调整排期</summary>
    <form onSubmit={e=>{
      e.preventDefault();
      setPreview(undefined);
      void run(async()=>{
        const result=await api<{tasks:Task[]}>("/projects/"+project.id+"/draft/revise","POST",{instruction:request,tasks});
        setPreview({basis:tasks,proposal:result.tasks});
      });
    }}>
      <label>你想怎么调整？
        <textarea rows={2} maxLength={1500} disabled={busy} value={request} onChange={e=>setRequest(e.target.value)}
          placeholder="例如：把撰写初稿往后移一天，删掉不需要的检查项，再加一次提交前演练"/>
      </label>
      <button disabled={busy || !tasks.length || !request.trim()}>生成调整建议</button>
    </form>
    {preview && <div className="revisionResult">
      <p className="muted">共 {changes.length} 项变更。采用建议会更新草稿，正式日程待你确认应用后更新。</p>
      {preview.basis!==tasks && <p className="notice">草稿已变更，请重新生成建议。</p>}
      <ul>{changes.map(({id,old,next,label})=><li key={id}>
        <strong>{label}</strong>
        {old && <span>原安排：{describe(old,before)}</span>}
        {next && <span>建议：{describe(next,after)}</span>}
      </li>)}</ul>
      <div className="actions">
        <button className="primary" disabled={busy || !changes.length || preview.basis!==tasks} onClick={()=>void run(async()=>{
          await adopt(preview.proposal);
          setPreview(undefined);
        })}>采用建议并保存草稿</button>
        <button disabled={busy} onClick={()=>setPreview(undefined)}>放弃建议</button>
      </div>
    </div>}
  </details>;
}

function PublicPageImport({project,busy,run,saved,notify}: {
  project:Project; busy:boolean; run:(action:()=>Promise<void>)=>Promise<void>;
  saved:(detail:Detail)=>void; notify:(message:string)=>void;
}) {
  const [preview,setPreview]=useState<{title:string;url:string;content:string;summary:string;truncated:boolean}>();
  const path="/projects/"+project.id+"/materials";
  return <details className="knowledgeModule publicPageImport">
    <summary>公开链接</summary>
    <form onSubmit={event=>{
      event.preventDefault();
      const fields=Object.fromEntries(new FormData(event.currentTarget));
      setPreview(undefined);
      void run(async()=>setPreview(await api<NonNullable<typeof preview>>(path+"/link/preview","POST",fields)));
    }}>
      <label>网页链接<input name="url" type="url" required maxLength={8192} disabled={busy}
        placeholder="https://… 比赛公告、课程介绍或文章"/></label>
      <label>你想分析什么（可选）<input name="question" maxLength={1000} disabled={busy}
        placeholder="例如：找出报名截止日期和作品提交要求"/></label>
      <button disabled={busy}>读取链接并分析</button>
    </form>
    {preview && <div className="publicPagePreview">
      <a href={preview.url} target="_blank" rel="noreferrer">{preview.title}</a>
      {preview.truncated && <p className="muted">网页较长，本次仅分析读取到的前 24,000 字符。</p>}
      <label>分析结果<textarea aria-label="链接分析结果" rows={6} value={preview.summary} disabled={busy}
        onChange={e=>setPreview({...preview,summary:e.target.value})}/></label>
      <details><summary>查看读取的正文</summary><p className="material">{preview.content}</p></details>
      <button className="primary" disabled={busy || !preview.summary.trim()} onClick={()=>void run(async()=>{
        const detail=await api<Detail>(path,"POST",{
          title:preview.title,
          body:"来源："+preview.url+"\n\n分析结果\n"+preview.summary.trim()+"\n\n已读取正文\n"+preview.content
        });
        saved(detail);
        setPreview(undefined);
        notify("链接正文和分析已保存到项目知识库。");
      })}>确认保存链接资料</button>
    </div>}
  </details>;
}
const workflowSteps: {key:WorkflowStep;title:string}[] = [
  {key:"rules",title:"资料与规则"}, {key:"goal",title:"赛道与目标"}, {key:"gap",title:"作品差距"},
  {key:"tasks",title:"拆解子任务"}, {key:"schedule",title:"确认月调度"}
];
const workspaceNav: {title:string; pages:Page[]}[] = [
  {title:"项目与资料",pages:["临时收集","知识库","AI 助理","AI 拆解"]},
  {title:"任务看板",pages:["今日时间表","番茄钟","月总览","项目排期","待分配池"]},
  {title:"检查进度",pages:["项目风险","复盘"]}
];
const projectCategories=["课程","竞赛","考研","副业","学校作业"];

function NewProject({busy,dirty,run,onCreated}: {
  busy:boolean; dirty:boolean; run:(action:()=>Promise<void>)=>Promise<void>; onCreated:(id:number)=>Promise<void>;
}) {
  const [category,setCategory]=useState("");
  const [title,setTitle]=useState("");
  const [keywords,setKeywords]=useState("");
  const [deadline,setDeadline]=useState(today);
  const [url,setUrl]=useState("");
  const [notice,setNotice]=useState("");
  const [additionalSources,setAdditionalSources]=useState<{url:string;notice:string}[]>([]);
  const [confirmed,setConfirmed]=useState(false);
  const [search,setSearch]=useState<SearchResult>();
  const [preview,setPreview]=useState<RulePreview>();
  const competition=category==="竞赛";
  const query=keywords.trim() || title.trim();
  const reviewRequired=Boolean(url.trim());
  function resetNotice(nextUrl:string) {
    setUrl(nextUrl);
    setPreview(undefined);
    setConfirmed(false);
    setDeadline("");
  }
  function updateSources(sources:typeof additionalSources) {
    setAdditionalSources(sources);
    resetNotice(url);
  }
  return <section className="card"><h2>新建项目</h2>
    <form onSubmit={event=>{
      event.preventDefault();
      if(reviewRequired && !confirmed)return;
      void run(async()=>{
        const result=await api<{id:number}>("/projects","POST",{
          category,title,deadline,...(url.trim()?{officialUrl:url,officialSummary:preview?.summary,
            additionalUrls:additionalSources.map(source=>source.url)}:{})
        });
        await onCreated(result.id);
        setCategory("");setTitle("");setUrl("");setNotice("");setConfirmed(false);
        setSearch(undefined);setPreview(undefined);setDeadline(today);setKeywords("");
        setAdditionalSources([]);
      });
    }}>
      <fieldset disabled={busy} className="projectFields">
        <label>类别<select name="category" required value={category} onChange={event=>{
          setCategory(event.target.value);
          resetNotice("");setNotice("");setSearch(undefined);setAdditionalSources([]);setKeywords("");
          setDeadline(event.target.value==="竞赛"?"":today);
        }}>
          <option value="" disabled>请选择类别</option>
          {projectCategories.map(item=><option key={item}>{item}</option>)}
        </select></label>
        <label>项目名<input name="title" value={title} required placeholder="例如 应用创作大赛" onChange={event=>{
          setTitle(event.target.value);setSearch(undefined);
          if(url || competition){resetNotice("");setNotice("");setAdditionalSources([]);}
        }}/></label>
        {category && <details className="knowledgeModule" open={competition || undefined}>
          <summary>AI 搜索与截止日期核对</summary>
          <div className="sourceSearch">
            <label>联网搜索关键词<input value={keywords} maxLength={300} placeholder={title || "输入项目相关关键词"}
              onChange={event=>{setKeywords(event.target.value);setSearch(undefined);}}/></label>
            <div className="actions">
              <button type="button" disabled={!query} onClick={()=>{
                setSearch(undefined);
                void run(async()=>setSearch(await api<SearchResult>("/projects/competition-notice/search","POST",{query,category})));
              }}>搜索官网与官方通知</button>
              {query && <a className="searchExternal" target="_blank" rel="noreferrer"
                href={"https://www.baidu.com/s?wd="+encodeURIComponent(query+" 官网 官方通知")}>在百度打开</a>}
            </div>
          </div>
          <label>官网公告链接（可选）<input type="url" value={url} placeholder="粘贴官网公告，或从候选里选择；留空则直接自填截止日"
            onChange={event=>{resetNotice(event.target.value);setNotice("");
              setAdditionalSources(current=>current.filter(source=>source.url!==event.target.value));}}/></label>
          {search && <details open><summary>官网候选 · {search.sources.length} 条</summary>
            {search.summary && <p className="muted">{search.summary}</p>}
            <ul className="sourceLinks">{search.sources.map(source=><li key={source.url}>
              <a href={source.url} target="_blank" rel="noreferrer">{source.title || source.url}</a>{" "}
              <button type="button" disabled={url===source.url ||
                (!!url && additionalSources.length>=4 && !additionalSources.some(item=>item.url===source.url))} onClick={()=>{
                if(!url){resetNotice(source.url);setNotice("");return;}
                updateSources(additionalSources.some(item=>item.url===source.url)?
                  additionalSources.filter(item=>item.url!==source.url):[...additionalSources,{url:source.url,notice:""}]);
              }}>{url===source.url?"主公告":additionalSources.some(item=>item.url===source.url)?"取消选用":"选用"}</button>
            </li>)}</ul>
          </details>}
          <details><summary>网页读取失败？粘贴官网正文</summary>
            <label>官网公告正文<textarea rows={4} value={notice} maxLength={24000} onChange={event=>{
              setNotice(event.target.value);resetNotice(url);
            }}/></label>
          </details>
          {additionalSources.map((source,index)=><details key={index}>
            <summary>补充公告 {index+1}{source.url && " · "+source.url}</summary>
            <label>补充公告链接<input type="url" required value={source.url} onChange={event=>
              updateSources(additionalSources.map((item,i)=>i===index?{...item,url:event.target.value}:item))}/></label>
            <label>官网正文（可选）<textarea rows={3} maxLength={24000} value={source.notice}
              onChange={event=>updateSources(additionalSources.map((item,i)=>i===index?{...item,notice:event.target.value}:item))}/></label>
            <button type="button" onClick={()=>updateSources(additionalSources.filter((_,i)=>i!==index))}>移除</button>
          </details>)}
          <button type="button" disabled={additionalSources.length>=4}
            onClick={()=>updateSources([...additionalSources,{url:"",notice:""}])}>添加补充公告</button>
          <button type="button" disabled={!title.trim() || !url.trim() || additionalSources.some(source=>!source.url.trim())} onClick={()=>{
            setPreview(undefined);setConfirmed(false);setDeadline("");
            void run(async()=>{
              const result=await api<RulePreview>("/projects/competition-notice/preview","POST",{title,url,notice,additionalSources,category});
              setPreview(result);
              setDeadline(result.deadline ?? "");
            });
          }}>{additionalSources.length?"合并审核所选公告":notice.trim()?"从已粘贴的公告提取":"读取官网并提取提交日期"}</button>
          {preview && <>
            {!preview.deadline && <p className="notice">没有可自动填入的截止日。请看下方说明，核对原文后填写；若缺公告正文，可粘贴含日期的段落重试。</p>}
            {preview.deadlineEvidence && <p className="muted">模型标出的日期依据 · {preview.deadlineEvidence}</p>}
            <label>待确认的规则与出处<textarea rows={5} maxLength={16000} value={preview.summary} onChange={event=>{
              setPreview({...preview,summary:event.target.value});setConfirmed(false);
            }}/></label>
          </>}
        </details>}
        <label>{competition?"作品提交截止日":"截止日期"}<input name="deadline" type="date" required value={deadline} onChange={event=>{
          setDeadline(event.target.value);setConfirmed(false);
        }}/></label>
        {competition && !url.trim() && <p className="muted">没有官网链接也可以直接自填截止日创建。之后想核对时，可在项目页补充官网公告链接。</p>}
        {reviewRequired && <label className="check"><input type="checkbox" required checked={confirmed} disabled={!deadline}
          onChange={event=>setConfirmed(event.target.checked)}/>我已核对官网公告和{competition?"作品提交截止日":"截止日期"}</label>}
        <button className="primary" disabled={busy || dirty || reviewRequired && !confirmed || additionalSources.length>0 && !url.trim()}>创建项目</button>
      </fieldset>
    </form>
  </section>;
}

function taskBranch(tasks:Task[],root:string) {
  const ids=new Set([root]);
  const children=new Map<string,string[]>();
  for(const task of tasks) {
    if(!task.parentId)continue;
    const siblings=children.get(task.parentId) ?? [];
    siblings.push(task.id);
    children.set(task.parentId,siblings);
  }
  for(const id of ids) {
    for(const child of children.get(id) ?? [])ids.add(child);
  }
  return ids;
}

function ModelConnection({busy,run,notify}: {
  busy:boolean; run:(action:()=>Promise<void>)=>Promise<void>; notify:(text:string)=>void;
}) {
  const [settings,setSettings]=useState<{configured:boolean;model:string}>();
  useEffect(()=>{
    let active=true;
    api<NonNullable<typeof settings>>("/model").then(value=>{if(active)setSettings(value);})
      .catch(()=>{if(active)setSettings({configured:false,model:""});});
    return ()=>{active=false;};
  },[]);
  return <div className="modelConnection">
    <div><small>模型连接</small>
      <strong>{settings?.configured?settings.model:settings?"尚未配置":"读取中…"}</strong>
      {settings && !settings.configured && <p className="muted">双击 setup-ai.bat 完成配置，重启工作台后即可测试。</p>}
    </div>
    {settings?.configured && <button disabled={busy} onClick={()=>void run(async()=>{
      await api("/model/test","POST");
      notify("模型连接成功。已验证文本响应，联网搜索可在相应步骤试用。");
    })}>测试模型连接</button>}
  </div>;
}

function WorkflowReview({step,detail,busy,run,saved,notify}: {
  step:ReviewStep; detail:Detail; busy:boolean; run:(action:()=>Promise<void>)=>Promise<void>;
  saved:(detail:Detail)=>void; notify:(message:string)=>void;
}) {
  const note=detail.workflow.find(item=>item.step===step);
  const activeGoal=detail.workflow.some(item=>item.step==="goal" && !item.stale);
  const [body,setBody]=useState(note?.stale?"":note?.body ?? "");
  const [deadline,setDeadline]=useState("");
  const [deadlineEvidence,setDeadlineEvidence]=useState("");
  const [source,setSource]=useState("");
  const [example,setExample]=useState("");
  const [query,setQuery]=useState(detail.project.title);
  const [track,setTrack]=useState("");
  const [capability,setCapability]=useState({skills:"",evidence:"",gaps:"",dailyMinutes:90,selected:[] as string[]});
  const [options,setOptions]=useState<string[]>([]);
  const [profileReady,setProfileReady]=useState(false);
  useEffect(()=>{let active=true;
    api<typeof capability>("/projects/"+detail.project.id+"/capability").then(data=>{
      if(active){if(data.dailyMinutes)setCapability(data);setProfileReady(true);}
    }).catch(error=>{if(active)notify(error.message);});
    return ()=>{active=false;};
  },[detail.project.id]);
  const [search,setSearch]=useState<SearchResult>();
  const docs=detail.materials.filter(item=>!item.workflow_step);
  const base="/projects/"+detail.project.id+"/workflow/"+step;
  const goalMissing=step==="gap" && !activeGoal;
  const editableLabel=step==="goal"?"赛道与目标":step==="rules"?"待确认的规则":"待确认的差距与建议";
  const searchQuery=query.trim();
  const baiduQuery=searchQuery+(step==="rules"?" 官网 官方通知":" 参赛作品 获奖案例");
  function runSearch() {
    setSearch(undefined);
    void run(async()=>setSearch(await api<SearchResult>(base+"/search","POST",{query:searchQuery})));
  }
  function saveSearch(title:string, text:string) {
    void run(async()=>{
      const result=await api<Detail>("/projects/"+detail.project.id+"/materials","POST",{title,body:text});
      const id=String(result.materials.at(-1)?.id ?? "");
      if(step==="rules")setSource(id);
      else {if(source===id)setSource("");setExample(id);}
      saved(result);
      notify("已存入知识库并选作资料，请核对原文后再发起分析。");
    });
  }
  function reviewSearchUrl(url:string) {
    void run(async()=>{
      const result=await api<RulePreview>("/projects/competition-notice/preview","POST",{
        title:detail.project.title,category:detail.project.category,url
      });
      setBody("来源："+url+"\n\n"+result.summary);
      setDeadline(result.deadline ?? "");
      setDeadlineEvidence(result.deadlineEvidence ?? "");
      notify(result.deadline?"已读取公告正文，请核对日期和依据。":"没有可自动填写的截止日，请看规则说明或粘贴公告段落重试。");
    });
  }
  return <div className="workflowContent">
    {step==="rules" && <p className="muted">选已保存的官网公告或比赛要求，提取期限、评分标准和提交方式。</p>}
    {step==="goal" && <p className="muted">填写参赛赛道、预期目标与当前水平，确认后会作为任务拆解的默认目标。也可以只填赛道，让 AI 生成草稿再改。</p>}
    {step==="gap" && <p className="muted">选择当前作品，按需选择已归档的对标资料，再主动运行差距分析。</p>}
    {step==="gap" && <details open className="sourceSearch"><summary>能力问询与时间预算</summary>
      <p className="muted">按项目记住你的回答。自评仅供参考；没有作品证据时会标为待验证。</p>
      {([['skills','已经会什么'],['evidence','作品证据、资料标题或链接（没有可写暂无）'],['gaps','想补齐什么、哪些事情暂时不做']] as const).map(([key,label])=>
        <label key={key}>{label}<textarea rows={2} maxLength={3000} disabled={busy || !profileReady} value={capability[key]} onChange={e=>setCapability({...capability,[key]:e.target.value})}/></label>)}
      <label>每日可投入分钟<input type="number" min={15} max={480} value={capability.dailyMinutes} disabled={busy || !profileReady} onChange={e=>setCapability({...capability,dailyMinutes:Number(e.target.value)})}/></label>
      <button disabled={busy || !profileReady || !capability.skills.trim()} onClick={()=>void run(async()=>{
        await api("/projects/"+detail.project.id+"/capability","PUT",capability);notify("能力档案已保存，后续拆解会自动读取。");
      })}>保存能力档案</button>
      {[...new Set([...options,...capability.selected])].map(option=><label key={option}><input type="checkbox" checked={capability.selected.includes(option)} disabled={busy} onChange={e=>setCapability({...capability,selected:e.target.checked?[...capability.selected,option]:capability.selected.filter(x=>x!==option)})}/>{option}</label>)}
      {!!options.length && <p className="muted">勾选要补齐的事项，再确认差距。未勾选建议不会作为补齐任务自动加入。</p>}
    </details>}
    {note?.stale===1 && <p className="notice">规则或目标已更新，旧差距结论仅保留在知识库。请重新分析并确认。</p>}
    {goalMissing && <p className="notice">先确认「赛道与目标」，再分析作品差距。</p>}
    {step==="goal" && <div className="workflowSources">
      <label>参赛赛道或方向<input value={track} maxLength={300} disabled={busy}
        placeholder="例如：学习生活方向，面向学生场景的效率工具" onChange={e=>setTrack(e.target.value)}/></label>
      <button disabled={busy || !track.trim()} onClick={()=>void run(async()=>{
        const result=await api<RulePreview>(base+"/preview","POST",{track});
        setBody(result.summary);
        notify("已生成目标草稿，请核对修改后再确认。");
      })}>AI 生成目标草稿</button>
    </div>}
    {step!=="goal" && <section className="sourceSearch">
      <div className="workflowSources">
        <label>联网搜索关键词<input value={query} disabled={busy} maxLength={300} onChange={e=>setQuery(e.target.value)}/></label>
        <button disabled={busy || !searchQuery} onClick={runSearch}>{step==="rules"?"搜索官网与官方通知":"搜索同类作品"}</button>
        {searchQuery && <a className="searchExternal" href={"https://www.baidu.com/s?wd="+encodeURIComponent(baiduQuery)}
          target="_blank" rel="noreferrer">在百度打开</a>}
      </div>
      {search && <>
        {search.engine && <p className="muted">{search.engine} 返回 {search.sources.length} 条候选资料，请核对页面后选择。</p>}
        {search.summary && <details><summary>查看搜索摘要</summary><p className="material">{search.summary}</p></details>}
        <ul className="sourceLinks">{search.sources.map(link=><li key={link.url}>
          <a href={link.url} target="_blank" rel="noreferrer">{link.title || link.url}</a>
          {link.snippet && <details><summary>查看资料摘要</summary><p className="muted">{link.snippet}</p></details>}
          {step==="rules" && <button disabled={busy} onClick={()=>reviewSearchUrl(link.url)}>读取正文并提取截止日</button>}
          {step!=="rules" && search.engine && <button disabled={busy} onClick={()=>saveSearch(link.title,
            "来源："+link.url+"\n\n"+(link.snippet ?? ""))}>选用这条资料</button>}
        </li>)}</ul>
        {step!=="rules" && !search.engine && <button disabled={busy} onClick={()=>saveSearch("同类作品搜索资料",
          search.summary+"\n\n来源\n"+search.sources.map(link=>link.title+" "+link.url).join("\n"))}>确认保存搜索资料</button>}
      </>}
    </section>}
    {step!=="goal" && <div className="workflowSources">
      <label>{step==="rules"?"规则资料":"当前作品"}<select disabled={busy} value={source} onChange={e=>setSource(e.target.value)}>
        <option value="">从项目知识库选择</option>
        {docs.map(item=><option key={item.id} value={item.id}>{item.title}</option>)}
      </select></label>
      {step==="gap" && <label>对标资料（可选）<select disabled={busy} value={example} onChange={e=>setExample(e.target.value)}>
        <option value="">暂不使用对标资料</option>
        {docs.map(item=><option key={item.id} value={item.id}>{item.title}</option>)}
      </select></label>}
      <button disabled={busy || !source || goalMissing || source===example} onClick={()=>void run(async()=>{
        if(step==="gap")await api("/projects/"+detail.project.id+"/capability","PUT",capability);
        const result=await api<RulePreview & {options?:string[]}>(base+"/preview","POST",{
          materialId:Number(source),exampleId:example?Number(example):null
        });
        setBody(result.summary);
        setOptions(result.options ?? []);
        if(step==="rules") {
          setDeadline(result.deadline ?? "");
          setDeadlineEvidence(result.deadlineEvidence ?? "");
        }
        notify("已生成结果，请核对并确认。");
      })}>{step==="rules"?"提取规则":"分析作品差距"}</button>
    </div>}
    <label>{editableLabel}<textarea rows={6} value={body} maxLength={20000} disabled={busy}
      onChange={e=>setBody(e.target.value)} placeholder="可手动填写，也可修改已生成的内容" /></label>
    {step==="rules" && <>
      {deadlineEvidence && <p className="muted">模型标出的日期依据 · {deadlineEvidence}</p>}
      <label>核对项目提交截止日（留空保留 {detail.project.deadline}）
        <input type="date" value={deadline} disabled={busy} onChange={e=>setDeadline(e.target.value)}/></label>
      <details><summary>已知官网链接？读取公告正文</summary>
        <PublicPageImport project={detail.project} busy={busy} run={run} notify={notify} saved={data=>{
          saved(data);
          setSource(String(data.materials.at(-1)?.id ?? ""));
        }}/>
      </details>
    </>}
    <button className="primary" disabled={busy || goalMissing || !body.trim()} onClick={()=>void run(async()=>{
      if(step==="gap")await api("/projects/"+detail.project.id+"/capability","PUT",capability);
      const result=await api<Detail>(base,"PUT",{body,deadline:step==="rules"?deadline:null});
      saved(result);
      notify("已确认并保存到项目知识库。");
    })}>确认并存入知识库</button>
  </div>;
}

const inboxKinds=[["idea","灵感"],["reply","回复消息"],["task","临时待办"],["material","资料"]] as const;
type InterruptSlot={project_id:number;task_id:string;title:string;minutes:number;ends:number};
type InterruptEvent={id:number;project_id:number;task_id:string|null;title:string;scene:string;state:string;remaining_seconds:number;checkpoint:string;resolution:string};
type BufferItem={id:number;title:string;minutes:number;important:number;state:string;discarded_at:string|null;note:string;task_deadline?:string};
type InterruptData={events:InterruptEvent[];slots:InterruptSlot[];buffer:BufferItem[];fixed:{starts:number;ends:number}[];window:{starts:number;ends:number}};
type InterruptPreview={revision:string;branch:string;message:string;next:Partial<InterruptSlot>;placements:InterruptSlot[];deferred:InterruptSlot[]};
const minuteTime=(n:number)=>String(Math.floor(n/60)).padStart(2,"0")+":"+String(n%60).padStart(2,"0");
const timeMinute=(s:string)=>{const [h,m]=s.split(":").map(Number);return h*60+m;};

function InterruptionPanel({project,busy,run,timer,refresh,onSchedule}: {project?:Project;busy:boolean;run:(fn:()=>Promise<void>)=>Promise<void>;timer:ReturnType<typeof usePomodoro>;refresh:()=>Promise<void>;onSchedule:boolean}) {
  const localDay=()=>{const d=new Date();return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");};
  const [day,setDay]=useState(localDay);
  const [data,setData]=useState<InterruptData>(); const [error,setError]=useState("");
  const [title,setTitle]=useState(""); const [urgent,setUrgent]=useState(false);
  const [scene,setScene]=useState("planned");const [taskKey,setTaskKey]=useState("");
  const [checkpoint,setCheckpoint]=useState("");const [minutes,setMinutes]=useState(30);
  const [important,setImportant]=useState(false);const [keepNext,setKeepNext]=useState(true);
  const [finished,setFinished]=useState(()=>minuteTime(new Date().getHours()*60+new Date().getMinutes()));
  const [preview,setPreview]=useState<InterruptPreview>();
  const active=data?.events.find(e=>e.state==="active") ?? data?.events.find(e=>e.state==="resuming");
  const followup=active?.state==="resuming";
  const [now,setNow]=useState(()=>new Date().getHours()*60+new Date().getMinutes());
  const [waitingTooLong,setWaitingTooLong]=useState(false);
  const schedulePrompt=useRef<HTMLDialogElement>(null);
  const capacityPrompt=useRef<HTMLDialogElement>(null);
  const shownOverload=useRef("");
  useEffect(()=>{
    const interval=window.setInterval(()=>{const time=new Date();setNow(time.getHours()*60+time.getMinutes());},15000);
    return ()=>window.clearInterval(interval);
  },[]);
  useEffect(()=>{
    if(onSchedule && active?.state==="active" && !schedulePrompt.current?.open)schedulePrompt.current?.showModal();
  },[onSchedule,active?.id,active?.state]);
  useEffect(()=>{
    if(!active)return;
    const current=new Date();
    setFinished(minuteTime(current.getHours()*60+current.getMinutes()));
    setPreview(undefined);
  },[active?.id,active?.state]);
  useEffect(()=>{
    setWaitingTooLong(false);
    if(!active)return;
    const timeout=window.setTimeout(()=>setWaitingTooLong(true),120000);
    return ()=>window.clearTimeout(timeout);
  },[active?.id,active?.state]);
  useEffect(()=>{let mounted=true;api<InterruptData>("/interruptions/"+day).then(x=>{if(mounted){setData(x);setError("");}}).catch(e=>{if(mounted)setError(e.message);});return()=>{mounted=false;};},[day]);
  const waiting=data?.buffer.filter(x=>x.state==="waiting") ?? [];
  const duration=(item:BufferItem)=>Math.ceil(item.minutes/15)*15;
  const demand=waiting.reduce((sum,x)=>sum+duration(x),0);
  const free:number[]=[];
  if(data && day===localDay())for(let minute=Math.max(data.window.starts,Math.ceil(now/15)*15);minute+15<=data.window.ends;minute+=15){
    if(minute<=1410 && !data.slots.some(s=>minute<s.ends && minute+15>s.minutes)
      && !data.fixed.some(s=>minute<s.ends && minute+15>s.starts))free.push(minute);
  }
  const capacity=free.length*15;
  const urgentByDeadline=(item:BufferItem)=>!!item.task_deadline && item.task_deadline<=day;
  const suggestions=[...waiting].sort((a,b)=>Number(urgentByDeadline(a))-Number(urgentByDeadline(b))
    || a.important-b.important || b.minutes-a.minutes || a.id-b.id);
  const available=new Set(free);
  const fits=suggestions.slice().reverse().every(item=>{
    const length=duration(item)/15;
    const start=free.find(minute=>Array.from({length},(_,i)=>minute+i*15).every(part=>available.has(part)));
    if(start===undefined)return false;
    for(let i=0;i<length;i++)available.delete(start+i*15);
    return true;
  });
  const overload=demand>capacity || !fits;
  const windowEnded=!!data && now>=data.window.ends;
  useEffect(()=>{
    if(!overload || day!==localDay() || schedulePrompt.current?.open)return;
    const key=day+":"+windowEnded;
    if(shownOverload.current===key)return;
    shownOverload.current=key;
    if(!capacityPrompt.current?.open)capacityPrompt.current?.showModal();
  },[overload,day,windowEnded,active?.state]);
  const action=(id:number,action:string)=>void run(async()=>{setData(await api<InterruptData>("/interruptions/buffer/"+id,"POST",{action}));setPreview(undefined);await refresh();});
  return <details className="card" open><summary>突发任务与当日缓冲</summary>
    <dialog ref={schedulePrompt}><p>突发事务处理完了吗？确认后，请判断下一个排期任务是否重要且紧急。</p>
      <form method="dialog"><button>返回处理面板</button><button>稍后决定</button></form>
    </dialog>
    <dialog ref={capacityPrompt}><h3>{windowEnded?"当日缓冲窗口已结束":"当日缓冲容量不足"}</h3>
      <p>请检查下面的取舍建议，再决定哪些事项已经处理、哪些可以舍弃。</p>
      <form method="dialog"><button>查看取舍建议</button></form>
    </dialog>
    <label>记录日期<input type="date" value={day} onChange={e=>{setDay(e.target.value);setData(undefined);setPreview(undefined);}} disabled={busy}/></label>
    {error && <p className="alert">{error}</p>}
    {day===localDay() && <form onSubmit={e=>{e.preventDefault();void run(async()=>{
      const linked=timer.activeFocusTask;const chosen=data?.slots.find(s=>s.project_id+":"+s.task_id===taskKey);
      const focus=urgent && timer.mode==="focus" && timer.running;
      if(focus && !linked)throw new Error("当前番茄钟没有绑定任务。请先暂停并绑定要记录的任务，再提交紧急事项。");
      if(!project && !chosen && !linked)throw new Error("请先选择项目。");
      const result=await api<InterruptData>("/interruptions","POST",{
        projectId:focus?linked!.projectId:urgent && scene==="planned"?chosen?.project_id:project?.id,
        day,title,urgent,scene:focus?"focus":scene,taskId:focus?linked!.taskId:chosen?.task_id,
        started:new Date().getHours()*60+new Date().getMinutes(),remainingSeconds:focus?timer.remaining:0,checkpoint,minutes,important
      });
      if(focus)timer.pauseForInterruption();setData(result);setTitle("");setCheckpoint("");setPreview(undefined);await refresh();
    });}}>
      <label>突发事项<input required maxLength={300} value={title} onChange={e=>setTitle(e.target.value)}/></label>
      <label>等级<select value={urgent?"urgent":"later"} onChange={e=>setUrgent(e.target.value==="urgent")}><option value="later">可暂缓：不打断当前任务</option><option value="urgent">即刻紧急：保存断点并中断</option></select></label>
      <label>预计处理／恢复任务所需分钟<input type="number" min={1} max={480} value={minutes} onChange={e=>setMinutes(Number(e.target.value))}/></label>
      <label><input type="checkbox" checked={important} onChange={e=>setImportant(e.target.checked)}/>属于当前核心目标／重要事项</label>
      {urgent && !(timer.running && timer.mode==="focus") && <><label>当前情况<select value={scene} onChange={e=>setScene(e.target.value)}><option value="planned">当前已排任务尚未启动番茄</option><option value="idle">当前空闲，无被打断任务</option></select></label>
        {scene==="planned" && <label>当前时段的任务<select required value={taskKey} onChange={e=>setTaskKey(e.target.value)}><option value="">选择任务</option>{data?.slots.filter(s=>s.minutes<=now && s.ends>now).map(s=><option key={s.project_id+":"+s.task_id} value={s.project_id+":"+s.task_id}>{s.title}</option>)}</select></label>}</>}
      <label>断点：已完成内容、做到哪步、下一步<textarea rows={2} maxLength={3000} value={checkpoint} onChange={e=>setCheckpoint(e.target.value)}/></label>
      <button disabled={busy || !data || (urgent && !!active)} className="primary">{urgent?"记录紧急事项并暂停当前任务":"加入当日缓冲"}</button>
    </form>}
    {active && <section className="sourceSearch"><h3>{followup?"等待原任务完成":"正在处理突发"}：{active.title}</h3><p className="material">断点：{active.checkpoint || "未填写"} · 剩余 {clock(active.remaining_seconds)}</p>
      {waitingTooLong && (!followup || preview) && <p className="notice">完成比完美更重要。优先保住核心任务，再确认一份可执行的安排。</p>}
      <label>{followup?"原任务实际完成时间":"突发处理完成时间"}<input type="time" value={finished} onChange={e=>{setFinished(e.target.value);setPreview(undefined);}}/></label>
      {!followup && <label>下一个排期任务<select value={keepNext?"keep":"resume"} onChange={e=>{setKeepNext(e.target.value==="keep");setPreview(undefined);}}><option value="keep">重要紧急，保留后续安排（A1/B1）</option><option value="resume">可以暂缓，优先恢复原任务（A2/B2）</option></select></label>}
      <button disabled={busy} onClick={()=>void run(async()=>setPreview(await api<InterruptPreview>("/interruptions/"+active.id+"/preview","POST",{keepNext:!followup && keepNext,finished:timeMinute(finished)})))}>{followup?"原任务已完成，预览后续重排":"预览恢复方案"}</button>
      {preview && <><p>{preview.branch} · {preview.message}</p><p>下一项：{preview.next.title ?? "无"}</p>
        <ul>{preview.placements.map(s=><li key={s.project_id+":"+s.task_id}>{minuteTime(s.minutes)}–{minuteTime(s.ends)} {s.title}</li>)}</ul>
        <p>移入缓冲：{preview.deferred.map(s=>s.title).join("、") || "无新增"}</p>
        <button disabled={busy} onClick={()=>void run(async()=>{setData(await api<InterruptData>("/interruptions/"+active.id+"/confirm","POST",{keepNext:!followup && keepNext,finished:timeMinute(finished),revision:preview.revision}));
          if(!followup && !keepNext && active.scene==="focus" && active.task_id && preview.placements.some(s=>s.project_id===active.project_id && s.task_id===active.task_id)) {
            timer.restoreInterruption({projectId:active.project_id,taskId:active.task_id,title:preview.placements.find(s=>s.task_id===active.task_id)!.title},active.remaining_seconds);
          }setPreview(undefined);await refresh();
        })}>{followup?"确认后续重排":"确认恢复方案"}</button></>}
    </section>}
    {data && <><form onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void run(async()=>{setData(await api<InterruptData>("/interruptions/"+day+"/window","PUT",{start:timeMinute(String(f.get("start"))),end:timeMinute(String(f.get("end")))}));});}} key={day}>
      <label>当日缓冲开始<input type="time" name="start" defaultValue={minuteTime(data.window.starts)} step={900} required/></label>
      <label>当日缓冲结束<input type="time" name="end" defaultValue={minuteTime(data.window.ends)} step={900} required/></label><button disabled={busy}>保存缓冲窗口</button>
    </form><p>待处理 {waiting.length} 项，预计 {demand} 分钟；窗口剩余上限 {capacity} 分钟（实际安排还会避让已有任务）。</p>
      {overload && <div className="alert" role="alert"><strong>需要取舍：容量不足或窗口已结束。</strong>
        <ol>{suggestions.map(item=><li key={item.id}>{item.title} · {item.minutes} 分钟 · {item.important?"重要／核心":"非核心"} · {urgentByDeadline(item)?"截止已到，优先核对":"可暂缓"}{!item.important && !urgentByDeadline(item)?" · 优先考虑舍弃":""}</li>)}</ol></div>}
      {data.buffer.map(item=><details key={item.id}><summary>{item.title} · {item.minutes} 分钟 · {({waiting:"待处理",discarded:"已舍弃",done:"已处理",restored:"已安排"} as Record<string,string>)[item.state]}{item.important?" · 核心／重要":" · 可优先取舍"}</summary>
        <p>{item.note}</p>{item.state==="waiting" && <><button disabled={busy || day!==localDay()} onClick={()=>action(item.id,"arrange")}>安排进当日缓冲空档</button><button disabled={busy} onClick={()=>action(item.id,"done")}>本次已处理</button><button disabled={busy} onClick={()=>{if(window.confirm("舍弃此当日缓冲事项？24 小时内可恢复，原项目任务不会删除。"))action(item.id,"discard");}}>舍弃</button></>}
        {item.state==="discarded" && <><p>舍弃后 24 小时可恢复至原日期，不自动排期。</p><button disabled={busy || Date.now()-Date.parse(item.discarded_at!)>=86400000} onClick={()=>action(item.id,"restore")}>恢复</button></>}
      </details>)}
      <details><summary>本日突发记录与取舍依据</summary>{data.events.map(e=><div key={e.id}><p>{e.title} · {e.state==="active"?"处理中":"已处理"}</p><p className="material">{e.checkpoint}\n{e.resolution}</p></div>)}</details>
    </>}
  </details>;
}
type InboxItem={id:number;title:string;body:string;kind:typeof inboxKinds[number][0]};

function Inbox({project,busy,run,onArchive,onScheduled}: {
  project?:Project; busy:boolean; run:(action:()=>Promise<void>)=>Promise<void>;
  onArchive:()=>Promise<void>;
  onScheduled:()=>Promise<void>;
}) {
  const [items,setItems]=useState<InboxItem[]>([]);
  const [selected,setSelected]=useState<number[]>([]);
  const [scheduled,setScheduled]=useState<{title:string;day:string;start:number}[]>([]);
  const [scheduleMessage,setScheduleMessage]=useState("");
  const [error,setError]=useState("");
  useEffect(()=>{
    let active=true;
    api<typeof items>("/inbox").then(data=>{if(active)setItems(data);})
      .catch(issue=>{if(active)setError(issue.message);});
    return ()=>{active=false;};
  },[]);
  return <div className="two">
    <section className="card"><h2>快速记录</h2>
      <form onSubmit={e=>{
        e.preventDefault();
        const form=e.currentTarget;
        const values=Object.fromEntries(new FormData(form));
        void run(async()=>{setItems(await api<typeof items>("/inbox","POST",values));form.reset();});
      }}>
        <label>标题<input name="title" required /></label>
        <label>补充文字或链接<textarea name="body" rows={4} placeholder="可留空" /></label>
        <label>类别<select name="kind"><option value="">自动识别</option>
          {inboxKinds.map(([kind,label])=><option key={kind} value={kind}>{label}</option>)}
        </select></label>
        <button disabled={busy} className="primary">放入收集箱</button>
      </form>
    </section>
    <section className="card"><h2>收集箱</h2>
      {error && <p className="alert" role="alert">{error}</p>}
      {!items.length && <p className="muted">收集箱为空。</p>}
      {inboxKinds.map(([kind,label])=>{
        const group=items.filter(item=>item.kind===kind);
        if(!group.length)return null;
        return <details key={kind}><summary>{label} · {group.length} 项</summary>
          {group.map((item,index)=><details key={item.id}>
        <summary>{index+1}. {item.title}{selected.includes(item.id)?" · 已勾选":""}</summary>
        <p className="material">{item.body}</p>
        <label>类别<select aria-label={item.title+"的类别"} value={item.kind} disabled={busy} onChange={e=>{
          const kind=e.currentTarget.value;
          void run(async()=>{
            setItems(await api<InboxItem[]>("/inbox/"+item.id+"/kind","PUT",{kind}));
            if(kind==="material")setSelected(ids=>ids.filter(id=>id!==item.id));
          });
        }}>{inboxKinds.map(([value,name])=><option key={value} value={value}>{name}</option>)}</select></label>
        {kind!=="material" && <button type="button" disabled={busy} aria-pressed={selected.includes(item.id)}
          onClick={()=>setSelected(ids=>ids.includes(item.id)?ids.filter(id=>id!==item.id):[...ids,item.id])}>
          {selected.includes(item.id)?"取消安排":"勾选安排"}
        </button>}
        <button disabled={busy || !project} onClick={()=>void run(async()=>{
          setItems(await api<typeof items>("/inbox/"+item.id+"/archive/"+project?.id,"POST"));
          setSelected(ids=>ids.filter(id=>id!==item.id));
          await onArchive();
        })}>{project?"归档至 "+project.title:"先选择项目"}</button>
          </details>)}
        </details>;
      })}
      {(selected.length>0 || scheduleMessage) && <form onSubmit={e=>{
        e.preventDefault();
        if(!project)return;
        const data=new FormData(e.currentTarget);
        const minutes=(name:string)=>{
          const [hours,mins]=String(data.get(name)).split(":").map(Number);
          return hours*60+mins;
        };
        void run(async()=>{
          const result=await api<{items:InboxItem[];assigned:typeof scheduled}>("/inbox/schedule/"+project.id,"POST",{
            startDay:data.get("startDay"),start:minutes("start"),end:minutes("end"),itemIds:selected,
          });
          setItems(result.items);
          setScheduled(result.assigned);
          setSelected(ids=>ids.filter(id=>result.items.some(item=>item.id===id)));
          const remaining=selected.length-result.assigned.length;
          setScheduleMessage(remaining?remaining+" 项找不到空闲缓冲时段，已留在收集箱。":"已安排到日程。");
          if(result.assigned.length)await onScheduled();
        });
      }}>
        <p className="muted">{project?"安排到 "+project.title:"请先选择项目"}。从选定日期起查找最多 14 天，每天最多安排 1 项，每项 15 分钟。</p>
        <label>从哪天开始<input name="startDay" type="date" defaultValue={today} min={today} max={project?.deadline} required /></label>
        <label>缓冲开始<input name="start" type="time" defaultValue="17:00" min="07:30" step="900" required /></label>
        <label>缓冲结束<input name="end" type="time" defaultValue="18:00" min="07:45" step="900" required /></label>
        <button className="primary" disabled={busy || !project || !selected.length}>安排已勾选的 {selected.length} 项</button>
        {scheduleMessage && <p role="status">{scheduleMessage}</p>}
        {scheduled.length>0 && <ul>{scheduled.map(({title,day,start})=><li key={day}>{day} {String(Math.floor(start/60)).padStart(2,"0")}:{String(start%60).padStart(2,"0")} · {title}</li>)}</ul>}
      </form>}
    </section>
  </div>;
}

const pendingDragType="application/x-workbench-pending-task";
type PendingItem={id:string;title:string;material_title?:string;deadline?:string;overdue?:number};
type PoolPlacement={itemId:string;parentId:string;day:string};

function PendingPool({project,busy,run,onAssigned,compact=false,placement}: {
  project?:Project; busy:boolean; run:(action:()=>Promise<void>)=>Promise<void>;
  onAssigned:(data:Detail)=>void|Promise<void>; compact?:boolean;
  placement?:{tasks:Task[];stage:(items:PendingItem[],suggestions:PoolPlacement[])=>void};
}) {
  const [items,setItems]=useState<PendingItem[]>([]);
  const [error,setError]=useState("");
  const [suggestions,setSuggestions]=useState<PoolPlacement[]>();
  const visible=items.filter(item=>!placement?.tasks.some(task=>task.id==="pool-"+item.id));
  const path="/projects/"+project?.id+"/unassigned";
  useEffect(()=>{
    if(!project) return;
    let active=true;
    api<typeof items>(path).then(data=>{if(active)setItems(data);})
      .catch(issue=>{if(active)setError(issue.message);});
    return ()=>{active=false;};
  },[path,project]);
  return <section className="card narrow">
    <h2>{compact?"待分配任务":project?.title ?? "待分配池"}</h2>
    <p className="muted">{placement?"拖动任务标题到排期草稿的任务名或日期格，即可插入为下级任务。确认应用后才会从池中移除。":compact?"当前项目的无日期任务。可拖到日期，也可直接选日期。":"这里放已经确认、还没选执行日期的任务。选日期后会出现在当天待排区。"}</p>
    {error && <p className="alert" role="alert">{error}</p>}
    {placement && visible.length>0 && <div className="poolForm">
      <button disabled={busy || !placement.tasks.length} onClick={()=>void run(async()=>{
        setSuggestions(undefined);
        const response=await api<{items:PoolPlacement[]}>(path+"/suggest","POST",{tasks:placement.tasks});
        setSuggestions(Array.isArray(response.items)?response.items.filter(item=>item && typeof item.day==="string") : []);
      })}>AI 自动插入建议</button>
      {suggestions && <div>
        {suggestions.length?<ul>{suggestions.map((suggestion,index)=><li key={index}>
          {visible.find(item=>item.id===suggestion.itemId)?.title ?? "无法匹配的事项"} → {placement.tasks.find(task=>task.id===suggestion.parentId)?.title ?? "无法匹配的任务"} · {suggestion.day}
        </li>)}</ul>:<p className="muted">没有可用的插入建议。</p>}
        {suggestions.length>0 && <button className="primary" disabled={busy} onClick={()=>{
          placement.stage(visible,suggestions);
          setSuggestions(undefined);
        }}>插入草稿</button>}
      </div>}
    </div>}
    {!compact && <form className="poolForm" onSubmit={e=>{
      e.preventDefault();
      const form=e.currentTarget, fields=new FormData(form);
      void run(async()=>{setItems(await api<typeof items>(path,"POST",{title:fields.get("title"),deadline:fields.get("deadline")}));form.reset();});
    }}>
      <label>新任务<input name="title" required disabled={!project || busy}/></label>
      <label>截止日期（可选）<input name="deadline" type="date" disabled={!project || busy}/></label>
      <button disabled={!project || busy}>加入待分配池</button>
    </form>}
    {visible.map(item=><form className="poolForm" key={item.id} onSubmit={e=>{
      e.preventDefault();
      const date=new FormData(e.currentTarget).get("day");
      void run(async()=>{
        await onAssigned(await api<Detail>(path+"/"+item.id,"PUT",{day:date}));
        setItems(current=>current.filter(entry=>entry.id!==item.id));
      });
    }}>
      <div className={compact?"poolDrag":undefined} draggable={compact && !busy} onDragStart={event=>{
        event.dataTransfer.effectAllowed="move";
        event.dataTransfer.setData(pendingDragType,item.id);
        event.dataTransfer.setData("application/x-workbench-pending-detail",JSON.stringify({...item,projectId:project?.id}));
      }}>
        <strong>{compact?"⠿ ":""}{item.title}</strong>{item.material_title && <small>来源：{item.material_title}</small>}</div>
      {item.deadline && <small className={item.overdue?"urgent":"muted"}>截止 {item.deadline}{item.overdue?" · 已超过 3 天未分配":""}</small>}
      <label>执行日期<input name="day" type="date" max={item.deadline ?? undefined} required disabled={busy}/></label>
      <button className="primary" disabled={busy}>安排到这一天</button>
      {!compact && <button type="button" className="danger" disabled={busy} onClick={()=>{
        if(!window.confirm("删除「"+item.title+"」？删除后无法恢复。")) return;
        void run(async()=>{setItems(await api<typeof items>(path+"/"+item.id,"DELETE"));});
      }}>删除</button>}
    </form>)}
    {project && !visible.length && <p className="empty">当前没有待分配事项。</p>}
  </section>;
}

function MaterialEditor({path,busy,run,saved,notify}: {
  path:string;busy:boolean;run:(action:()=>Promise<void>)=>Promise<void>;saved:(detail:Detail)=>void;notify:(message:string)=>void;
}) {
  const [title,setTitle]=useState("");
  const [body,setBody]=useState("");
  return <details className="knowledgeModule" open>
    <summary>新建资料</summary>
    <form onSubmit={event=>{
      event.preventDefault();
      void run(async()=>{
        saved(await api<Detail>(path+"/materials","POST",{title,body}));
        setTitle("");setBody("");notify("资料已保存。");
      });
    }}>
      <label>资料标题<input name="title" required maxLength={200} value={title} disabled={busy}
        onChange={event=>setTitle(event.target.value)}/></label>
      <button type="button" disabled={busy || !title.trim()} onClick={()=>{
        if(body.trim() && !window.confirm("用新生成的草稿替换当前正文？"))return;
        void run(async()=>{
          const draft=await api<MarkdownDraft>(path+"/materials/draft","POST",{title});
          setBody(draft.body);
          notify("AI 正文草稿已填入，请核对后保存。");
        });
      }}>按标题生成正文</button>
      <label>正文<textarea name="body" rows={5} placeholder="在这里输入正文，或从标题生成草稿。"
        value={body} required disabled={busy} onChange={event=>setBody(event.target.value)}/></label>
      <button className="primary" disabled={busy || !title.trim() || !body.trim()}>保存资料</button>
    </form>
  </details>;
}

function MaterialArchive({detail,busy,run,saved}: {
  detail:Detail;busy:boolean;run:(action:()=>Promise<void>)=>Promise<void>;saved:(detail:Detail)=>void;
}) {
  const [dragging,setDragging]=useState(false);
  const dragType="application/x-workbench-material";
  const path="/projects/"+detail.project.id+"/materials/";
  const topics=new Map<string,Map<string,Detail["materials"]>>();
  for(const item of detail.materials) {
    const topic=item.topic || "", kind=item.kind || "";
    const kinds=topics.get(topic) ?? new Map<string,Detail["materials"]>();
    kinds.set(kind,[...(kinds.get(kind) ?? []),item]);
    topics.set(topic,kinds);
  }
  function dropTarget(topic:string,kind:string):React.HTMLAttributes<HTMLElement> {
    return {
      className:dragging?"archiveDropTarget":undefined,
      onDragOver:event=>{
        if(busy || !event.dataTransfer.types.includes(dragType))return;
        event.preventDefault();
        event.dataTransfer.dropEffect="move";
      },
      onDrop:event=>{
        if(busy || !event.dataTransfer.types.includes(dragType))return;
        event.preventDefault();
        setDragging(false);
        const [owner,materialId]=event.dataTransfer.getData(dragType).split(":").map(Number);
        const item=detail.materials.find(entry=>entry.id===materialId);
        if(owner!==detail.project.id || !item || (topic===(item.topic ?? "") && kind===(item.kind ?? "")))return;
        void run(async()=>saved(await api<Detail>(path+materialId+"/archive","PUT",{topic,kind})));
      }
    };
  }
  return <details className="knowledgeModule">
    <summary>资料归档 · {detail.materials.length} 份</summary>
    <p className="muted">{detail.project.category} / {detail.project.title} / 主题 / 资料类型</p>
    {detail.materials.length>0 && <p className="muted">拖动资料标题到主题或资料类型。拖到主题标题时，资料会进入该主题的未分类型。</p>}
    {dragging && !topics.has("") && <div {...dropTarget("","")}>移回未分主题</div>}
    {[...topics].map(([topic,kinds])=><details key={topic} open={topics.size===1 || undefined}>
      <summary {...dropTarget(topic,"")}>{topic || "未分主题"}</summary>
      {[...kinds].map(([kind,materials])=><details key={kind} open={kinds.size===1 || undefined}>
        <summary {...dropTarget(topic,kind)}>{kind || "未分类型"} · {materials.length} 份</summary>
        {materials.map(item=><details key={item.id}>
          <summary draggable={!busy} className="archiveDrag"
            onDragStart={event=>{
              event.dataTransfer.effectAllowed="move";
              event.dataTransfer.setData(dragType,detail.project.id+":"+item.id);
              setDragging(true);
            }} onDragEnd={()=>setDragging(false)}>{item.title}{item.stale===1?" · 待重新确认":""}</summary>
          {item.source_url && <a href={item.source_url} target="_blank" rel="noreferrer">查看原文</a>}
          <p className="material">{item.body}</p>
          <form onSubmit={event=>{
            event.preventDefault();
            const data=new FormData(event.currentTarget);
            void run(async()=>saved(await api<Detail>(
              path+item.id+"/archive","PUT",
              {topic:data.get("topic"),kind:data.get("kind")})));
          }}>
            <label>主题<input name="topic" defaultValue={item.topic ?? ""} maxLength={80} disabled={busy}/></label>
            <label>资料类型<input name="kind" defaultValue={item.kind ?? ""} maxLength={80} disabled={busy}/></label>
            <button disabled={busy}>保存归档位置</button>
          </form>
          <button type="button" className="danger" disabled={busy} onClick={()=>{
            const file=detail.files?.some(entry=>entry.material_id===item.id);
            const warning=item.workflow_step?" 这也会移除此步骤的已确认内容。":"";
            if(!window.confirm("删除知识库资料「"+item.title+"」？删除后无法恢复。"+warning+
              (file?" 上传的原文件仍保留在项目文件区。":"")))return;
            void run(async()=>saved(await api<Detail>(path+item.id,"DELETE")));
          }}>删除资料</button>
        </details>)}
      </details>)}
    </details>)}
  </details>;
}

function AssistantPlan({detail, busy, run, onConfirmed, notify, openBreakdown}: {
  detail?: Detail; busy: boolean; run: (action:()=>Promise<void>)=>Promise<void>;
  onConfirmed: (detail:Detail, date:string|undefined, hasUndated:boolean)=>void; notify: (message:string)=>void;
  openBreakdown:()=>void;
}) {
  const [materialId,setMaterialId] = useState(0);
  const [extra,setExtra]=useState<number[]>([]);
  const [items,setItems] = useState<(PlanItem & {key:string})[]>([]);
  const [batch,setBatch] = useState(()=>crypto.randomUUID());
  const [emptyPlan,setEmptyPlan]=useState(false);
  const path = "/projects/"+detail?.project.id+"/assistant";
  const patch = (key:string, change:Partial<PlanItem>) => {
    setItems(items.map(item=>item.key===key?{...item,...change}:item));
  };
  return <section className="card narrow">
    <h2>资料转待办</h2>
    <p className="muted">选择最多五份资料。先核对待办和来源，再确认写入排期。</p>
    <label className="goal">资料<select value={materialId || ""} disabled={busy} onChange={e=>{
      if(items.length && !window.confirm("切换资料会清空当前待确认列表，继续吗？")) return;
      setMaterialId(Number(e.target.value));
      setExtra([]);
      setItems([]);
      setEmptyPlan(false);
      setBatch(crypto.randomUUID());
    }}>
      <option value="">选择当前项目的知识库资料</option>
      {detail?.materials.map(item=><option key={item.id} value={item.id}>{item.title}</option>)}
    </select></label>
    {materialId>0 && (detail?.materials.length ?? 0)>1 && <details><summary>补充资料 · {extra.length} 份</summary>
      {detail?.materials.filter(item=>item.id!==materialId && !item.stale).map(item=><label className="check" key={item.id}>
        <input type="checkbox" checked={extra.includes(item.id)} disabled={busy || (extra.length>=4 && !extra.includes(item.id))}
          onChange={event=>{setExtra(current=>event.target.checked?[...current,item.id]:current.filter(id=>id!==item.id));
            setItems([]);setEmptyPlan(false);setBatch(crypto.randomUUID());}}/>{item.title}
      </label>)}
    </details>}
    {!detail?.materials.length && <p className="muted">请先在知识库录入资料。</p>}
    <div className="actions">
      <button disabled={busy || !materialId} onClick={()=>{
        if(items.length && !window.confirm("重新识别会替换当前待确认列表，继续吗？")) return;
        void run(async()=>{
          const result=await api<{items:PlanItem[]}>(path+"/preview","POST",{materialId,materialIds:extra});
          setEmptyPlan(result.items.length===0);
          setItems(result.items.map(item=>({...item,key:crypto.randomUUID()})));
          setBatch(crypto.randomUUID());
          notify(result.items.length?"请核对识别结果。":"这份资料中未识别到已有计划。");
        });
      }}>识别已有计划</button>
      <button disabled={busy || !materialId || items.length>=100} onClick={()=>setItems([...items,{key:crypto.randomUUID(),title:"",day:null}])}>＋ 手动加一条</button>
    </div>
    {emptyPlan && <p className="notice">如果这是赛事公告或需求文档，可以先生成新任务。 <button
      disabled={busy} onClick={openBreakdown}>去 AI 拆解</button></p>}
    {items.length>0 && <form onSubmit={e=>{
      e.preventDefault();
      void run(async()=>{
        const confirmed=await api<Detail>(path+"/confirm","POST",{
          materialId,batch,items:items.map(({key,evidence,...item})=>item)
        });
        const first=items.flatMap(item=>item.day?[item.day]:[]).sort()[0];
        const hasUndated=items.some(item=>!item.day);
        setItems([]);
        setBatch(crypto.randomUUID());
        onConfirmed(confirmed,first,hasUndated);
      });
    }}>
      {items.map(item=><div className="planRow" key={item.key}>
        <small>{!item.day?"无日期 · 待分配池":item.start!=null && item.end!=null?"固定时段":"有日期 · 当天待排"}</small>
        {(item.evidence || item.sourceId) && <small>{detail?.materials.find(source=>source.id===item.sourceId)?.title} {item.evidence}</small>}
        <label>任务<input required disabled={busy} value={item.title} onChange={e=>patch(item.key,{title:e.target.value})}/></label>
        <label>截止日期（可选）<input type="date" disabled={busy} value={item.deadline ?? ""} onChange={e=>patch(item.key,{deadline:e.target.value || undefined})}/></label>
        <label>执行日期<input type="date" disabled={busy} value={item.day ?? ""} onChange={e=>patch(item.key,e.target.value?
          {day:e.target.value}:{day:null,start:undefined,end:undefined})}/></label>
        {item.day && <div className="actions">
          <label>开始时间<select disabled={busy} value={item.start ?? ""} onChange={e=>{
            const start=e.target.value?Number(e.target.value):undefined;
            patch(item.key,{start,end:start!=null && item.end!=null && item.end>start?item.end:undefined});
          }}>
            <option value="">待排</option>{quarterHours.map(minutes=><option value={minutes} key={minutes}>{time(minutes)}</option>)}
          </select></label>
          <label>结束时间<select disabled={busy || item.start==null} value={item.end ?? ""} onChange={e=>
            patch(item.key,{end:e.target.value?Number(e.target.value):undefined})}>
            <option value="">请选择</option>{[...quarterHours,1440].filter(minutes=>minutes>(item.start ?? 1440))
              .map(minutes=><option value={minutes} key={minutes}>{time(minutes)}</option>)}
          </select></label></div>}
        <button type="button" disabled={busy} onClick={()=>setItems(items.filter(entry=>entry.key!==item.key))}>移除</button>
      </div>)}
      {items.some(item=>!item.day) && <p className="muted">没有执行日期的任务，确认后会进入项目的待分配池。</p>}
      <button className="primary" disabled={busy || items.some(item=>item.start!=null && item.end==null)}>确认任务</button>
    </form>}
  </section>;
}

function TimetableImport({anchor,busy,run,setNotice,onImported}: {
  anchor:string;busy:boolean;run:(action:()=>Promise<void>)=>Promise<void>;
  setNotice:(message:string)=>void;onImported:()=>void|Promise<void>;
}) {
  const [scheduleImport,setScheduleImport]=useState<{startDay:string;weeks:number;items:ScheduleItem[]}>();
  return <details className="sourceSearch">
    <summary>从图片导入课表（需要视觉模型）</summary>
    <form className="poolForm" onChange={()=>setScheduleImport(undefined)} onSubmit={e=>{
      e.preventDefault();
      const form=e.currentTarget, data=new FormData(form);
      setScheduleImport(undefined);
      void run(async()=>{
        const result=await api<{items:ScheduleItem[];startDay:string;weeks:number}>("/schedule/ocr","POST",data);
        const items=result.items.map(item=>({...item,firstWeek:item.firstWeek ?? 1,lastWeek:item.lastWeek ?? result.weeks}));
        setScheduleImport({...result,items});
        setNotice("已识别 "+result.items.length+" 条课程，请核对后导入。");
      });
    }}>
      <label>课表截图<input type="file" name="file" required disabled={busy} accept=".png,.jpg,.jpeg"/></label>
      <label>第 1 周日期<input type="date" name="startDay" required disabled={busy} defaultValue={anchor}/></label>
      <label>学期总周数<input type="number" name="weeks" min="1" max="30" defaultValue="18" disabled={busy}/></label>
      <button disabled={busy}>识别课表</button>
    </form>
    {scheduleImport && <form onSubmit={e=>{
      e.preventDefault();
      void run(async()=>{
        const result=await api<{added:number;skipped:number}>("/schedule/import","POST",scheduleImport);
        setScheduleImport(undefined);
        await onImported();
        setNotice("课表已导入："+result.added+" 个固定时段"
          +(result.skipped?"，"+result.skipped+" 个因已过期或时间冲突跳过。":"。"));
      });
    }}>
      <p className="muted">第 1 周按 {scheduleImport.startDay} 所在周的周一计算，共 {scheduleImport.weeks} 周。图上只有节次时，请填学校的实际起止时刻；同一节次会同步。</p>
      <p className="muted">识别不到起始周或结束周时，分别预填第 1 周或学期最后一周。导入前请核对。</p>
      {scheduleImport.items.map((item,index)=>{
        function editSchedule(change:Partial<ScheduleItem>,samePeriod=false) {
          setScheduleImport(current=>current && {...current,items:current.items.map((entry,i)=>
            i===index || (samePeriod && item.firstPeriod!=null && item.lastPeriod!=null &&
              entry.firstPeriod===item.firstPeriod && entry.lastPeriod===item.lastPeriod)?
              {...entry,...change}:entry)});
        }
        const issues=[
          !item.title.trim()?"请填写课程名称。":"",
          item.start==null || item.end==null || item.start<450 || item.start>=item.end
            ?"请填写 07:30–24:00 内有效的起止时间。":"",
          item.firstWeek==null || item.lastWeek==null || item.firstWeek<1 ||
            item.firstWeek>item.lastWeek || item.lastWeek>scheduleImport.weeks
            ?"请核对起始周和结束周，两者都需在学期周数内。":""
        ].filter(Boolean);
        return <div className="planRow" key={index}>
          <label>课程<input required value={item.title} disabled={busy} onChange={e=>editSchedule({title:e.target.value})}/></label>
          <label>星期<select value={item.weekday} disabled={busy} onChange={e=>editSchedule({weekday:Number(e.target.value)})}>
            {Array.from("一二三四五六日",(value,i)=><option key={i} value={i+1}>周{value}</option>)}
          </select></label>
          {item.firstPeriod && <small>第 {item.firstPeriod}–{item.lastPeriod ?? item.firstPeriod} 节</small>}
          <label>开始时间<input type="time" min="07:30" required value={item.start==null?"":time(item.start)}
            disabled={busy} onChange={e=>editSchedule({start:parseClock(e.target.value)},true)}/></label>
          <label>结束时间<input type="time" required value={item.end==null?"":time(item.end===1440?0:item.end)}
            disabled={busy} onChange={e=>{
              const end=parseClock(e.target.value);
              editSchedule({end:end===0?1440:end},true);
            }}/></label>
          <label>起始周<input type="number" min={1} max={scheduleImport.weeks} value={item.firstWeek ?? ""}
            required placeholder="1"
            disabled={busy} onChange={e=>editSchedule({firstWeek:e.target.valueAsNumber || undefined})}/></label>
          <label>结束周<input type="number" min={item.firstWeek ?? 1} max={scheduleImport.weeks}
            value={item.lastWeek ?? ""} required disabled={busy}
            onChange={e=>editSchedule({lastWeek:e.target.valueAsNumber || undefined})}/></label>
          <button type="button" disabled={busy} onClick={()=>setScheduleImport({...scheduleImport,
            items:scheduleImport.items.filter((_,i)=>i!==index)})}>移除</button>
          {issues.length>0 && <small className="urgent">{issues.join(" ")}</small>}
        </div>;
      })}
      <button className="primary" disabled={busy || !scheduleImport.items.length ||
        scheduleImport.items.some(item=>!item.title.trim() || item.start==null || item.end==null || item.start<450 || item.start>=item.end ||
          item.firstWeek==null || item.lastWeek==null || item.firstWeek<1 || item.firstWeek>item.lastWeek ||
          item.lastWeek>scheduleImport.weeks)}>导入为固定时段</button>
      <button type="button" disabled={busy} onClick={()=>setScheduleImport(undefined)}>取消</button>
    </form>}
  </details>;
}

const pomodoroModes = {focus:"专注", short:"短休息", long:"长休息"} as const;
type PomodoroMode = keyof typeof pomodoroModes;
type FocusTask = {projectId:number;taskId:string;title:string};
type FocusLog = {task:FocusTask;minutes:number};
const clock=(seconds:number)=>Math.floor(seconds/60)+":"+String(seconds%60).padStart(2,"0");
const clampMinutes=(value:string,min:number,max:number,fallback:number)=>{
  const parsed=Math.round(Number(value));
  return Number.isFinite(parsed)?Math.min(max,Math.max(min,parsed)):fallback;
};
const baseTitle=document.title;

function usePomodoro() {
  const [focusMinutes,setFocusMinutes]=useState(25);
  const [shortMinutes,setShortMinutes]=useState(5);
  const [longMinutes,setLongMinutes]=useState(15);
  const [mode,setMode]=useState<PomodoroMode>("focus");
  const [running,setRunning]=useState(false);
  const [remaining,setRemaining]=useState(25*60);
  const [endAt,setEndAt]=useState(0);
  const [doneToday,setDoneToday]=useState(()=>Number(localStorage.getItem("pomodoro:"+today))||0);
  const [linkedTask,setLinkedTask]=useState<FocusTask|null>(null);
  const focusTask=useRef<FocusTask|null|undefined>(undefined);
  const restoring=useRef(false);
  const [pendingLogs,setPendingLogs]=useState<FocusLog[]>([]);
  const audio=useRef<AudioContext|null>(null);
  const duration=mode==="focus"?focusMinutes:mode==="short"?shortMinutes:longMinutes;

  useEffect(()=>{
    if(restoring.current){restoring.current=false;return;}
    if(!running){
      setRemaining(duration*60);
      focusTask.current=undefined;
    }
  },[duration,mode]);

  useEffect(()=>{
    if(!running)return;
    const label=pomodoroModes[mode];
    const id=window.setInterval(()=>{
      const left=Math.max(0,Math.round((endAt-Date.now())/1000));
      setRemaining(left);
      document.title=clock(left)+" · "+label+" · "+baseTitle;
      if(left<=0){
        window.clearInterval(id);
        setRunning(false);
        setEndAt(0);
        document.title=baseTitle;
        chime(mode!=="focus");
        try{
          if("Notification" in window && Notification.permission==="granted")
            new Notification(mode==="focus"?"专注完成":"休息结束",
              {body:mode==="focus"?"休息一下吧。":"准备下一个番茄。"});
        }catch{}
        if(mode==="focus"){
          const next=doneToday+1;
          setDoneToday(next);
          try{localStorage.setItem("pomodoro:"+today,String(next));}catch{}
          const task=focusTask.current;
          if(task)setPendingLogs(logs=>[...logs,{task,minutes:focusMinutes}]);
          setMode(next%4===0?"long":"short");
        }else setMode("focus");
      }
    },250);
    return()=>window.clearInterval(id);
  },[running,endAt,mode,focusMinutes,doneToday]);

  function primeAudio(){
    try{
      audio.current??=new AudioContext();
      void audio.current.resume();
    }catch{}
  }
  function chime(focusEnded:boolean){
    const context=audio.current;
    if(!context)return;
    try{
      const now=context.currentTime;
      (focusEnded?[660,880,660]:[520,660]).forEach((frequency,index)=>{
        const oscillator=context.createOscillator(),gain=context.createGain();
        oscillator.frequency.value=frequency;
        gain.gain.setValueAtTime(0.0001,now+index*0.3);
        gain.gain.exponentialRampToValueAtTime(0.22,now+index*0.3+0.04);
        gain.gain.exponentialRampToValueAtTime(0.0001,now+index*0.3+0.55);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start(now+index*0.3);
        oscillator.stop(now+index*0.3+0.6);
      });
    }catch{}
  }
  function toggleTimer(){
    if(running){
      setRunning(false);
      setEndAt(0);
      document.title=baseTitle;
      return;
    }
    primeAudio();
    try{ if("Notification" in window && Notification.permission==="default")void Notification.requestPermission(); }catch{}
    const seconds=remaining>0?remaining:duration*60;
    if(focusTask.current===undefined)focusTask.current=linkedTask;
    setRemaining(seconds);
    setEndAt(Date.now()+seconds*1000);
    setRunning(true);
  }
  function resetTimer(){
    focusTask.current=undefined;
    setRunning(false);
    setEndAt(0);
    document.title=baseTitle;
    setRemaining(duration*60);
  }
  function skipPhase(){
    setRunning(false);
    setEndAt(0);
    document.title=baseTitle;
    setMode(mode==="focus"?"short":"focus");
  }
  function pauseForInterruption(){
    const seconds=running?Math.max(0,Math.ceil((endAt-Date.now())/1000)):remaining;
    setRemaining(seconds);setRunning(false);setEndAt(0);document.title=baseTitle;
  }
  function restoreInterruption(task:FocusTask,seconds:number){
    restoring.current=mode!=="focus";
    setMode("focus");setLinkedTask(task);focusTask.current=task;setRunning(false);setEndAt(0);
    setRemaining(seconds);document.title=baseTitle;
  }
  return {focusMinutes,setFocusMinutes,shortMinutes,setShortMinutes,longMinutes,setLongMinutes,
    mode,setMode,running,remaining,duration,doneToday,linkedTask,setLinkedTask,pendingLog:pendingLogs[0],
    dismissLog:()=>setPendingLogs(logs=>logs.slice(1)),
    activeFocusTask:focusTask.current,toggleTimer,resetTimer,skipPhase,pauseForInterruption,restoreInterruption};
}

function PomodoroPage({state,busy,run,setNotice}: {
  state:ReturnType<typeof usePomodoro>; busy:boolean;
  run:(action:()=>Promise<void>)=>Promise<void>; setNotice:(message:string)=>void;
}) {
  const [tasks,setTasks]=useState<DayTask[]>([]);
  useEffect(()=>{
    let active=true;
    api<DayTask[]>("/day/"+today).then(data=>{if(active)setTasks(data);}).catch(()=>{});
    return()=>{active=false;};
  },[]);
  const linked=state.linkedTask;
  const pendingLog=state.pendingLog;
  const ring=2*Math.PI*96;
  const progress=state.duration>0?state.remaining/(state.duration*60):1;
  const record=()=>{
    if(!pendingLog)return;
    const {task,minutes}=pendingLog;
    void run(async()=>{
      const logs=await api<{task_id:string;day:string;kind:string;minutes:number}[]>(
        "/projects/"+task.projectId+"/time-log");
      const existing=logs.find(entry=>entry.task_id===task.taskId && entry.day===today);
      await api("/projects/"+task.projectId+"/time-log","PUT",{
        taskId:task.taskId,day:today,kind:existing?.kind??"番茄钟",
        minutes:(existing?.minutes??0)+minutes});
      state.dismissLog();
      setNotice("已把 "+minutes+" 分钟记入「"+task.title+"」的时间日志。");
    });
  };
  return <div className="two">
    <section className="card">
      <h2>专注任务与时长</h2>
      <form onSubmit={event=>event.preventDefault()}>
        <label>绑定的任务
          <select value={linked?linked.projectId+":"+linked.taskId:""} disabled={busy} onChange={event=>{
            const key=event.target.value;
            if(!key){state.setLinkedTask(null);return;}
            const task=tasks.find(item=>item.project_id+":"+item.id===key);
            state.setLinkedTask(task?{projectId:task.project_id,taskId:task.id,title:task.title}:null);
          }}>
            <option value="">不绑定，只计番茄数</option>
            {tasks.map(task=><option key={task.project_id+":"+task.id} value={task.project_id+":"+task.id}>
              {task.minutes!=null?time(task.minutes)+" ":""}{task.title} · {task.project_title}</option>)}
          </select>
        </label>
        <p className="muted">绑定后，每完成一个专注番茄可把时长记入该任务当天的时间日志，复盘统计会用到。同一天多次记录会累加。</p>
        <div className="pomodoroSettings">
          <label>专注分钟<input type="number" min={5} max={120} value={state.focusMinutes} disabled={state.running||busy}
            onChange={event=>state.setFocusMinutes(clampMinutes(event.target.value,5,120,25))}/></label>
          <label>短休息<input type="number" min={1} max={60} value={state.shortMinutes} disabled={state.running||busy}
            onChange={event=>state.setShortMinutes(clampMinutes(event.target.value,1,60,5))}/></label>
          <label>长休息<input type="number" min={5} max={90} value={state.longMinutes} disabled={state.running||busy}
            onChange={event=>state.setLongMinutes(clampMinutes(event.target.value,5,90,15))}/></label>
        </div>
        <p className="muted">调整时长会重置未开始的计时。番茄数按天记录在本机浏览器里。</p>
      </form>
    </section>
    <section className="card pomodoroCard">
      <div className="modeTabs">
        {(Object.keys(pomodoroModes) as PomodoroMode[]).map(key=>
          <button key={key} className={state.mode===key?"active":""} disabled={state.running}
            onClick={()=>state.setMode(key)}>{pomodoroModes[key]}</button>)}
      </div>
      <div className="pomodoroRing" data-mode={state.mode}>
        <svg viewBox="0 0 220 220" aria-hidden="true">
          <circle className="ringTrack" cx="110" cy="110" r="96"/>
          <circle className="ringFill" cx="110" cy="110" r="96" strokeDasharray={ring}
            strokeDashoffset={ring*(1-progress)}/>
        </svg>
        <div className="ringCenter">
          <strong className="ringTime">{clock(state.remaining)}</strong>
          <small>{state.running?"进行中":state.remaining>=state.duration*60?"准备开始":"已暂停"}</small>
        </div>
      </div>
      <div className="actions pomodoroActions">
        <button className="primary" disabled={busy} onClick={state.toggleTimer}>
          {state.running?"暂停":state.remaining>0&&state.remaining<state.duration*60?"继续":"开始"}
        </button>
        <button disabled={busy} onClick={state.resetTimer}>重置</button>
        <button disabled={busy} onClick={state.skipPhase}>跳过本轮</button>
      </div>
      <p className="muted">今日已完成 {state.doneToday} 个番茄 · 每 4 个番茄后建议长休息。切到其他页面计时不会中断，标题栏会显示剩余时间。</p>
      {pendingLog!=null && <div className="notice pomodoroLog">
        <p>完成 {pendingLog.minutes} 分钟专注：「{pendingLog.task.title}」。</p>
        <button className="primary" disabled={busy} onClick={record}>记入时间日志</button>
        <button disabled={busy} onClick={state.dismissLog}>跳过记录</button>
      </div>}
    </section>
  </div>;
}

function MonthOverview({month, setMonth, openDay, dropOn,children}: {
  month: string; setMonth: (month: string) => void; openDay: (day: string) => void;
  dropOn:(day:string)=>React.HTMLAttributes<HTMLElement>;children:React.ReactNode;
}) {
  const [result, setResult] = useState<{month:string;tasks:MonthTask[];fixed:{day:string;blocks:number}[]}>();
  const [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    setError("");
    Promise.all([api<MonthTask[]>("/month/"+month),api<{day:string;blocks:number}[]>("/month/"+month+"/fixed")])
      .then(([tasks,fixed]) => {if(current)setResult({month,tasks,fixed});})
      .catch(issue => {if(current)setError(issue.message);});
    return () => {current=false;};
  }, [month]);
  const [expandedWeeks,setExpandedWeeks]=useState<string[]>([]);
  const tasks = result?.month === month
    ? result.tasks.filter(task=>task.parent_id || !task.id.startsWith("assistant-inbox-"))
    : [];
  const fixedCounts=new Map((result?.month===month?result.fixed:[]).map(item=>[item.day,item.blocks]));
  const first = month + "-01";
  const next = new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),1)).toISOString().slice(0,10);
  const offset = (new Date(first+"T00:00:00Z").getUTCDay()+6)%7;
  const weeks = Math.ceil((offset+delta(first,next))/7);
  return <section className="card">
    <div className="sectionHead">
      <div><h2>正式月排期</h2><p className="muted">点击日期可查看当天任务。深色为大任务，浅色为子任务。</p></div>
      <label>月份<input type="month" value={month} onChange={e=>{if(e.target.value)setMonth(e.target.value);}} /></label>
    </div>
    {children}
    {error && <p className="alert" role="alert">{error}</p>}
    {!error && result?.month !== month && <p className="muted" role="status">正在读取排期…</p>}
    <div className="calendar">
      <div className="weekHeader">{["一","二","三","四","五","六","日"].map(name=><span key={name}>{name}</span>)}</div>
      {Array.from({length:weeks},(_,week)=>{
        const weekStart = dateShift(first,week*7-offset);
        const weekEnd = dateShift(weekStart,6);
        const laneEnds:number[]=[];
        const segments=tasks.filter(task=>task.starts<=weekEnd && task.ends>=weekStart).flatMap(task=>{
          const start=Math.max(0,delta(weekStart,task.starts),delta(weekStart,first));
          const end=Math.min(6,delta(weekStart,task.ends),delta(weekStart,next)-1);
          return start<=end?[{task,start,end}]:[];
        }).sort((a,b)=>a.start-b.start || Number(Boolean(a.task.parent_id))-Number(Boolean(b.task.parent_id)) || b.end-a.end)
          .map(segment=>{
            const freeLane=laneEnds.findIndex(end=>end<segment.start);
            const lane=freeLane===-1?laneEnds.length:freeLane;
            laneEnds[lane]=segment.end;
            return {...segment,lane};
          });
        const expanded=expandedWeeks.includes(weekStart);
        const hidden=segments.filter(segment=>segment.lane>=3).length;
        return <div className="calendarWeek" key={weekStart}>
          {Array.from({length:7},(_,column)=>{
            const date = dateShift(weekStart,column);
            const fixedCount=fixedCounts.get(date);
            return <button key={date} className={"calendarDate"+(date.slice(0,7)!==month?" outside":"")+(date===today?" today":"")}
              aria-label={"查看 "+date} onClick={()=>openDay(date)} {...dropOn(date)}>
              {Number(date.slice(8))}{fixedCount && <small className="calendarFixed">{fixedCount} 个固定时段</small>}
            </button>;
          })}
          {segments.filter(({lane})=>expanded || lane<3).map(({task,start,end,lane})=>
            <button className={"calendarBar"+(task.parent_id?" subtask":"")}
              key={task.project_id+":"+task.id}
              title={task.project_title+" / "+task.title+" · "+task.starts+" 至 "+task.ends}
              style={{gridColumn:`${start+1} / ${end+2}`,gridRow:lane+2}}
              onClick={()=>openDay(dateShift(weekStart,start))}>{task.title}</button>
          )}
          {hidden>0 && <button type="button" className="calendarMore" aria-expanded={expanded}
            style={{gridRow:expanded?laneEnds.length+2:5}}
            onClick={()=>setExpandedWeeks(weeks=>expanded?weeks.filter(key=>key!==weekStart):[...weeks,weekStart])}>
            {expanded?"收起本周任务":"展开本周其余 "+hidden+" 项"}
          </button>}
        </div>;
      })}
    </div>
    {result?.month===month && !tasks.length && <p className="empty">这个月还没有应用到正式排期的任务。</p>}
  </section>;
}

function ProjectRisks({project,tasks,progress,openDay}: {project?:Project;tasks:Task[];progress:Progress[];openDay:(day:string)=>void}) {
  const [poolRisks,setPoolRisks]=useState<PendingItem[]>([]);
  const [poolError,setPoolError]=useState("");
  useEffect(()=>{
    if(!project)return;
    let active=true;
    api<PendingItem[]>("/projects/"+project.id+"/unassigned")
      .then(items=>{if(active)setPoolRisks(items.filter(item=>item.overdue));})
      .catch(error=>{if(active)setPoolError(error.message);});
    return ()=>{active=false;};
  },[project?.id]);
  const [reference,setReference] = useState(today);
  const [windowMode,setWindowMode] = useState("3");
  const [customDays,setCustomDays] = useState("14");
  const [branch,setBranch] = useState("");
  const windowDays=Number(windowMode==="custom"?customDays:windowMode);
  const validWindow=windowMode!=="custom" || (Number.isInteger(windowDays) && windowDays>=1 && windowDays<=365);
  const complete=new Set(progress.filter(item=>item.status==="done").map(item=>item.task_id));
  const parents=new Set(tasks.map(task=>task.parentId));
  const records=new Map(tasks.map(task=>[task.id,task]));
  const selected=records.has(branch)?taskBranch(tasks,branch):undefined;
  function ancestry(task:Task) {
    const path:Task[]=[];
    let current:Task|undefined=task;
    while(current) {
      path.unshift(current);
      current=current.parentId?records.get(current.parentId):undefined;
    }
    return path;
  }
  const risks = tasks.filter(task=>task.parentId!==null && !parents.has(task.id) && !complete.has(task.id)
      && (!selected || selected.has(task.id)))
    .map(task=>({task, remaining:delta(reference,task.deadline ?? task.ends)}))
    .filter(({remaining})=>windowMode==="overdue"?remaining<0:validWindow && remaining>=0 && remaining<=windowDays)
    .sort((a,b)=>a.remaining-b.remaining);
  const groups=new Map<string,typeof risks>();
  for(const risk of risks) {
    const root=ancestry(risk.task)[0];
    groups.set(root.id,[...(groups.get(root.id) ?? []),risk]);
  }
  return <section className="card">
    <div className="sectionHead">
      <div><h2>{project?.title ?? "项目风险"}</h2><p className="muted">优先按任务截止日筛选，未填时按计划结束日。</p></div>
      <div className="actions">
        <label>基准日期<input type="date" value={reference} onChange={e=>{if(e.target.value)setReference(e.target.value);}} /></label>
        <label>截止范围<select value={windowMode} onChange={e=>setWindowMode(e.target.value)}>
          <option value="3">未来 3 天</option><option value="7">未来 7 天</option>
          <option value="custom">自定义天数</option><option value="overdue">已逾期</option>
        </select></label>
        {windowMode==="custom" && <label>未来天数<input type="number" min={1} max={365} step={1} required
          value={customDays} onChange={e=>setCustomDays(e.target.value)} /></label>}
        <label>作业范围<select value={selected?branch:""} onChange={e=>setBranch(e.target.value)}>
          <option value="">全部作业</option>
          {tasks.filter(task=>parents.has(task.id)).map(task=><option key={task.id} value={task.id}>
            {ancestry(task).map(item=>item.title).join(" / ")}
          </option>)}
        </select></label>
      </div>
    </div>
    {poolError && <p className="alert">{poolError}</p>}
    {poolRisks.length>0 && <details open><summary>超过 3 天未分配 · {poolRisks.length} 项</summary>
      <ul>{poolRisks.map(item=><li key={item.id}>{item.title} · 截止 {item.deadline}</li>)}</ul>
    </details>}
    {!validWindow && <p className="alert" role="alert">请输入 1–365 之间的整数天数。</p>}
    {[...groups].map(([root,items])=><details key={root} open={groups.size===1 || undefined}>
      <summary>{records.get(root)?.title} · {items.length} 项</summary>
      {items.map(({task,remaining})=><div className="riskRow" key={task.id}>
        <div><small>{ancestry(task).slice(1,-1).map(item=>item.title).join(" / ")}</small><strong>{task.title}</strong></div>
        <span className={remaining<=3?"urgent":"muted"}>
          {remaining<0?"逾期 "+(-remaining)+" 天":remaining===0?"今天截止":"剩余 "+remaining+" 天"}
        </span>
        <div><small>{task.deadline?"截止 "+task.deadline:"计划结束 "+task.ends}</small>
          <button onClick={()=>openDay(task.ends)}>查看计划</button></div>
      </div>)}
    </details>)}
    {validWindow && !risks.length && <p className="empty">{project?"所选范围内没有符合条件的子任务。":"请先创建或选择项目。"}</p>}
  </section>;
}

function LocalFileDraft({path,busy,run,saved}: {path:string;busy:boolean;run:(fn:()=>Promise<void>)=>Promise<void>;saved:(data:Detail)=>void}) {
  const [files,setFiles]=useState<string[]>([]);
  const [source,setSource]=useState("");
  const [instruction,setInstruction]=useState("");
  const [title,setTitle]=useState("");
  const [body,setBody]=useState("");
  const [format,setFormat]=useState("markdown");
  return <details className="knowledgeModule"><summary>本地文件与 AI 写作</summary>
    <p className="muted">选择 data 目录里的资料交给已配置的模型，或直接描述要写的内容。</p>
    <button disabled={busy} onClick={()=>void run(async()=>setFiles(await api<string[]>("/local-files")))}>读取 data 文件列表</button>
    <label>参考文件<select value={source} onChange={e=>setSource(e.target.value)}><option value="">不使用参考文件</option>
      {files.map(file=><option key={file} value={file}>{file}</option>)}
    </select></label>
    <label>写作要求<textarea rows={3} maxLength={2000} value={instruction} onChange={e=>setInstruction(e.target.value)}/></label>
    <button disabled={busy || !instruction.trim()} onClick={()=>void run(async()=>{
      const draft=await api<{title:string;body:string}>(path+"/files/local-draft","POST",{path:source,instruction});
      setTitle(draft.title);setBody(draft.body);
    })}>生成草稿</button>
    <label>文件名<input maxLength={160} value={title} onChange={e=>setTitle(e.target.value)}/></label>
    <label>正文<textarea rows={8} maxLength={24000} value={body} onChange={e=>setBody(e.target.value)}/></label>
    <label>格式<select value={format} onChange={e=>setFormat(e.target.value)}><option value="markdown">Markdown (.md)</option><option value="text">文本 (.txt)</option></select></label>
    <button className="primary" disabled={busy || !title.trim() || !body.trim()} onClick={()=>void run(async()=>{
      saved(await api<Detail>(path+"/files/"+format,"POST",{title,body}));
      setBody("");setTitle("");
    })}>确认保存到项目文件</button>
  </details>;
}

function FileRewrite({path,fileId,busy,run,saved}: {
  path:string;fileId:string;busy:boolean;run:(action:()=>Promise<void>)=>Promise<void>;saved:(detail:Detail)=>void;
}) {
  const [draft,setDraft]=useState<MarkdownDraft>();
  return <details><summary>AI 整理并另存</summary>
    <form onSubmit={event=>{
      event.preventDefault();
      const instruction=new FormData(event.currentTarget).get("instruction");
      void run(async()=>setDraft(await api<MarkdownDraft>(path+"/files/"+fileId+"/rewrite","POST",{instruction})));
    }}>
      <label>修改要求<textarea name="instruction" rows={2} maxLength={1500} required disabled={busy}
        onChange={()=>setDraft(undefined)} placeholder="例如：整理成按章节排列的学习提纲"/></label>
      <button disabled={busy}>生成 Markdown 草稿</button>
    </form>
    {draft && <form onSubmit={event=>{
      event.preventDefault();
      void run(async()=>{
        saved(await api<Detail>(path+"/files/markdown","POST",draft));
        setDraft(undefined);
      });
    }}>
      <label>文件标题<input required maxLength={160} value={draft.title} disabled={busy}
        onChange={event=>setDraft({...draft,title:event.target.value})}/></label>
      <label>编辑预览<textarea required rows={8} maxLength={24000} value={draft.body} disabled={busy}
        onChange={event=>setDraft({...draft,body:event.target.value})}/></label>
      <button className="primary" disabled={busy}>确认另存为项目文件</button>
    </form>}
  </details>;
}

type DailyReview={day:string;summary:string;sections:{question:string;answer:string}[]};

function Review({detail,busy,run,onSaved}: {
  detail?:Detail;busy:boolean;run:(action:()=>Promise<void>)=>Promise<void>;onSaved:(data:Detail)=>void;
}) {
  const [date,setDate]=useState(today);
  const [notes,setNotes]=useState("");
  const [review,setReview]=useState<DailyReview>();
  const [logs,setLogs]=useState<{task_id:string;title:string;day:string;kind:string;minutes:number}[]>([]);
  const [trendKind,setTrendKind]=useState("");
  const [trendScope,setTrendScope]=useState("project");
  const [categoryLogs,setCategoryLogs]=useState<{day:string;kind:string;minutes:number;entries:number}[]>([]);
  const [logError,setLogError]=useState("");
  const path="/projects/"+detail?.project.id;
  useEffect(()=>{
    if(!detail)return;
    let active=true;
    api<typeof logs>(path+"/time-log").then(result=>{if(active)setLogs(result);})
      .catch(issue=>{if(active)setLogError(issue.message);});
    return ()=>{active=false;};
  },[path,Boolean(detail)]);
  useEffect(()=>{
    if(!detail || trendScope!=="category")return;
    let active=true;
    api<typeof categoryLogs>(path+"/category-time").then(rows=>{if(active)setCategoryLogs(rows);})
      .catch(error=>{if(active)setLogError(error.message);});
    return ()=>{active=false;};
  },[path,trendScope,logs]);
  const progress=new Map(detail?.progress.map(item=>[item.task_id,item]));
  const parents=new Set(detail?.official.map(item=>item.parentId));
  const tasks=(detail?.official ?? []).filter(task=>task.parentId!==null && !parents.has(task.id));
  const completed=tasks.filter(task=>progress.get(task.id)?.status==="done").length;
  const actual=tasks.reduce((sum,task)=>sum+(progress.get(task.id)?.actual_minutes ?? 0),0);
  const totals=new Map<string,number>();
  const trendRows=trendScope==="category"?categoryLogs:logs;
  for(const log of trendRows.filter(item=>!trendKind || item.kind===trendKind)) {
    totals.set(log.day,(totals.get(log.day) ?? 0)+log.minutes);
  }
  const trend=[...totals].slice(0,14).reverse();
  const maxMinutes=Math.max(1,...trend.map(([,minutes])=>minutes));
  const reviewDate=review?new Date(review.day+"T00:00:00Z"):undefined;
  const reviewMonth=reviewDate?.toLocaleDateString("en-US",{month:"long",year:"numeric",timeZone:"UTC"});
  const reviewWeekday=reviewDate?.toLocaleDateString("zh-CN",{weekday:"long",timeZone:"UTC"});
  return <section className="card">
    <h2>{detail?.project.title ?? "项目复盘"}</h2>
    {detail && <form onSubmit={event=>{
      event.preventDefault();
      void run(async()=>{
        const result=await api<DailyReview>(path+"/review","POST",{day:date,notes});
        if(!Array.isArray(result.sections))throw new Error("当前后端未启用五问模板，请更新并重新启动工作台。");
        setReview(result);
      });
    }}>
      <label>复盘日期<input type="date" required value={date} disabled={busy} onChange={event=>{
        setDate(event.target.value);setReview(undefined);
      }}/></label>
      <label>补充记录<textarea rows={4} maxLength={3000} value={notes} disabled={busy} onChange={event=>{
        setNotes(event.target.value);setReview(undefined);
      }} placeholder="补充实际做过的事、产出、耗时或分心原因。"/></label>
      <p className="muted">AI 优先使用所选日期的实耗记录，按行动、产出、耗时、取舍和改进五个方面整理。</p>
      <button className="primary" disabled={busy || !date}>生成 AI 复盘</button>
    </form>}
    {review && <details open>
      <summary>{review.day} · 复盘草稿</summary>
      <article className="reviewSheet" aria-label="每日五问复盘">
        <header className="reviewDate">
          <time dateTime={review.day}>
            <strong>{reviewDate?.getUTCDate()}</strong>
            <span>{reviewMonth}</span>
            <small>{reviewWeekday}</small>
          </time>
        </header>
        {review.sections.map(section=><section key={section.question}>
          <h3>{section.question}</h3>
          <p className="material">{section.answer}</p>
        </section>)}
      </article>
      <button disabled={busy} onClick={()=>void run(async()=>{
        onSaved(await api<Detail>(path+"/files/markdown","POST",{title:review.day+" 日复盘",body:"# "+review.day+" 日复盘\n\n"+review.summary}));
        setReview(undefined);
      })}>另存为 Markdown</button>{" "}
      <button disabled={busy} onClick={()=>void run(async()=>{
        onSaved(await api<Detail>(path+"/materials","POST",{title:review.day+" · 日复盘",body:review.summary}));
        setReview(undefined);
      })}>保存复盘到知识库</button>
    </details>}
    {detail && <details>
      <summary>记录实耗与查看历史</summary>
      {logError && <p className="alert" role="alert">{logError}</p>}
      <form className="poolForm" onSubmit={event=>{
        event.preventDefault();
        const form=event.currentTarget;
        const data=new FormData(form);
        void run(async()=>{
          setLogs(await api<typeof logs>(path+"/time-log","PUT",{
            taskId:data.get("task"),day:date,kind:data.get("kind"),minutes:Number(data.get("minutes"))
          }));
          setReview(undefined);
        });
      }}>
        <label>任务<select name="task" required disabled={busy}>
          <option value="">选择正式任务</option>{tasks.map(task=><option key={task.id} value={task.id}>{task.title}</option>)}
        </select></label>
        <label>任务类型<input name="kind" placeholder="例如 写初稿" maxLength={80} required disabled={busy}/></label>
        <label>{date} 实耗分钟<input name="minutes" type="number" min={1} max={1440} required disabled={busy}/></label>
        <button disabled={busy || !date || !tasks.length}>保存当天实耗</button>
      </form>
      <p className="muted">同一任务在同一天再次保存会更新时长。</p>
      <section>
        <h3>实耗趋势</h3>
        <label>统计范围<select value={trendScope} onChange={e=>{setTrendScope(e.target.value);setTrendKind("");}}>
          <option value="project">当前项目</option>
          <option value="category">同类项目 · 最近 30 天</option>
        </select></label>
        <label>任务类型<select value={trendKind} onChange={e=>setTrendKind(e.target.value)}>
          <option value="">全部类型</option>{[...new Set(trendRows.map(item=>item.kind))].map(kind=><option key={kind}>{kind}</option>)}
        </select></label>
        {!trend.length && <p className="muted">此范围暂无实耗记录。</p>}
        {trend.map(([date,minutes])=><div className="timeTrend" key={date}>
          <time>{date}</time><meter min={0} max={maxMinutes} value={minutes} aria-label={date+" 实耗"}/>
          <span>{minutes} 分钟</span>
        </div>)}
      </section>
      <ul>{logs.map(item=><li key={item.task_id+":"+item.day}>{item.day} · {item.kind} · {item.title} · {item.minutes} 分钟</li>)}</ul>
    </details>}
    <p className="muted">已完成 {completed} / {tasks.length} · 实际耗时 {actual} 分钟</p>
    {tasks.map(task=>{
      const entry=progress.get(task.id);
      return <div className="riskRow" key={task.id}><strong>{task.title}</strong>
        <span>{statusLabels[entry?.status ?? "todo"]}</span>
        <span>{entry?.actual_minutes == null ? "未记录" : entry.actual_minutes+" 分钟"}</span></div>;
    })}
    {!tasks.length && <p className="empty">项目还没有正式子任务。</p>}
  </section>;
}

function Workbench() {
  const [page,setPage] = useState<Page>("知识库");
  const [projects,setProjects] = useState<Project[]>([]);
  const [detail,setDetail] = useState<Detail>();
  const [tasks,setTasks] = useState<Task[]>([]);
  const [dirty,setDirty] = useState(false);
  const [day,setDay] = useState(today);
  const [month,setMonth] = useState(today.slice(0,7));
  const [schedule,setSchedule] = useState<DayTask[]>([]);
  const [poolDropVersion,setPoolDropVersion]=useState(0);
  const [fixed,setFixed] = useState<FixedBlock[]>([]);
  const [aiPlan,setAiPlan] = useState<AiArrangePreview[]>();
  const [defer,setDefer]=useState<{source:string;day:string;freeHalfHours:number;items:{projectId:number;taskId:string;title:string;projectTitle:string}[]}>();
  const [error,setError] = useState("");
  const [notice,setNotice] = useState("");
  const [busy,setBusy] = useState(false);
  const [official,setOfficial] = useState(false);
  const [goal,setGoal] = useState("");
  const [workflowStep,setWorkflowStep] = useState<WorkflowStep>("rules");
  const [autoArrange,setAutoArrange] = useState(false);
  const [autoStart,setAutoStart] = useState(1140);
  const [scheduleStart,setScheduleStart] = useState("");
  const [bufferDays,setBufferDays] = useState(1);
  const [collapsed,setCollapsed] = useState<Set<string>>(new Set());
  const project = detail?.project;
  const projectPath = "/projects/" + project?.id;
  const slots = quarterHours.filter(minutes=>minutes<=1410);

  function receive(data: Detail) {
    setDetail(data);
    setTasks(data.draft.tasks ?? []);
    setDirty(false);
  }
  function openDay(date: string) {
    setDay(date);
    setPage("今日时间表");
  }
  async function run(action: () => Promise<void>) {
    setError("");
    setNotice("");
    setBusy(true);
    try { await action(); } catch (issue) { setError(issue instanceof Error ? issue.message : String(issue)); }
    finally { setBusy(false); }
  }
  useEffect(() => { void run(async () => {
    const all = await api<Project[]>("/projects");
    setProjects(all);
    if (all.length) {
      const data = await api<Detail>("/projects/"+all[0].id);
      receive(data);
      setMonth((data.draft.tasks?.[0]?.starts ?? today).slice(0,7));
    }
  }); }, []);
  useEffect(() => {
    if (page !== "今日时间表") return;
    let active = true;
    setSchedule([]);
    setFixed([]);
    setAiPlan(undefined);
    Promise.all([api<DayTask[]>("/day/"+day),api<FixedBlock[]>("/day/"+day+"/fixed")])
      .then(([tasks,blocks]) => {if (active) {setSchedule(tasks);setFixed(blocks);}})
      .catch(issue => {if (active) setError(issue.message);});
    return () => {active = false;};
  }, [day,page]);

  function switchProject(id: string) {
    if (dirty && !window.confirm("当前草稿有未保存修改，确定切换项目吗？")) return;
    void run(async () => {
      const data = await api<Detail>("/projects/"+id);
      receive(data);
      setGoal("");
      setCollapsed(new Set());
      setMonth((data.draft.tasks?.[0]?.starts ?? today).slice(0,7));
    });
  }
  function change(next: Task[]) {
    setTasks(next);
    setDirty(true);
  }
  function edit(id: string, values: Partial<Task>) {
    change(tasks.map(task => task.id === id ? {...task,...values} : task));
  }
  function add(parentId: string | null) {
    const parent = tasks.find(task => task.id === parentId);
    const date = parent?.starts ?? (project && project.deadline < today ? project.deadline : today);
    change([...tasks,{id: crypto.randomUUID(), parentId, title: "", starts: date, ends: parent?.ends ?? date}]);
  }
  function move(id: string, day: string) {
    const source = tasks.find(task => task.id === id);
    if (!source) return;
    const shift = delta(source.starts, day);
    const ids=taskBranch(tasks,id);
    change(tasks.map(task => ids.has(task.id) ?
      {...task, starts: dateShift(task.starts, shift), ends: dateShift(task.ends, shift)} : task));
  }
  function dropTask(data: DataTransfer, day: string) {
    const resize=data.getData("application/x-workbench-resize");
    if(!resize){move(data.getData("text/plain"),day);return;}
    const [edge,id]=resize.split(":");
    const task=tasks.find(item=>item.id===id);
    if(!task || (edge!=="start" && edge!=="end"))return;
    const starts=edge==="start"?day:task.starts;
    const ends=edge==="end"?day:task.ends;
    const parent=tasks.find(item=>item.id===task.parentId);
    if(starts>ends || parent && (starts<parent.starts || ends>parent.ends) ||
      tasks.some(item=>item.parentId===id && (item.starts<starts || item.ends>ends))) {
      setError("调整后的日期需要完整覆盖子任务，并在所属大任务的日期范围内。");
      return;
    }
    setError("");
    edit(id,{starts,ends});
  }
  async function save() {
    const next = await api<Detail>(projectPath+"/draft","PUT",{revision:detail?.draft.revision,tasks});
    receive(next);
    return next;
  }
  async function generate() {
    if (tasks.length && !window.confirm("生成结果会替换当前排期草稿，继续吗？")) return;
    const result = await api<{tasks:Task[]}>(projectPath+"/generate","POST",{goal});
    receive(await api<Detail>(projectPath+"/draft","PUT",{revision:detail?.draft.revision,tasks:result.tasks}));
    setMonth(result.tasks[0].starts.slice(0,7));
    setOfficial(false);
    setPage("项目排期");
    setNotice("已保存 AI 草稿，请检查日期后再应用。");
  }
  function scheduleAt(task: DayTask, minutes: number) {
    void run(async () => {
      setSchedule(await api<DayTask[]>("/projects/"+task.project_id+"/tasks/"+task.id+"/slot","PUT",{day,minutes}));
      setNotice("已保存当天时段。");
    });
  }
  function deleteCurrentProject() {
    if (!project || !window.confirm("删除项目「"+project.title+"」？该项目的资料、任务、排期和进度将一起删除，无法恢复。")) return;
    void run(async()=>{
      const remaining=await api<Project[]>(projectPath,"DELETE");
      setProjects(remaining);
      setDetail(undefined);
      setTasks([]);
      setDirty(false);
      setGoal("");
      setCollapsed(new Set());
      setOfficial(false);
      if(remaining.length)receive(await api<Detail>("/projects/"+remaining[0].id));
      setNotice("项目及其资料、任务已删除。");
    });
  }
  function deleteOfficialTask(projectId:number, taskId:string, title:string, removeChildren=false) {
    const warning=removeChildren?"大任务及其子任务会一起删除。":"这条任务会从所有日期的排期中删除。";
    if(!window.confirm("删除「"+title+"」？"+warning+"删除后无法恢复。")) return;
    void run(async()=>{
      const result=await api<Detail>("/projects/"+projectId+"/tasks/"+taskId,"DELETE");
      if(projectId===project?.id)receive(result);
      if(page==="今日时间表")setSchedule(await api<DayTask[]>("/day/"+day));
      setNotice("正式任务已删除。");
    });
  }
  function progressForm(task:DayTask) {
    return <form className="progressForm" onSubmit={e=>{
      e.preventDefault();
      const fields=new FormData(e.currentTarget);
      const actual=String(fields.get("actualMinutes") ?? "");
      void run(async()=>{
        const result=await api<Detail>("/projects/"+task.project_id+"/tasks/"+task.id+"/progress","PUT",{
          status:fields.get("status"),actualMinutes:actual===""?null:Number(actual)
        });
        if(task.project_id===project?.id)setDetail(result);
        setSchedule(await api<DayTask[]>("/day/"+day));
        setNotice("任务进度已保存。");
      });
    }}>
      <select name="status" aria-label={"状态 "+task.title} defaultValue={task.status} disabled={busy}>
        {Object.entries(statusLabels).map(([code,label])=><option key={code} value={code}>{label}</option>)}
      </select>
      <input name="actualMinutes" aria-label={"实际耗时 "+task.title} placeholder="实际分钟" type="number" min={0} max={100000} step={1}
        defaultValue={task.actual_minutes ?? ""} disabled={busy}/>
      <button disabled={busy}>保存进度</button>
    </form>;
  }
  const monthStart = month + "-01";
  const monthLength = new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).getUTCDate();
  const displayTasks = official ? detail?.official ?? [] : tasks;
  function taskRows(parentId:string|null,depth=0):{task:Task;depth:number}[] {
    return displayTasks.filter(task=>task.parentId===parentId).flatMap(task=>[
      {task,depth},...(collapsed.has(task.id)?[]:taskRows(task.id,depth+1))
    ]);
  }
  const ordered = taskRows(null);
  const waiting = schedule.filter(task=>task.minutes===null);
  const [monthRefresh,setMonthRefresh]=useState(0);
  const pomodoro=usePomodoro();
  async function refreshAssigned(data:Detail) {
    setDetail(data);
    if(page==="月总览")setMonthRefresh(value=>value+1);
    if(page==="今日时间表") {
      setAiPlan(undefined);
      setSchedule(await api<DayTask[]>("/day/"+day));
    }
    setNotice("已分配执行日期，可在当天时间表继续安排时段。");
  }
  function dropOn(date:string):React.HTMLAttributes<HTMLElement> {
    return {
      onDragOver:event=>{if(project && !busy && event.dataTransfer.types.includes(pendingDragType))event.preventDefault();},
      onDrop:event=>{
        const item=event.dataTransfer.getData(pendingDragType);
        if(!project || busy || !item)return;
        event.preventDefault();
        event.stopPropagation();
        void run(async()=>{
          const data=await api<Detail>("/projects/"+project.id+"/unassigned/"+encodeURIComponent(item),"PUT",{day:date});
          setPoolDropVersion(value=>value+1);
          await refreshAssigned(data);
        });
      }
    };
  }
  function stagePool(items:PendingItem[],placements:PoolPlacement[]) {
    if(!project || busy || official)return;
    const staged:Task[]=[];
    const parents=new Set<string>();
    for(const placement of placements) {
      const item=items.find(item=>item.id===placement.itemId);
      const parent=tasks.find(task=>task.id===placement.parentId);
      const day=placement.day;
      if(!item || !parent || !/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(Date.parse(day))
        || new Date(day).toISOString().slice(0,10)!==day || day<parent.starts || day>parent.ends || day>project.deadline
        || tasks.length+staged.length>=100 || [...tasks,...staged].some(task=>task.id==="pool-"+item.id))continue;
      let depth=1;
      for(let id=parent.parentId;id && depth<4;id=tasks.find(task=>task.id===id)?.parentId ?? null)depth++;
      if(depth>=4)continue;
      if(item.deadline && day>item.deadline)continue;
      staged.push({id:"pool-"+item.id,parentId:parent.id,title:item.title,starts:day,ends:day,deadline:item.deadline});
      parents.add(parent.id);
    }
    if(!staged.length){
      setNotice("未插入事项。请选择有下级空间的任务，并使用其日期范围及项目截止日内的日期。");
      return;
    }
    change([...tasks,...staged]);
    setCollapsed(current=>new Set([...current].filter(id=>!parents.has(id))));
    const first=staged[0];
    if(!staged.some(task=>task.starts.slice(0,7)===month))setMonth(first.starts.slice(0,7));
    setNotice(staged.length===1
      ?"「"+first.title+"」已插入「"+tasks.find(task=>task.id===first.parentId)?.title+"」 · "+first.starts+"。"
      :"已插入 "+staged.length+" 项。");
    if(staged.length!==placements.length)setNotice("已插入 "+staged.length+" 项，其余建议未通过日期或层级检查，仍在待分配池。");
  }
  function dropIntoTask(event:React.DragEvent<HTMLElement>,task:Task,day:string) {
    if(!event.dataTransfer.types.includes(pendingDragType))return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.closest(".row")?.classList.remove("poolTarget");
    const raw=event.dataTransfer.getData("application/x-workbench-pending-detail");
    if(!raw)return;
    try {
      const item=JSON.parse(raw) as PendingItem & {projectId:number};
      if(item.projectId===project?.id)stagePool([item],[{itemId:item.id,parentId:task.id,day}]);
    } catch {setNotice("无法读取拖入的事项，请从待分配列表重新拖动。");}
  }
  const pendingSidebar=project && <PendingPool compact key={project.id+":"+poolDropVersion}
    project={project} busy={busy} run={run} onAssigned={refreshAssigned}
    placement={page==="项目排期" && !official?{tasks,stage:stagePool}:undefined}/>;
  const categories = [...new Set(waiting.map(task=>task.category))];

  return <div className="shell">
    <aside><div className="brand"><span>日</span><div>项目工作台<small>本机工作区</small></div></div>
      <nav>{workspaceNav.map(group=><details className="navGroup" key={group.title} open>
        <summary>{group.title}</summary>
        <div className="navItems">
        {group.pages.map(item => <button key={item} className={page===item?"active":""} aria-current={page===item?"page":undefined} disabled={busy} onClick={()=>setPage(item)}>
        <span aria-hidden="true">{{"临时收集":"⊞","知识库":"▤","AI 助理":"◇","AI 拆解":"✧","待分配池":"▧","项目排期":"▥","月总览":"▦","今日时间表":"◷","番茄钟":"◔","项目风险":"⚑","复盘":"↺"}[item]}</span>{item}
      </button>)}
        </div>
      </details>)}</nav>
      <details className="navGroup projectTree" open>
        <summary>当前项目与分类</summary>
        {[...new Set([...projectCategories,...projects.map(item=>item.category)])].map(category=>{
          const children=projects.filter(item=>item.category===category);
          return <details key={category} open={project?.category===category || undefined}>
            <summary>{category}<small>{children.length}</small></summary>
            {children.length ? children.map(item=><button key={item.id} type="button"
              className={item.id===project?.id?"active":""}
              aria-current={item.id===project?.id?"true":undefined} disabled={busy}
              onClick={()=>{if(item.id!==project?.id)switchProject(String(item.id));}}>{item.title}</button>)
              : <small>暂无项目</small>}
          </details>;
        })}
      </details>
    </aside>
    <main>
      <header><div><p className="eyebrow">{project ? <>{project.category} / <button type="button" className="projectLink"
        onClick={()=>setPage("知识库")}>{project.title}</button></> : "工作区"}</p><h1>{page}</h1></div></header>
      {error && <p role="alert" className="alert">{error}</p>}
      {notice && <p role="status" className="notice">{notice}</p>}
      {busy && <p role="status" className="notice">处理中…</p>}
      {(page==="临时收集" || page==="今日时间表" || page==="番茄钟" || page==="项目排期") && <InterruptionPanel project={project} busy={busy} run={run} timer={pomodoro} onSchedule={page==="今日时间表" || page==="项目排期"} refresh={async()=>{
        if(page==="今日时间表"){setAiPlan(undefined);setSchedule(await api<DayTask[]>("/day/"+day));}
      }}/>}
      {page==="临时收集" && <Inbox project={project} busy={busy} run={run} onArchive={async()=>{
        setDetail(await api<Detail>(projectPath));
        setNotice("资料已移入项目知识库。");
      }} onScheduled={async()=>{
        setDetail(await api<Detail>(projectPath));
      }} />}
      {page==="知识库" && <div className="two">
        <NewProject busy={busy} dirty={dirty} run={run} onCreated={async id=>{
          setProjects(await api<Project[]>("/projects"));
          receive(await api<Detail>("/projects/"+id));
          setGoal("");
          setNotice("项目已创建。");
        }}/>
        <section className="card" key={project?.id ?? "no-project"}><div className="sectionHead"><h2>项目资料</h2>
          {project && <button className="danger" disabled={busy} onClick={deleteCurrentProject}>删除当前项目</button>}
        </div>
          {project ? <>
            <p className="muted">截止日期 {project.deadline}</p>
            <MaterialEditor path={projectPath} busy={busy} run={run} saved={setDetail} notify={setNotice}/>
            <LocalFileDraft path={projectPath} busy={busy} run={run} saved={data=>{setDetail(data);setNotice("文件已保存到 data 下的项目目录，并加入知识库。");}}/>
            <details className="knowledgeModule"><summary>项目文件 · {detail?.files?.length ?? 0} 个</summary>
              <p className="muted">原件保存在本地项目目录。可提取的正文会进入知识库，供 AI 问答和拆解引用。</p>
              {(detail?.files ?? []).length>0 && <ul>{detail?.files?.map(file=><li key={file.id}>
                <a href={"/api"+projectPath+"/files/"+file.id}>{file.name}</a>{" "}
                <small>{Math.ceil(file.size_bytes/1024)} KB · {file.material_id?"正文已入库":"已保存原件"}</small>
                {file.material_id && <FileRewrite path={projectPath} fileId={file.id} busy={busy} run={run} saved={data=>{
                  setDetail(data);setNotice("修改稿已另存为 Markdown，原件保留。");
                }}/>}
              </li>)}</ul>}
              <form onSubmit={event=>{
                event.preventDefault();
                const form=event.currentTarget;
                const data=new FormData(form);
                void run(async()=>{
                  setDetail(await api<Detail>(projectPath+"/materials/file","POST",data));
                  form.reset();
                  setNotice("原件已保存。可提取的正文已归入项目知识库。");
                });
              }}>
                <label>本地文件<input type="file" name="file" accept=".txt,.md,.csv,.pdf,.docx,.png,.jpg,.jpeg" required disabled={busy}/></label>
                <small>支持 TXT、Markdown、CSV、DOCX、可复制文字的 PDF 和 PNG/JPEG，最大 4 MB。</small>
                <button disabled={busy}>保存项目文件</button>
              </form>
            </details>
            <PublicPageImport project={project} busy={busy} run={run} saved={setDetail} notify={setNotice}/>
            <details className="knowledgeModule"><summary>飞书文档</summary>
            <form onSubmit={event=>{
              event.preventDefault();
              const form=event.currentTarget;
              const values=Object.fromEntries(new FormData(form));
              void run(async()=>{
                setDetail(await api<Detail>(projectPath+"/materials/feishu","POST",values));
                form.reset();
                setNotice("飞书正文已导入项目知识库。");
              });
            }}>
              <label>飞书新版云文档链接<input name="url" type="url" required placeholder="https://…feishu.cn/docx/…" /></label>
              <button disabled={busy}>读取飞书正文</button>
            </form>
            </details>
            {detail && <MaterialArchive detail={detail} busy={busy} run={run} saved={setDetail}/>}
          </> : <p className="muted">创建项目后可以录入资料。</p>}
        </section>
      </div>}
      {page==="AI 助理" && <>
        <div className="assistantModel"><ModelConnection busy={busy} run={run} notify={setNotice}/></div>
        {detail && <KnowledgeChat key={detail.project.id} detail={detail} busy={busy} run={run} saved={setDetail}
          notify={setNotice} dirty={dirty} openMonth={(data,day)=>{
            receive(data);
            setMonth(day.slice(0,7));
            setPage("月总览");
          }} openDraft={data=>{
            receive(data);
            setMonth((data.draft.tasks?.[0]?.starts ?? today).slice(0,7));
            setOfficial(false);
            setPage("项目排期");
          }}/>}
        <AssistantPlan key={project?.id} detail={detail} busy={busy} run={run} notify={setNotice}
        openBreakdown={()=>{setWorkflowStep("tasks");setPage("AI 拆解");}}
        onConfirmed={(data,first,hasUndated)=>{
          setDetail(data);
          if(first)setMonth(first.slice(0,7));
          setPage(hasUndated?"待分配池":"月总览");
          setNotice(hasUndated?"已确认：有日期的任务进入排期，其余进入待分配池。":"已有计划已写入正式排期。");
        }} />
      </>}
      {page==="待分配池" && <PendingPool key={project?.id} project={project} busy={busy} run={run} onAssigned={data=>{
        setDetail(data);
        setNotice("已安排执行日期，可前往每日时间表选择具体时段。");
      }}/>}
      {page==="AI 拆解" && <section className="card workflowCard">
        <ModelConnection busy={busy} run={run} notify={setNotice}/>
        <div className="workflowSteps" aria-label="拆解功能">
          {workflowSteps.map((step,index)=>{
            const note=detail?.workflow.find(item=>item.step===step.key);
            const state=note?.stale ? "待重做" : note ? "已确认"
              : step.key==="tasks" && detail?.draft.tasks?.length ? "已有草稿"
              : step.key==="schedule" && detail?.draft.applied ? "已应用" : "";
            return <button key={step.key} type="button" aria-pressed={step.key===workflowStep} disabled={busy}
              onClick={()=>setWorkflowStep(step.key)}><strong>{index+1}. {step.title}</strong>{state && <small>{state}</small>}</button>;
          })}
        </div>
        {!detail ? <p className="empty">先在知识库创建项目。</p> : workflowStep==="tasks" ? <div className="workflowContent">
          <p className="muted">使用当前项目资料和已确认的结论生成大任务、子任务与建议日期，生成后可在排期页编辑。</p>
          <label>选择项目目标<select value="" disabled={busy} onChange={event=>setGoal(event.target.value)}>
            <option value="">使用默认目标或选择已存目标</option>
            {[...new Set([detail.workflow.find(note=>note.step==="goal" && !note.stale)?.body,...(detail.goals ?? [])]
              .filter((value):value is string=>Boolean(value)))].map(value=><option key={value} value={value}>
                {value.replace(/\s+/g," ").slice(0,90)}
              </option>)}
          </select></label>
          <label>本次目标（可选）
            <textarea rows={2} maxLength={1500} disabled={busy} value={goal} onChange={e=>setGoal(e.target.value)}
              placeholder="留空时使用已确认目标，未确认时使用项目名称" />
          </label>
          <div className="actions">
            <button disabled={busy || !goal.trim()} onClick={()=>void run(async()=>{
              setDetail(await api<Detail>(projectPath+"/goals","POST",{body:goal}));
              setNotice("目标已保存，下次可以从列表选择。");
            })}>保存到目标列表</button>
            <button className="primary" disabled={!detail.materials.length || busy} onClick={()=>void run(generate)}>开始 AI 拆解</button>
            <button disabled={busy} onClick={()=>{setOfficial(false);setPage("项目排期");}}>手动编辑草稿</button>
          </div>
        </div> : workflowStep==="schedule" ? <div className="workflowContent narrow">
          <p className="muted">在项目排期最后核对色块和日期，点「确认应用」后同步到正式看板。</p>
          <button className="primary" disabled={busy} onClick={()=>{setOfficial(false);setPage("项目排期");}}>打开待确认排期</button>
        </div> : <WorkflowReview key={detail.project.id+":"+workflowStep} step={workflowStep} detail={detail}
          busy={busy} run={run} saved={setDetail} notify={setNotice} />}
      </section>}
      {page==="项目排期" && <div className="planningLayout"><section className="card">
        <div className="sectionHead"><div><h2>项目排期</h2><p className="muted">{official ? "已发布的任务" : dirty ? "草稿有未保存修改" : detail?.draft.applied ? "草稿已应用" : "待确认草稿"}</p></div>
          {detail && official && !!detail.official.length && <button disabled={busy} onClick={()=>void run(async()=>{
            const lines=detail.official.map(task=>"- "+task.title+" · "+task.starts+" 至 "+task.ends+
              (task.deadline?" · 截止 "+task.deadline:""));
            setDetail(await api<Detail>(projectPath+"/files/markdown","POST",{title:"正式排期 "+today,
              body:"# "+detail.project.title+" · 正式排期\n\n"+lines.join("\n")}));
            setNotice("排期已另存到知识库的项目文件区。");
          })}>导出排期为 Markdown</button>}
          <div className="actions">
            <div className="viewToggle" aria-label="排期状态">
              <button aria-pressed={!official} disabled={busy} onClick={()=>setOfficial(false)}>草稿</button>
              <button aria-pressed={official} disabled={busy} onClick={()=>setOfficial(true)}>正式排期</button>
            </div>
            {!official && <>
              <button disabled={busy || !project} onClick={()=>add(null)}>＋ 大任务</button>
              <button disabled={busy || !dirty} onClick={()=>void run(async()=>{await save();setNotice("草稿已保存。");})}>保存草稿</button>
              <button className="primary" disabled={busy || !tasks.length || (!dirty && detail?.draft.applied===true)}
                onClick={()=>void run(async()=>{
                  const data=dirty ? await save() : detail;
                  receive(await api<Detail>(projectPath+"/apply/"+data?.draft.revision,"POST",{
                    autoStartMinutes:autoArrange?autoStart:null,startDay:scheduleStart || null,bufferDays
                  }));
                  setPoolDropVersion(version=>version+1);
                  setNotice(autoArrange ? "已确认应用并安排可用时段。可切换日期查看结果。" : "已确认应用，今日时间表已更新。");
                })}>确认应用</button>
            </>}
          </div>
        </div>
        {!official && project && <DraftRevision key={project.id} project={project} tasks={tasks} busy={busy} run={run}
          adopt={async proposal=>{
            const data=await api<Detail>(projectPath+"/draft","PUT",{revision:detail?.draft.revision,tasks:proposal});
            receive(data);
            setMonth(proposal[0].starts.slice(0,7));
            setNotice("已保存调整后的草稿。点击确认应用后更新正式排期。");
          }}/>}
        {!official && project && <div className="autoArrangement">
          <h3>临时安排</h3>
          <p className="muted">当前编辑的是草稿。确认后才会写入正式看板。</p>
          <div className="actions">
            <label className="check"><input type="checkbox" checked={autoArrange} disabled={busy}
              onChange={e=>setAutoArrange(e.target.checked)} /> 确认时自动安排未来子任务</label>
            {autoArrange && <label>每日从几点开始<select value={autoStart} disabled={busy}
              onChange={e=>setAutoStart(Number(e.target.value))}>
              {slots.filter(minutes=>minutes<=1320).map(minutes=><option key={minutes} value={minutes}>{time(minutes)}</option>)}
            </select></label>}
            {autoArrange && <label>从哪天起排<input type="date" value={scheduleStart} min={today}
              disabled={busy} onChange={e=>setScheduleStart(e.target.value)}/></label>}
            {autoArrange && <label>截止前预留天数<input type="number" min={0} max={365} value={bufferDays}
              disabled={busy} onChange={e=>{setBufferDays(e.target.valueAsNumber || 0);}}/></label>}
          </div>
          {autoArrange && <p className="muted">每天从所选时刻起找 2 小时内的空档，每项暂排 30 分钟。截止前预留 {bufferDays} 天，已有时段会避开，排不下的留在当天待排区。</p>}
        </div>}
        <label className="month">显示月份<input type="month" value={month} onChange={e=>{if(e.target.value)setMonth(e.target.value);}} /></label>
        <div className="actions">
          <button disabled={!displayTasks.length} onClick={()=>setCollapsed(new Set(displayTasks.flatMap(task=>task.parentId?[task.parentId]:[])))}>全部折叠</button>
          <button disabled={!collapsed.size} onClick={()=>setCollapsed(new Set())}>全部展开</button>
        </div>
        <p className="muted">拖动色块可移动整段任务，拖动两端可调整起止日。拖动大任务会一起移动子任务。</p>
        <fieldset disabled={busy} className="scheduleField"><div className="scheduleGrid">
          <div className="row scheduleHeader"><strong className="taskCell">{project?.title ?? "项目任务篮子"}</strong><div className="dates" style={{gridTemplateColumns:`repeat(${monthLength},minmax(32px,1fr))`}}>
            {Array.from({length:monthLength},(_,i)=>{
              const date=dateShift(monthStart,i);
              return <button key={i} className="date" onClick={()=>openDay(date)} {...dropOn(date)}>{i+1}</button>;
            })}
          </div></div>
          {ordered.map(({task,depth})=>{
            const first=Math.max(0,delta(monthStart,task.starts));
            const last=Math.min(monthLength-1,delta(monthStart,task.ends));
            return <div className="row" key={task.id} onDragOver={event=>{
              if(official || busy || !event.dataTransfer.types.includes(pendingDragType))return;
              event.preventDefault();
              event.dataTransfer.dropEffect="move";
              event.currentTarget.classList.add("poolTarget");
            }} onDragLeave={event=>{
              if(!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget))
                event.currentTarget.classList.remove("poolTarget");
            }}>
              <div className={"taskCell "+(task.parentId?"child":"")} style={{paddingLeft:8+depth*16}} draggable={!official} onDragStart={event=>event.dataTransfer.setData("text/plain",task.id)}
                onDrop={event=>dropIntoTask(event,task,task.starts<monthStart && monthStart<=task.ends?monthStart:task.starts)}>
                {displayTasks.some(item=>item.parentId===task.id) && <button className="collapseTask"
                  aria-expanded={!collapsed.has(task.id)} onClick={()=>setCollapsed(current=>{
                    const next=new Set(current);
                    if(next.has(task.id))next.delete(task.id);else next.add(task.id);
                    return next;
                  })}>{collapsed.has(task.id)?"展开子任务":"折叠子任务"}</button>}
                {official ? <>
                  <strong>{task.title}</strong>
                  <button className="danger taskDelete" disabled={dirty || busy}
                    title={dirty?"先保存草稿修改，再删除正式任务":undefined}
                    onClick={()=>deleteOfficialTask(project!.id,task.id,task.title,displayTasks.some(item=>item.parentId===task.id))}>删除正式任务</button>
                </> : <>
                  <input aria-label="任务名" value={task.title} placeholder={task.parentId?"子任务名称":"大任务名称"} onChange={e=>edit(task.id,{title:e.target.value})}/>
                  <div className="taskDates">
                    <input aria-label="开始日期" type="date" value={task.starts} onChange={e=>{if(e.target.value) edit(task.id,{starts:e.target.value});}}/>
                    <input aria-label="结束日期" type="date" value={task.ends} onChange={e=>{if(e.target.value) edit(task.id,{ends:e.target.value});}}/>
                  </div>
                  {task.parentId && <label>任务截止日（可选）<input type="date" value={task.deadline ?? ""}
                    onChange={e=>edit(task.id,{deadline:e.target.value || undefined})}/></label>}
                  <div className="actions">{depth<3 && <button onClick={()=>{setCollapsed(current=>new Set([...current].filter(id=>id!==task.id)));add(task.id);}}>＋ 下级任务</button>}
                    <button onClick={()=>{const ids=taskBranch(tasks,task.id);change(tasks.filter(t=>!ids.has(t.id)));}}>移除</button>
                  </div>
                </>}
              </div>
              <div className="dates track" style={{gridTemplateColumns:`repeat(${monthLength},minmax(32px,1fr))`}}>
                {Array.from({length:monthLength},(_,i)=><div key={i} className="target" style={{gridColumn:i+1}} onDragOver={e=>{if(!official && !busy)e.preventDefault();}} onDrop={e=>{
                  e.preventDefault();
                  if(official || busy)return;
                  const date=dateShift(monthStart,i);
                  if(e.dataTransfer.types.includes(pendingDragType))dropIntoTask(e,task,date);
                  else dropTask(e.dataTransfer,date);
                }} />)}
                {first<=last && <div title={task.title+" "+task.starts+" – "+task.ends} className={"bar "+(task.parentId?"light":"")} draggable={!official && !busy}
                  onDragStart={e=>e.dataTransfer.setData("text/plain",task.id)}
                  onDragOver={e=>{if(!official && !busy)e.preventDefault();}} onDrop={e=>{
                    e.preventDefault();
                    if (official || busy) return;
                    const rect=e.currentTarget.getBoundingClientRect();
                    const offset=Math.min(last-first, Math.floor((e.clientX-rect.left)/rect.width*(last-first+1)));
                    const date=dateShift(monthStart,first+Math.max(0,offset));
                    if(e.dataTransfer.types.includes(pendingDragType))dropIntoTask(e,task,date);
                    else dropTask(e.dataTransfer,date);
                  }}
                  style={{gridColumn:`${first+1} / ${last+2}`}}>
                  {!official && task.starts>=monthStart && <span className="barHandle" title="拖动调整开始日期"
                    draggable={!busy} onDragStart={e=>{e.stopPropagation();e.dataTransfer.setData("application/x-workbench-resize","start:"+task.id);}}/>}
                  <span className="barText">{task.title || "未命名"}</span>
                  {!official && delta(monthStart,task.ends)<monthLength && <span className="barHandle" title="拖动调整结束日期"
                    draggable={!busy} onDragStart={e=>{e.stopPropagation();e.dataTransfer.setData("application/x-workbench-resize","end:"+task.id);}}/>}
                </div>}
              </div>
            </div>;
          })}
          {!ordered.length && <p className="empty">还没有任务。可以从 AI 拆解生成，或者手动添加。</p>}
        </div></fieldset>
      </section>{pendingSidebar}</div>}
      {page==="月总览" && <div className="planningLayout"><MonthOverview key={monthRefresh} month={month} setMonth={setMonth} openDay={openDay} dropOn={dropOn}>
        <TimetableImport key={month} anchor={month===today.slice(0,7)?today:month+"-01"} busy={busy} run={run}
          setNotice={setNotice} onImported={()=>setMonthRefresh(value=>value+1)}/>
      </MonthOverview>{pendingSidebar}</div>}
      {page==="项目风险" && <ProjectRisks key={project?.id} project={project} tasks={detail?.official ?? []} progress={detail?.progress ?? []} openDay={openDay} />}
      {page==="复盘" && <Review key={detail?.project.id} detail={detail} busy={busy} run={run} onSaved={data=>{
        setDetail(data);setNotice("复盘已保存到当前项目知识库。");
      }}/>}
      {page==="今日时间表" && <section className="card">
        <div className="sectionHead pendingDateTarget" {...dropOn(day)}>
          <div><h2>当天任务</h2><p className="muted">{schedule.length} 项任务 · {waiting.length} 项待排 · {schedule.filter(t=>t.status==="done").length} 项已完成</p></div>
          <div className="actions dateToolbar">
            <button disabled={busy} onClick={()=>setDay(dateShift(day,-1))}>前一天</button>
            <input aria-label="当天日期" type="date" disabled={busy} value={day} onChange={event=>{if(event.target.value)setDay(event.target.value);}} />
            <button disabled={busy} onClick={()=>setDay(dateShift(day,1))}>后一天</button>
            <button disabled={busy} onClick={()=>setDay(today)}>今天</button>
            <button disabled={busy} onClick={()=>{setMonth(day.slice(0,7));setPage("月总览");}}>返回月总览</button>
            <button disabled={busy} onClick={()=>setPage("番茄钟")}>番茄钟</button>
          </div>
        </div>
        <details className="fixedEditor">
          <summary>固定时段 · {fixed.length} 项</summary>
          <form className="poolForm" onSubmit={e=>{
            e.preventDefault();
            const form=e.currentTarget, data=new FormData(form);
            void run(async()=>{
              setFixed(await api<FixedBlock[]>("/day/"+day+"/fixed","POST",{
                title:data.get("title"),starts:Number(data.get("starts")),ends:Number(data.get("ends"))
              }));
              form.reset();
            });
          }}>
            <label>名称<input name="title" required disabled={busy} placeholder="课程、睡眠或其他固定安排"/></label>
            <label>开始<select name="starts" defaultValue="540" disabled={busy}>
              {quarterHours.map(minutes=><option value={minutes} key={minutes}>{time(minutes)}</option>)}
            </select></label>
            <label>结束<select name="ends" defaultValue="600" disabled={busy}>
              {[...quarterHours.slice(1),1440].map(minutes=><option value={minutes} key={minutes}>{time(minutes)}</option>)}
            </select></label>
            <button disabled={busy}>添加固定时段</button>
          </form>
          <TimetableImport key={day} anchor={day} busy={busy} run={run} setNotice={setNotice} onImported={async()=>{
            setFixed(await api<FixedBlock[]>("/day/"+day+"/fixed"));
          }}/>
          {fixed.map(block=><div className="fixedItem" key={block.id}>
            <span>{time(block.starts)}–{time(block.ends)} · {block.title}</span>
            <button disabled={busy} onClick={()=>{
              if(!window.confirm("解除该固定时段？"))return;
              void run(async()=>{setFixed(await api<FixedBlock[]>("/day/"+day+"/fixed/"+block.id,"DELETE"));});
            }}>解除</button>
          </div>)}
        </details>
        <div className="dayGrid"><div className="timeline">
          {quarterHours.map(minutes=>{
            const block=fixed.find(item=>item.starts<minutes+15 && item.ends>minutes);
            const occupied=schedule.some(t=>t.minutes!=null && t.minutes<minutes+30 && (t.slot_ends??t.minutes+30)>minutes);
            const continued=schedule.some(t=>t.minutes!=null && t.slot_ends!=null && t.minutes<minutes && t.slot_ends>minutes);
            const accepts=minutes<=1410 && !fixed.some(item=>minutes<item.ends && minutes+30>item.starts) && !occupied;
            return <div className={"slot"+(block?" protectedSlot":"")+(continued?" continued":"")} key={minutes} onDragOver={event=>{if(!busy && accepts)event.preventDefault();}}
            onDrop={event=>{
              event.preventDefault();
              const key=event.dataTransfer.getData("text/plain");
              const task=schedule.find(t=>t.project_id+":"+t.id===key);
              if (task && !busy && accepts) scheduleAt(task,minutes);
            }}>
            <time>{time(minutes)}</time>
            <div>{fixed.filter(item=>item.starts>=minutes && item.starts<minutes+15).map(item=>
              <div className="fixedLabel" key={item.id}>{item.title} · {time(item.starts)}–{time(item.ends)}</div>)}
            {schedule.filter(t=>t.minutes===minutes).map(t=><div className="dayCard" key={t.project_id+":"+t.id} draggable={!busy}
              onDragStart={e=>e.dataTransfer.setData("text/plain",t.project_id+":"+t.id)}>
              <div className="slotTitle"><strong>{t.title}</strong>
                {t.slot_ends!=null && t.slot_ends>t.minutes!+30 && <small>至 {time(t.slot_ends)}</small>}
                <button disabled={busy} onClick={()=>void run(async()=>{
                  setSchedule(await api<DayTask[]>("/projects/"+t.project_id+"/tasks/"+t.id+"/slot/"+day,"DELETE"));
                  setNotice("已移回当天待排区。");
                })}>移回待排</button>
                <button className="danger" disabled={busy || (dirty && t.project_id===project?.id)}
                  onClick={()=>deleteOfficialTask(t.project_id,t.id,t.title)}>删除任务</button>
              </div><small>{t.project_title}</small>{progressForm(t)}
            </div>)}</div>
          </div>;})}
        </div><div className="queue"><h3>待安排时段</h3>
          <p className="muted">将任务拖到左侧，或直接选择时间。</p>
          {schedule.length>9 && <div className="notice">
            <p>当天已有 {schedule.length} 项任务。可检查哪些未开始的任务能顺延。</p>
            <button disabled={busy} onClick={()=>void run(async()=>{
              const result=await api<Omit<NonNullable<typeof defer>,"source">>("/day/"+day+"/defer");
              setDefer({...result,source:day});
            })}>查看顺延建议</button>
            {defer?.source===day && <div>
              <p>{defer.day} 有 {defer.freeHalfHours} 个未占用的半小时时段。候选未开始、没有硬截止和已定时段，且次日仍在项目和父任务期限内。顺延只设执行日。</p>
              {!defer.items.length && <p>没有符合条件的任务。</p>}
              <ul>{defer.items.map(item=><li key={item.projectId+":"+item.taskId}>
                {item.projectTitle} · {item.title}{" "}
                <button disabled={busy || (dirty && item.projectId===project?.id)} onClick={()=>void run(async()=>{
                  setSchedule(await api<DayTask[]>("/day/"+day+"/defer","POST",{projectId:item.projectId,taskId:item.taskId}));
                  setDefer(undefined);setAiPlan(undefined);
                  if(item.projectId===project?.id) receive(await api<Detail>(projectPath));
                  setNotice("已顺延到 "+defer.day+"，可在当天继续排时段。");
                })}>确认顺延</button>
              </li>)}</ul>
            </div>}
          </div>}
          {pendingSidebar && <details><summary>待分配日期的任务</summary>
            <p className="muted">拖到上方「当天任务」可分配到所选日期。</p>{pendingSidebar}</details>}
          {!!waiting.length && <button disabled={busy} onClick={()=>void run(async()=>{
            const result=await api<{items:AiArrangePreview[]}>("/day/"+day+"/ai-arrange","POST");
            setAiPlan(result.items);
            setNotice("请核对 AI 建议的安排后应用。");
          })}>AI 安排本日</button>}
          {aiPlan && !!aiPlan.length && <details open>
            <summary>AI 建议安排 · {aiPlan.length} 项</summary>
            <ul className="revisionResult">{aiPlan.map((item,index)=><li key={index}>
              <span>{item.title} · {time(item.start)}–{time(item.end)}</span>
              <small>{item.projectTitle} · {estimateText(item)}</small>
            </li>)}</ul>
            <div className="actions">
              <button className="primary" disabled={busy} onClick={()=>void run(async()=>{
                setSchedule(await api<DayTask[]>("/day/"+day+"/ai-arrange/confirm","POST",
                  {items:aiPlan.map(({projectId,taskId,start,end})=>({projectId,taskId,start,end}))}));
                setAiPlan(undefined);
                if(project)setDetail(await api<Detail>(projectPath));
                setNotice("已按 AI 建议写入当日时间表。");
              })}>应用安排</button>
              <button disabled={busy} onClick={()=>setAiPlan(undefined)}>放弃</button>
            </div>
          </details>}
          {!waiting.length && <p className="muted">当前没有待排任务。</p>}
          {categories.map(category=>{
            const group = waiting.filter(task=>task.category===category);
            return <details key={category} open={categories.length===1}>
              <summary>{category} · {group.length} 项</summary>
              {[...new Set(group.map(task=>task.project_id))].map(id=>{
                const entries = group.filter(task=>task.project_id===id);
                return <details key={id} open={group.length===entries.length}>
                  <summary>{entries[0].project_title} · {entries.length} 项</summary>
                  {entries.map(t=><div className="dayCard" draggable={!busy} key={t.id}
                    onDragStart={e=>e.dataTransfer.setData("text/plain",t.project_id+":"+t.id)}>
                    <div className="slotTitle"><strong>{t.title}</strong>
                      <button className="danger" disabled={busy || (dirty && t.project_id===project?.id)}
                        onClick={()=>deleteOfficialTask(t.project_id,t.id,t.title)}>删除任务</button>
                    </div>
                    <select aria-label={"安排 "+t.title} disabled={busy} value="" onChange={e=>{if(e.target.value)scheduleAt(t,Number(e.target.value));}}>
                      <option value="">选择开始时间</option>{slots.filter(s=>!fixed.some(block=>s<block.ends && s+30>block.starts))
                        .map(s=><option value={s} key={s}>{time(s)}</option>)}
                    </select>
                    {progressForm(t)}
                  </div>)}
                </details>;
              })}
            </details>;
          })}
        </div></div>
      </section>}
      {page==="番茄钟" && <PomodoroPage state={pomodoro} busy={busy} run={run} setNotice={setNotice}/>}
    </main>
  </div>;
}

createRoot(document.getElementById("root")!).render(<Workbench />);
