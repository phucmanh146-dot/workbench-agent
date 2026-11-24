package local.workbench;

import java.time.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

/** Same-day interruptions are separate from the ordinary, cross-day inbox. */
@RestController
@RequestMapping("/api/interruptions")
public class Interruptions {
    private final JdbcTemplate db;
    public Interruptions(JdbcTemplate db) { this.db=db; }
    public record Capture(long projectId,String day,String title,boolean urgent,String taskId,
        String scene,int started,int remainingSeconds,String checkpoint,int minutes,boolean important) {}
    public record Window(int start,int end) {}
    public record Resolution(boolean keepNext,int finished,String revision) {}
    public record BufferAction(String action) {}
    private ResponseStatusException bad(String text) {return new ResponseStatusException(HttpStatus.BAD_REQUEST,text);}
    private String day(String value) {
        try {return LocalDate.parse(value).toString();} catch(Exception ex) {throw bad("日期无效。");}
    }
    private int n(Map<String,Object> row,String key) {return ((Number)row.get(key)).intValue();}
    private String key(Map<String,Object> row) {return row.get("project_id")+":"+row.get("task_id");}
    private void project(long id) {
        if(db.queryForList("SELECT id FROM project WHERE id=?",id).isEmpty()) throw bad("项目不存在。");
    }
    private List<Map<String,Object>> slots(String day) {
        return db.queryForList("""
            SELECT s.project_id,s.task_id,t.title,s.minutes,COALESCE(s.ends,s.minutes+30) AS ends
            FROM day_slot s JOIN task t ON t.project_id=s.project_id AND t.id=s.task_id WHERE s.day=?
            UNION ALL SELECT a.project_id,a.task_id,t.title,a.minutes,a.minutes+30 AS ends
            FROM automatic_slot a JOIN task t ON t.project_id=a.project_id AND t.id=a.task_id
            WHERE a.day=? AND NOT EXISTS(SELECT 1 FROM day_slot s WHERE s.day=a.day AND s.project_id=a.project_id AND s.task_id=a.task_id)
            ORDER BY 4,1,2
            """,day,day);
    }
    private void clearSlot(Object project,Object task,String day) {
        db.update("DELETE FROM day_slot WHERE project_id=? AND task_id=? AND day=?",project,task,day);
        db.update("DELETE FROM automatic_slot WHERE project_id=? AND task_id=? AND day=?",project,task,day);
    }
    private void log(Object project,String day,String text) {
        db.update("INSERT INTO operation_receipt(project_id,label,target,day,body) VALUES(?,?,?,?,?)",
            project,"突发与缓冲","今日时间表",day,text);
    }
    private void buffer(Map<String,Object> task,String day,String note) {
        if(db.queryForList("SELECT id FROM day_buffer WHERE project_id=? AND task_id=? AND day=? AND state IN ('waiting','discarded')",
            task.get("project_id"),task.get("task_id"),day).isEmpty())
            db.update("INSERT INTO day_buffer(project_id,day,title,task_id,minutes,note) VALUES(?,?,?,?,?,?)",
                task.get("project_id"),day,task.get("title"),task.get("task_id"),n(task,"ends")-n(task,"minutes"),note);
        clearSlot(task.get("project_id"),task.get("task_id"),day);
    }
    @GetMapping("/{day}")
    public Object read(@PathVariable String day) {
        day(day);
        var windows=db.queryForList("SELECT starts,ends FROM buffer_window WHERE day=?",day);
        return Map.of("events",db.queryForList("SELECT * FROM interruption WHERE day=? ORDER BY id DESC",day),
            "buffer",db.queryForList("""
                SELECT b.*,d.deadline AS task_deadline
                FROM day_buffer b LEFT JOIN task_deadline d ON d.project_id=b.project_id AND d.task_id=b.task_id
                WHERE b.day=? ORDER BY b.important DESC,b.id
                """,day),
            "slots",slots(day),"fixed",db.queryForList("SELECT starts,ends FROM fixed_block WHERE day=?",day),
            "window",windows.isEmpty()?Map.of("starts",1020,"ends",1080):windows.getFirst());
    }
    @PutMapping("/{day}/window")
    public Object window(@PathVariable String day,@RequestBody Window input) {
        day(day);
        if(input.start()<450 || input.end()>1440 || input.end()<=input.start() || input.start()%15!=0 || input.end()%15!=0)
            throw bad("请选择有效的 15 分钟缓冲时段。");
        db.update("INSERT INTO buffer_window(day,starts,ends) VALUES(?,?,?) ON CONFLICT(day) DO UPDATE SET starts=excluded.starts,ends=excluded.ends",day,input.start(),input.end());
        return read(day);
    }
    @PostMapping
    @Transactional
    public Object capture(@RequestBody Capture input) {
        project(input.projectId()); String day=day(input.day());
        if(!LocalDate.now().toString().equals(day)) throw bad("突发入口仅记录今天；历史记录可在对应日期查看。");
        if(input.title()==null || input.title().isBlank() || input.title().length()>300) throw bad("请输入 300 字以内的标题。");
        if(input.minutes()<1 || input.minutes()>480 || input.remainingSeconds()<0 || input.remainingSeconds()>86400)
            throw bad("预计时长或剩余时间无效。");
        String checkpoint=input.checkpoint()==null?"":input.checkpoint().strip();
        if(checkpoint.length()>3000)throw bad("断点最多 3000 字。");
        if(!input.urgent()) {
            db.update("INSERT INTO day_buffer(project_id,day,title,minutes,important,note) VALUES(?,?,?,?,?,?)",
                input.projectId(),day,input.title(),input.minutes(),input.important()?1:0,checkpoint);
            log(input.projectId(),day,"可暂缓："+input.title()+"。保持当前任务和排期不变。");
            return read(day);
        }
        if(!db.queryForList("SELECT id FROM interruption WHERE state IN ('active','resuming') AND day=?",day).isEmpty())
            throw bad("请先完成今天正在处理的突发或恢复流程。");
        if(input.started()<0 || input.started()>=1440 || input.scene()==null || !List.of("focus","planned","idle").contains(input.scene()))throw bad("突发场景或开始时间无效。");
        if(!db.queryForList("SELECT id FROM fixed_block WHERE day=? AND starts<=? AND ends>?",day,input.started(),input.started()).isEmpty())
            throw bad("当前处于课表等锁定时段，请先人工调整固定安排，系统不会自动挤占。");
        if(!"idle".equals(input.scene())) {
            var scheduled=slots(day).stream().filter(t->n(t,"project_id")==input.projectId() && Objects.equals(t.get("task_id"),input.taskId())).findFirst();
            Map<String,Object> task;
            if(scheduled.isPresent()) {
                task=scheduled.get();
            } else if("focus".equals(input.scene())) {
                task=db.queryForList("""
                    SELECT t.project_id,t.id AS task_id,t.title,0 AS minutes,0 AS ends
                    FROM task t WHERE t.project_id=? AND t.id=? AND t.starts<=? AND t.ends>=?
                      AND t.parent_id IS NOT NULL AND NOT EXISTS(
                        SELECT 1 FROM task child WHERE child.project_id=t.project_id AND child.parent_id=t.id)
                    """,input.projectId(),input.taskId(),day,day).stream().findFirst()
                    .orElseThrow(()->bad("已绑定的专注任务不在今天的可用任务中。"));
            } else {
                throw bad("请选择当前已排任务；没有已排任务时可选择空闲场景。");
            }
            if(!db.queryForList("SELECT 1 FROM task_progress WHERE project_id=? AND task_id=? AND status='done'",input.projectId(),input.taskId()).isEmpty())throw bad("已完成任务不能被打断。");
            if("planned".equals(input.scene()) && (n(task,"minutes")>input.started() || n(task,"ends")<=input.started()))throw bad("所选任务不在当前时段。");
            var remaining=new HashMap<>(task);
            if("focus".equals(input.scene()))remaining.put("ends",n(task,"minutes")+Math.max(1,(input.remainingSeconds()+59)/60));
            buffer(remaining,day,"突发断点："+checkpoint);
        }
        db.update("INSERT INTO interruption(project_id,day,title,task_id,scene,started,remaining_seconds,checkpoint) VALUES(?,?,?,?,?,?,?,?)",
            input.projectId(),day,input.title(),"idle".equals(input.scene())?null:input.taskId(),input.scene(),input.started(),input.remainingSeconds(),checkpoint);
        log(input.projectId(),day,"即刻紧急："+input.title()+"；断点："+checkpoint+"；剩余秒数："+input.remainingSeconds());
        return read(day);
    }
    private Map<String,Object> event(long id) {
        return db.queryForList("SELECT * FROM interruption WHERE id=?",id).stream().findFirst().orElseThrow(()->bad("突发记录不存在。"));
    }
    private String revision(String day) {
        String text=slots(day).toString()+db.queryForList("SELECT * FROM fixed_block WHERE day=? ORDER BY id",day)
            +db.queryForList("SELECT * FROM day_buffer WHERE day=? ORDER BY id",day)
            +db.queryForList("SELECT * FROM task_progress ORDER BY project_id,task_id")
            +db.queryForList("SELECT * FROM task ORDER BY project_id,id");
        return UUID.nameUUIDFromBytes(text.getBytes(java.nio.charset.StandardCharsets.UTF_8)).toString();
    }
    @PostMapping("/{id}/preview")
    public Map<String,Object> preview(@PathVariable long id,@RequestBody Resolution input) {
        var event=event(id); String day=(String)event.get("day");
        boolean followup="resuming".equals(event.get("state"));
        if(!followup && !"active".equals(event.get("state")))throw bad("该突发事项已处理，不会重复应用。");
        boolean resumeFirst=!followup && !input.keepNext() && event.get("task_id")!=null;
        if(input.finished()<n(event,"started") || input.finished()>=1440)throw bad("完成时间应在开始之后且不跨日。");
        var completed=db.queryForList("SELECT project_id,task_id FROM task_progress WHERE status='done'").stream().map(this::key).collect(java.util.stream.Collectors.toSet());
        var currentSlots=slots(day);
        String originalKey=key(event);
        if(followup && currentSlots.stream().anyMatch(t->key(t).equals(originalKey) && n(t,"minutes")>input.finished()))
            throw bad("完成时间早于恢复任务的安排时间。");
        var future=currentSlots.stream().filter(t->n(t,"ends")>n(event,"started") && !completed.contains(key(t)) && !key(t).equals(originalKey)).toList();
        var next=future.isEmpty()?Map.<String,Object>of():future.getFirst();
        var placements=new ArrayList<Map<String,Object>>(); var deferred=new ArrayList<Map<String,Object>>();
        if(followup || !input.keepNext()) {
            var order=new ArrayList<Map<String,Object>>();
            if(resumeFirst) {
                var held=db.queryForList("SELECT project_id,task_id,title,0 AS minutes,minutes AS ends FROM day_buffer WHERE day=? AND project_id=? AND task_id=? AND state='waiting'",
                    day,event.get("project_id"),event.get("task_id"));
                if(held.isEmpty())throw bad("被打断任务已发生变化，请先恢复缓冲记录。");
                order.add(held.getFirst());
            }
            if(!followup && !next.isEmpty())deferred.add(next);
            if(!resumeFirst)for(var row:future)if(followup || !key(row).equals(next.isEmpty()?"":key(next)))order.add(row);
            var occupied=new ArrayList<int[]>();
            for(var b:db.queryForList("SELECT starts,ends FROM fixed_block WHERE day=?",day))occupied.add(new int[]{n(b,"starts"),n(b,"ends")});
            for(var t:currentSlots)if(n(t,"ends")<=n(event,"started") || completed.contains(key(t)) || (followup && key(t).equals(originalKey))
                || (resumeFirst && future.contains(t) && !t.equals(next)))
                occupied.add(new int[]{n(t,"minutes"),n(t,"ends")});
            int cursor=Math.max(450,((input.finished()+14)/15)*15);
            for(var row:order) {
                int duration=((n(row,"ends")-n(row,"minutes")+14)/15)*15;
                while(cursor+duration<=1440) {
                    int s=cursor,e=cursor+duration;
                    if(s<=1410 && occupied.stream().noneMatch(b->s<b[1] && e>b[0]))break;
                    cursor+=15;
                }
                if(cursor>1410 || cursor+duration>1440) {
                    if(resumeFirst)throw bad("剩余时间没有连续空档可恢复原任务。可选保留后续安排，再在缓冲箱处理原任务。");
                    deferred.add(row);continue;
                }
                var p=new HashMap<>(row); p.put("minutes",cursor); p.put("ends",cursor+duration); placements.add(p); cursor+=duration;
            }
        }
        String branch=("focus".equals(event.get("scene"))?"A":"planned".equals(event.get("scene"))?"B":"空闲")+(input.keepNext()?"1":"2");
        return Map.of("revision",revision(day)+":"+id+":"+input.keepNext()+":"+input.finished(),"branch",branch,"next",next,"placements",placements,"deferred",deferred,
            "message",followup?"按原任务实际完成时间重排剩余任务，放不下的留在当日缓冲。":
                resumeFirst?"下一任务进缓冲；先恢复原任务，其他安排等实际完成后再重排。":
                input.keepNext()?"保留后续顺序；原任务留在当日缓冲。":"下一任务进缓冲；按原顺序安排剩余任务。",
            "event",event);
    }
    @PostMapping("/{id}/confirm")
    @Transactional
    public Object confirm(@PathVariable long id,@RequestBody Resolution input) {
        var event=event(id);String day=(String)event.get("day");
        var result=preview(id,input);
        if(!result.get("revision").equals(input.revision()))throw bad("排期或任务已变化，请重新生成预览。");
        boolean followup="resuming".equals(event.get("state"));
        if(followup || !input.keepNext()) {
            @SuppressWarnings("unchecked") var deferred=(List<Map<String,Object>>)result.get("deferred");
            @SuppressWarnings("unchecked") var placements=(List<Map<String,Object>>)result.get("placements");
            for(var row:deferred)buffer(row,day,"突发处理后移入缓冲");
            for(var row:placements) {
                clearSlot(row.get("project_id"),row.get("task_id"),day);
                db.update("INSERT INTO day_slot(project_id,task_id,day,minutes,ends) VALUES(?,?,?,?,?)",row.get("project_id"),row.get("task_id"),day,row.get("minutes"),row.get("ends"));
                db.update("UPDATE day_buffer SET state='restored' WHERE project_id=? AND task_id=? AND day=? AND state='waiting'",row.get("project_id"),row.get("task_id"),day);
            }
        }
        String elapsed=followup?"原任务实际完成于 "+input.finished()+" 分钟（自午夜起算）":
            "突发耗时 "+(input.finished()-n(event,"started"))+" 分钟";
        String text=result.get("branch")+"；"+result.get("message")+"；"+elapsed+"；安排："+result.get("placements")+"；缓冲："+result.get("deferred");
        String state=!followup && !input.keepNext() && event.get("task_id")!=null?"resuming":"resolved";
        String history=followup?event.get("resolution")+"\n"+text:text;
        db.update("UPDATE interruption SET state=?,resolution=? WHERE id=?",state,history,id);
        log(event.get("project_id"),day,text);
        return read(day);
    }
    @PostMapping("/buffer/{id}")
    @Transactional
    public Object bufferAction(@PathVariable long id,@RequestBody BufferAction input) {
        var row=db.queryForList("SELECT * FROM day_buffer WHERE id=?",id).stream().findFirst().orElseThrow(()->bad("缓冲记录不存在。"));
        String state=(String)row.get("state"),day=(String)row.get("day");
        if(!db.queryForList("SELECT id FROM interruption WHERE state='active' AND project_id=? AND task_id=?",row.get("project_id"),row.get("task_id")).isEmpty())throw bad("请先完成该任务的突发处理流程。");
        switch(input.action()) {
            case "arrange" -> {
                if(!"waiting".equals(state) || !day.equals(LocalDate.now().toString()))throw bad("仅能安排今天的待处理缓冲事项；历史缓冲不会自动滚到次日。");
                var windows=db.queryForList("SELECT starts,ends FROM buffer_window WHERE day=?",day);
                int start=windows.isEmpty()?1020:n(windows.getFirst(),"starts"),end=windows.isEmpty()?1080:n(windows.getFirst(),"ends");
                var now=LocalTime.now(); start=Math.max(start,((now.getHour()*60+now.getMinute()+14)/15)*15);
                int duration=((n(row,"minutes")+14)/15)*15;
                var occupied=new ArrayList<int[]>();
                for(var s:slots(day))occupied.add(new int[]{n(s,"minutes"),n(s,"ends")});
                for(var s:db.queryForList("SELECT starts,ends FROM fixed_block WHERE day=?",day))occupied.add(new int[]{n(s,"starts"),n(s,"ends")});
                while(start+duration<=end) {
                    int a=start,b=start+duration;
                    if(occupied.stream().noneMatch(s->a<s[1] && b>s[0]))break;
                    start+=15;
                }
                if(start>1410 || start+duration>end)throw bad("缓冲窗口已结束或剩余容量不足，请调整窗口或明确取舍；不会自动顺延。");
                Object task=row.get("task_id");
                if(task==null) {
                    String deadline=db.queryForObject("SELECT deadline FROM project WHERE id=?",String.class,row.get("project_id"));
                    if(day.compareTo(deadline)>0)throw bad("项目已过截止日，请先核对截止日，或完成后记录取舍。");
                    String root=UUID.randomUUID().toString();task=UUID.randomUUID().toString();
                    db.update("INSERT INTO task(project_id,id,parent_id,title,starts,ends,position) VALUES(?,?,NULL,?,?,?,9998)",row.get("project_id"),root,"当日缓冲事项",day,day);
                    db.update("INSERT INTO task(project_id,id,parent_id,title,starts,ends,position) VALUES(?,?,?,?,?,?,9999)",row.get("project_id"),task,root,row.get("title"),day,day);
                } else if(db.queryForList("SELECT id FROM task WHERE project_id=? AND id=? AND starts<=? AND ends>=?",row.get("project_id"),task,day,day).isEmpty())throw bad("原任务已变更，无法在该日期恢复。");
                clearSlot(row.get("project_id"),task,day);
                db.update("INSERT INTO day_slot(project_id,task_id,day,minutes,ends) VALUES(?,?,?,?,?)",row.get("project_id"),task,day,start,start+duration);
                db.update("UPDATE day_buffer SET state='restored',task_id=? WHERE id=?",task,id);
            }
            case "discard" -> {
                if(!"waiting".equals(state))throw bad("仅待处理事项可以舍弃。");
                db.update("UPDATE day_buffer SET state='discarded',discarded_at=? WHERE id=?",Instant.now().toString(),id);
            }
            case "restore" -> {
                if(!"discarded".equals(state) || Instant.parse((String)row.get("discarded_at")).plusSeconds(86400).isBefore(Instant.now()))throw bad("恢复期限为舍弃后 24 小时。");
                db.update("UPDATE day_buffer SET state='waiting',discarded_at=NULL WHERE id=?",id);
            }
            case "done" -> {
                if(!"waiting".equals(state))throw bad("该事项不在缓冲中。");
                db.update("UPDATE day_buffer SET state='done' WHERE id=?",id);
                // Completion of a buffer item is not proof that its whole multi-day task is complete.
            }
            default -> throw bad("未知缓冲操作。");
        }
        log(row.get("project_id"),day,row.get("title")+"："+input.action()+"；仅调整当日缓冲，不删除项目任务。");
        return read(day);
    }
}
