import { useLanguage } from "../LanguageProvider";
import {
  ChevronFirst, ChevronLast, ChevronLeft, ChevronRight, GitBranch, History,
  List, Pause, Play, Plus, Radio, X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { EVENT_LABELS, eventAudienceLabel, eventCategories, eventParticipants, phaseLabel, timelineChapters, timelineSummary } from "../timeline";
import type { EventCategory } from "../timeline";
import type { BranchOrigin, EventAudience, EventDetails, ManualEventKind, TimelineEntry, Script } from "../types";

interface TimelineProps {
  entries: TimelineEntry[];
  scripts: Script[];
  replayIndex: number | null;
  branchOrigin: BranchOrigin | null;
  busy: boolean;
  dirty: boolean;
  saveFailed: boolean;
  onSeek: (index: number | null) => void;
  onAddEvent: (kind: ManualEventKind, note: string, details: EventDetails, audience: EventAudience) => void;
  onBranch: () => void;
}

export function Timeline({
  entries, scripts, replayIndex, branchOrigin, busy, dirty, saveFailed, onSeek, onAddEvent, onBranch,
}: TimelineProps) {
  const { t, language, locale } = useLanguage();
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1500);
  const [listOpen, setListOpen] = useState(false);
  const [note, setNote] = useState("");
  const [eventKind, setEventKind] = useState<ManualEventKind>("note");
  const [actorId, setActorId] = useState("");
  const [targetIds, setTargetIds] = useState<string[]>([]);
  const [visibility, setVisibility] = useState<EventAudience["visibility"]>("storyteller");
  const [recipientIds, setRecipientIds] = useState<string[]>([]);
  const [filter, setFilter] = useState<EventCategory | "all">("all");
  const participantPicker = useRef<HTMLDetailsElement | null>(null);
  const activeRow = useRef<HTMLButtonElement | null>(null);
  const chapters = useMemo(() => timelineChapters(entries, language), [entries, language]);
  const categories = useMemo(() => entries.map((item, i) => eventCategories(item, entries[i - 1])), [entries]);
  const index = replayIndex ?? entries.length - 1;
  const entry = entries[index];
  const summary = (itemIndex: number) => timelineSummary(entries[itemIndex], entries[itemIndex - 1], scripts, language);
  const recipients = recipientIds.filter((id) => entry?.snapshot.seats.some((seat) => seat.id === id));
  const replaying = replayIndex !== null;
  const atEnd = index >= entries.length - 1;
  const playActive = playing && replaying && !atEnd && !busy;
  const chapter = chapters.find((item) => item.start <= index && item.end >= index);
  const visibleGroups = chapters.map((group) => ({ ...group,
    indices: entries.slice(group.start, group.end + 1).map((_, i) => group.start + i)
      .filter((i) => filter === "all" || categories[i].includes(filter)),
  })).filter((group) => group.indices.length > 0);

  useEffect(() => {
    if (!playActive) return;
    const timer = window.setTimeout(() => onSeek(index + 1), speed);
    return () => window.clearTimeout(timer);
  }, [playActive, index, speed, onSeek]);

  useEffect(() => {
    if (listOpen) activeRow.current?.scrollIntoView({ block: "nearest" });
  }, [listOpen, index, filter]);

  const seek = (next: number | null) => {
    setPlaying(false);
    onSeek(next);
  };
  const submitNote = () => {
    if (!note.trim() || busy || (visibility === "private" && !recipients.length)) return;
    const seatIds = new Set(entry.snapshot.seats.map((seat) => seat.id));
    onAddEvent(eventKind, note, {
      actor_seat_id: seatIds.has(actorId) ? actorId : null,
      target_seat_ids: targetIds.filter((id) => seatIds.has(id)),
    }, { visibility, recipient_seat_ids: visibility === "private" ? recipients : [] });
    setNote("");
    setVisibility("storyteller");
    setRecipientIds([]);
    setActorId("");
    setTargetIds([]);
    if (participantPicker.current) participantPicker.current.open = false;
  };
  if (!entry) return null;

  return (
    <section className={`timeline-panel panel-shell ${replaying ? "is-replaying" : ""}`} aria-label={t("游戏时间线")}>
      <div className="timeline-toolbar">
        <div className="timeline-heading">
          <History size={17} />
          <strong>{t("游戏时间线")}</strong>
          <span>{entries.length === 1 ? t("1 条记录") : t("{0} 条记录", [entries.length])}</span>
        </div>
        <div className="playback-controls" aria-label={t("回放控制")}>
          <button type="button" title={t("回到起点")} aria-label={t("回到起点")} onClick={() => seek(0)} disabled={busy}>
            <ChevronFirst size={16} />
          </button>
          <button type="button" title={t("上一条")} aria-label={t("上一条")} onClick={() => seek(index - 1)} disabled={index === 0 || busy}>
            <ChevronLeft size={16} />
          </button>
          <button type="button" className="play-button" aria-label={playActive ? t("暂停回放") : t("播放回放")}
            disabled={entries.length < 2 || busy}
            onClick={() => {
              if (playActive) setPlaying(false);
              else {
                if (!replaying || atEnd) onSeek(0);
                setPlaying(true);
              }
            }}>
            {playActive ? <Pause size={15} /> : <Play size={15} />}
            {playActive ? t("暂停") : t("播放")}
          </button>
          <button type="button" title={t("下一条")} aria-label={t("下一条")} onClick={() => seek(index + 1)} disabled={atEnd || busy}>
            <ChevronRight size={16} />
          </button>
          <button type="button" title={t("最后一条")} aria-label={t("最后一条")} onClick={() => seek(entries.length - 1)} disabled={busy}>
            <ChevronLast size={16} />
          </button>
          <select aria-label={t("回放速度")} value={speed} onChange={(event) => setSpeed(Number(event.target.value))}>
            <option value={3000}>0.5×</option>
            <option value={1500}>1×</option>
            <option value={750}>2×</option>
          </select>
        </div>
        <input className="timeline-scrubber" type="range" min={0} max={entries.length - 1}
          value={index} onChange={(event) => seek(Number(event.target.value))} disabled={busy}
          aria-label={t("回放进度")} aria-valuetext={t("第 {0} 条，{1}，{2}", [index + 1, phaseLabel(entry.snapshot, language), summary(index)])} />
        <span className="timeline-position">{index + 1} / {entries.length}</span>
        <button type="button" className={listOpen ? "active" : ""} aria-expanded={listOpen}
          onClick={() => setListOpen(!listOpen)}><List size={15} /> {t("全部记录")}</button>
        {replaying && <>
          <button type="button" onClick={() => { setPlaying(false); onBranch(); }} disabled={busy}>
            <GitBranch size={14} /> {t("从此处分支")}
          </button>
          <button type="button" className="return-live" onClick={() => seek(null)} disabled={busy}>
            <Radio size={14} /> {t("返回当前局面")}
          </button>
        </>}
      </div>

      <div className="timeline-chapter-bar">
        <label>{t("跳转阶段")}
          <select aria-label={t("跳转阶段")} value={chapter?.start ?? 0} disabled={busy}
            onChange={(event) => seek(Number(event.target.value))}>
            {chapters.map((item) => <option key={item.id} value={item.start}>
              {item.label} · {t("第 {0}–{1} 条", [item.start + 1, item.end + 1])}
            </option>)}
          </select>
        </label>
        <span className="timeline-category">{categories[index].map((category) => t(EVENT_LABELS[category])).join(" · ")}</span>
      </div>

      <div className="timeline-detail-row">
        <div className="timeline-current" aria-live={playActive ? "off" : "polite"}>
          <div className="timeline-event-meta">
            <span className={replaying ? "replay-badge" : "recording-badge"}>{replaying ? t("回放 · 只读") : t("自动记录中")}</span>
            <b>{phaseLabel(entry.snapshot, language)}</b>
            <time dateTime={entry.recorded_at}>{new Date(entry.recorded_at).toLocaleTimeString(locale)}</time>
            <span className={saveFailed ? "timeline-save-error" : ""}>
              {saveFailed ? t("自动保存已暂停，请点击保存重试") : dirty ? t("等待保存") : t("记录已保存")}
            </span>
          </div>
          <p>{summary(index)}</p>
          {entry.details && <p className="timeline-event-participants">{eventParticipants(entry, language)}</p>}
          {entry.note && <p className="timeline-event-note">{entry.note}</p>}
          {["note", "action", "information"].includes(entry.kind) && <small>{eventAudienceLabel(entry, language)}</small>}
          {branchOrigin && <small className="branch-origin"><GitBranch size={11} /> {t("分支来源：")}{branchOrigin.game_name}</small>}
        </div>
        {!replaying && (
          <form className="timeline-note-form" onSubmit={(event) => { event.preventDefault(); submitNote(); }}>
            <div className="timeline-note-options">
              <label htmlFor="timeline-note">{t("添加事件")}</label>
              <select aria-label={t("事件类型")} value={eventKind} disabled={busy}
                onChange={(event) => setEventKind(event.target.value as ManualEventKind)}>
                <option value="note">{t("说书人记录")}</option>
                <option value="action">{t("行动")}</option>
                <option value="information">{t("信息")}</option>
              </select>
              <label>{t("可见范围")}
                <select aria-label={t("事件可见范围")} value={visibility} disabled={busy}
                  onChange={(event) => setVisibility(event.target.value as EventAudience["visibility"])}>
                  <option value="storyteller">{t("仅说书人")}</option>
                  <option value="public">{t("所有玩家")}</option>
                  <option value="private">{t("指定玩家")}</option>
                </select>
              </label>
              {visibility === "private" && <details className="event-participant-picker" open>
                <summary>{t("可见玩家 · 已选 {0} 人", [recipients.length])}</summary>
                <fieldset disabled={busy}>
                  <legend>{t("选择能看到本事件的玩家")}</legend>
                  <div className="event-targets">
                    {entry.snapshot.seats.map((seat) => <label key={seat.id}>
                      <input type="checkbox" checked={recipients.includes(seat.id)}
                        onChange={(event) => setRecipientIds((current) => event.target.checked
                          ? [...current, seat.id] : current.filter((id) => id !== seat.id))} />
                      {t("{0} 号 {1}", [seat.position, seat.player_name])}
                    </label>)}
                  </div>
                </fieldset>
              </details>}
              {eventKind !== "note" && <details ref={participantPicker} className="event-participant-picker">
                <summary>{t("参与玩家")}</summary>
                <fieldset disabled={busy}>
                  <label>{t("行动者 / 信息来源")}
                    <select aria-label={t("行动者或信息来源")} value={entry.snapshot.seats.some((seat) => seat.id === actorId) ? actorId : ""}
                      onChange={(event) => setActorId(event.target.value)}>
                      <option value="">{t("说书人")}</option>
                      {entry.snapshot.seats.map((seat) => <option key={seat.id} value={seat.id}>
                        {seat.position} {t("号")} {seat.player_name}
                      </option>)}
                    </select>
                  </label>
                  <span>{t("相关目标（可多选，不决定可见范围）")}</span>
                  <div className="event-targets">
                    {entry.snapshot.seats.map((seat) => <label key={seat.id}>
                      <input type="checkbox" checked={targetIds.includes(seat.id)}
                        onChange={(event) => setTargetIds((current) => event.target.checked
                          ? [...current, seat.id] : current.filter((id) => id !== seat.id))} />
                      {seat.position} {t("号")} {seat.player_name}
                    </label>)}
                  </div>
                </fieldset>
              </details>}
            </div>
            <textarea id="timeline-note" value={note} onChange={(event) => setNote(event.target.value)}
              disabled={busy} maxLength={2000} rows={2}
              placeholder={visibility === "storyteller" ? t("记录说书人备注；选择可见范围可向玩家提供事件…") : t("只填写已向所选玩家公开的内容；正文及参与玩家将进入他们的历史…")}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault(); submitNote();
                }
              }} />
            <button type="submit" disabled={!note.trim() || busy || (visibility === "private" && !recipients.length)}>
              <Plus size={14} /> {visibility === "storyteller" ? t("记录") : t("记录并提供给玩家")}
            </button>
          </form>
        )}
      </div>

      {listOpen && (
        <div className="timeline-event-browser">
          <div className="timeline-list-heading">
            <strong>{t("完整记录")}</strong>
            <span>{t("选择记录，查看当时的魔典")}</span>
            <select aria-label={t("筛选事件类型")} value={filter} onChange={(event) => setFilter(event.target.value as EventCategory | "all")}>
              <option value="all">{t("全部事件")}</option>
              {Object.entries(EVENT_LABELS).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}
            </select>
            <button type="button" aria-label={t("关闭记录列表")} onClick={() => setListOpen(false)}><X size={15} /></button>
          </div>
          <div className="timeline-event-list">
            {visibleGroups.length === 0 && <p className="timeline-empty">{t("没有此类型的记录")}</p>}
            {visibleGroups.map((group) => <section key={group.id} aria-label={group.label}>
              <h3 className="timeline-group-heading">{group.label}<span>{group.indices.length} {t("条")}</span></h3>
              {group.indices.map((itemIndex) => {
                const item = entries[itemIndex];
                return (
                  <button type="button" key={item.id} ref={itemIndex === index ? activeRow : null}
                    className={itemIndex === index ? "active" : ""} aria-current={itemIndex === index ? "step" : undefined}
                    disabled={busy} onClick={() => { seek(itemIndex); setListOpen(false); }}>
                    <span className="event-number">{itemIndex + 1}</span>
                    <span className="event-phase">{t(EVENT_LABELS[categories[itemIndex].find((value) => value !== "change") ?? item.kind])}</span>
                    <span className="event-description"><b>{summary(itemIndex)}</b>
                      {item.details && <small>{eventParticipants(item, language)}</small>}
                      {item.note && <small>{item.note}</small>}
                      {["note", "action", "information"].includes(item.kind) && <small>{eventAudienceLabel(item, language)}</small>}</span>
                    <time dateTime={item.recorded_at}>{new Date(item.recorded_at).toLocaleTimeString(locale)}</time>
                  </button>
                );
              })}
            </section>)}
          </div>
        </div>
      )}
    </section>
  );
}
