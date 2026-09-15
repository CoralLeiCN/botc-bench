import {
  ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, GitBranch, History,
  List, Pause, Play, Plus, Radio, X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { phaseLabel } from "../timeline";
import type { BranchOrigin, TimelineEntry } from "../types";

interface TimelineProps {
  entries: TimelineEntry[];
  replayIndex: number | null;
  branchOrigin: BranchOrigin | null;
  busy: boolean;
  dirty: boolean;
  saveFailed: boolean;
  onSeek: (index: number | null) => void;
  onAddEvent: (note: string) => void;
  onBranch: () => void;
}

export function Timeline({
  entries, replayIndex, branchOrigin, busy, dirty, saveFailed, onSeek, onAddEvent, onBranch,
}: TimelineProps) {
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1500);
  const [listOpen, setListOpen] = useState(false);
  const [note, setNote] = useState("");
  const activeRow = useRef<HTMLButtonElement | null>(null);
  const index = replayIndex ?? entries.length - 1;
  const entry = entries[index];
  const replaying = replayIndex !== null;
  const atEnd = index >= entries.length - 1;
  const playActive = playing && replaying && !atEnd && !busy;

  useEffect(() => {
    if (!playActive) return;
    const timer = window.setTimeout(() => onSeek(index + 1), speed);
    return () => window.clearTimeout(timer);
  }, [playActive, index, speed, onSeek]);

  useEffect(() => {
    if (listOpen) activeRow.current?.scrollIntoView({ block: "nearest" });
  }, [listOpen, index]);

  const seek = (next: number | null) => {
    setPlaying(false);
    onSeek(next);
  };
  const submitNote = () => {
    if (!note.trim() || busy) return;
    onAddEvent(note);
    setNote("");
  };
  if (!entry) return null;

  return (
    <section className={`timeline-panel panel-shell ${replaying ? "is-replaying" : ""}`} aria-label="游戏时间线">
      <div className="timeline-toolbar">
        <div className="timeline-heading">
          <History size={17} />
          <strong>游戏时间线</strong>
          <span>{entries.length} 条</span>
        </div>
        <div className="playback-controls" aria-label="回放控制">
          <button type="button" title="回到起点" aria-label="回到起点" onClick={() => seek(0)} disabled={busy}>
            <ChevronFirst size={16} />
          </button>
          <button type="button" title="上一条" aria-label="上一条" onClick={() => seek(index - 1)} disabled={index === 0 || busy}>
            <ChevronLeft size={16} />
          </button>
          <button type="button" className="play-button" aria-label={playActive ? "暂停回放" : "播放回放"}
            disabled={entries.length < 2 || busy}
            onClick={() => {
              if (playActive) setPlaying(false);
              else {
                if (!replaying || atEnd) onSeek(0);
                setPlaying(true);
              }
            }}>
            {playActive ? <Pause size={15} /> : <Play size={15} />}
            {playActive ? "暂停" : "播放"}
          </button>
          <button type="button" title="下一条" aria-label="下一条" onClick={() => seek(index + 1)} disabled={atEnd || busy}>
            <ChevronRight size={16} />
          </button>
          <button type="button" title="最后一条" aria-label="最后一条" onClick={() => seek(entries.length - 1)} disabled={busy}>
            <ChevronLast size={16} />
          </button>
          <select aria-label="回放速度" value={speed} onChange={(event) => setSpeed(Number(event.target.value))}>
            <option value={3000}>0.5×</option>
            <option value={1500}>1×</option>
            <option value={750}>2×</option>
          </select>
        </div>
        <input className="timeline-scrubber" type="range" min={0} max={entries.length - 1}
          value={index} onChange={(event) => seek(Number(event.target.value))} disabled={busy}
          aria-label="回放进度" aria-valuetext={`第 ${index + 1} 条，${phaseLabel(entry.snapshot)}，${entry.summary}`} />
        <span className="timeline-position">{index + 1} / {entries.length}</span>
        <button type="button" className={listOpen ? "active" : ""} aria-expanded={listOpen}
          onClick={() => setListOpen(!listOpen)}><List size={15} /> 全部记录</button>
        {replaying && <>
          <button type="button" onClick={() => { setPlaying(false); onBranch(); }} disabled={busy}>
            <GitBranch size={14} /> 从此处分支
          </button>
          <button type="button" className="return-live" onClick={() => seek(null)} disabled={busy}>
            <Radio size={14} /> 返回当前局面
          </button>
        </>}
      </div>

      <div className="timeline-detail-row">
        <div className="timeline-current" aria-live={playActive ? "off" : "polite"}>
          <div className="timeline-event-meta">
            <span className={replaying ? "replay-badge" : "recording-badge"}>{replaying ? "回放 · 只读" : "自动记录中"}</span>
            <b>{phaseLabel(entry.snapshot)}</b>
            <time dateTime={entry.recorded_at}>{new Date(entry.recorded_at).toLocaleTimeString("zh-CN")}</time>
            <span className={saveFailed ? "timeline-save-error" : ""}>
              {saveFailed ? "自动保存已暂停，请点击保存重试" : dirty ? "等待保存" : "记录已保存"}
            </span>
          </div>
          <p>{entry.summary}</p>
          {entry.note && <p className="timeline-event-note">{entry.note}</p>}
          {branchOrigin && <small className="branch-origin"><GitBranch size={11} /> 分支来源：{branchOrigin.game_name}</small>}
        </div>
        {!replaying && (
          <form className="timeline-note-form" onSubmit={(event) => { event.preventDefault(); submitNote(); }}>
            <label htmlFor="timeline-note">添加事件</label>
            <textarea id="timeline-note" value={note} onChange={(event) => setNote(event.target.value)}
              maxLength={2000} rows={2} placeholder="记录夜间信息、行动、提名投票或说书人公告…"
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault(); submitNote();
                }
              }} />
            <button type="submit" disabled={!note.trim() || busy}><Plus size={14} /> 记录</button>
          </form>
        )}
      </div>

      {listOpen && (
        <div className="timeline-event-browser">
          <div className="timeline-list-heading">
            <strong>完整记录</strong>
            <span>选择记录，查看当时的魔典</span>
            <button type="button" aria-label="关闭记录列表" onClick={() => setListOpen(false)}><X size={15} /></button>
          </div>
          <div className="timeline-event-list">
            {entries.map((item, itemIndex) => (
              <button type="button" key={item.id} ref={itemIndex === index ? activeRow : null}
                className={itemIndex === index ? "active" : ""} aria-current={itemIndex === index ? "step" : undefined}
                disabled={busy} onClick={() => { seek(itemIndex); setListOpen(false); }}>
                <span className="event-number">{itemIndex + 1}</span>
                <span className="event-phase">{phaseLabel(item.snapshot)}</span>
                <span className="event-description"><b>{item.summary}</b>{item.note && <small>{item.note}</small>}</span>
                <time dateTime={item.recorded_at}>{new Date(item.recorded_at).toLocaleTimeString("zh-CN")}</time>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
