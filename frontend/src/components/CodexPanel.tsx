import {
  AlertCircle,
  BookMarked,
  LoaderCircle,
  Send,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { phaseLabel } from "../timeline";
import type { HarnessStatus, ReasonPreview, SavedAnalysis, Script, Seat } from "../types";

interface CodexPanelProps {
  script: Script;
  selectedSeat: Pick<Seat, "position" | "player_name"> | null;
  playerMode: boolean;
  question: string;
  onQuestionChange: (question: string) => void;
  preview: ReasonPreview | null;
  previewError: string | null;
  onRefreshPreview: () => void;
  status: HarnessStatus | null;
  answer: string;
  busy: boolean;
  disabled: boolean;
  analyses: SavedAnalysis[];
  currentEventId: string | null;
  onViewSnapshot: (analysis: SavedAnalysis) => void;
  error: string | null;
  onAsk: () => Promise<void>;
  onOpenNight?: () => void;
}
const quickQuestions = [
  ["检查配比", "检查当前角色配比、已分配角色与角色配置修正，列出需要说书人确认的问题。"],
  ["检查冲突", "检查当前局面的角色、状态与座位是否存在规则冲突或容易遗漏的互动。"],
] as const;
const playerQuestions = [
  ["整理线索", "根据我收到的信息和公开声明，整理已知线索与仍不确定的地方。"],
  ["分析声明", "比较公开声明与我收到的信息，列出可能的解释，不要把声明当作真实身份。"],
  ["下一步", "仅根据我的视角，建议下一步应询问谁、确认什么，以及可考虑的行动。"],
] as const;

export function CodexPanel({
  script,
  selectedSeat,
  playerMode,
  question,
  onQuestionChange,
  preview,
  previewError,
  onRefreshPreview,
  status,
  answer,
  busy,
  disabled,
  analyses,
  currentEventId,
  onViewSnapshot,
  error,
  onAsk,
  onOpenNight,
}: CodexPanelProps) {
  const submit = async () => {
    const value = question.trim();
    if (!value || !preview || busy || disabled || !status?.available) return;
    await onAsk();
  };

  return (
    <section className="codex-section">
      <div className="codex-heading">
        <div className="codex-icon">
          <Sparkles size={16} />
        </div>
        <div>
          <span className="eyebrow">LOCAL CODEX HARNESS</span>
          <h2>{playerMode ? "玩家代理" : "说书人辅助"}</h2>
        </div>
        <span className={`status-dot ${status?.available ? "online" : "offline"}`}>
          {status?.available ? "只读可用" : "不可用"}
        </span>
      </div>

      <div className="context-line">
        <ShieldCheck size={12} />
        <span>{script.name.zh_hans}</span>
        <i>·</i>
        <span>{selectedSeat ? `${selectedSeat.position} 号 ${selectedSeat.player_name}` : "未选玩家"}</span>
      </div>

      <div className="quick-prompts">
        {!playerMode && onOpenNight && <button type="button" onClick={onOpenNight}>今晚清单</button>}
        {(playerMode ? playerQuestions : quickQuestions).map(([label, prompt]) => (
          <button
            type="button"
            key={label}
            disabled={busy || disabled}
            onClick={() => onQuestionChange(prompt)}
          >
            {label}
          </button>
        ))}
      </div>

      <label className="codex-input">
        <textarea
          value={question}
          onChange={(event) => onQuestionChange(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void submit();
          }}
          maxLength={4000}
          rows={3}
          aria-label={playerMode ? "玩家问题" : "说书人问题"}
          placeholder={playerMode ? "根据我已知的信息，询问线索、声明或下一步行动…" : "询问配比、角色互动、夜间结算或局面矛盾…"}
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!question.trim() || !preview || busy || disabled || !status?.available}
        >
          {busy ? <LoaderCircle size={15} className="spin" /> : <Send size={15} />}
          {busy ? "推理中" : "触发本地 Codex"}
        </button>
      </label>

      <details className="input-preview" open={playerMode}>
        <summary>代理输入预览 · 完整提示词</summary>
        <p>以下包含固定参考资料、可见局面与问题，将原样作为本次 Codex 调用的输入。</p>
        {preview ? <pre aria-label="完整代理输入">{preview.prompt}</pre> : (
          <p role="status">{previewError ?? "正在生成输入预览…"}</p>
        )}
        <button type="button" onClick={onRefreshPreview} disabled={busy || disabled}>刷新预览</button>
      </details>

      {!status?.available && (
        <div className="harness-message muted">
          <AlertCircle size={13} /> {status?.detail ?? "正在检测本地 Codex CLI…"}
        </div>
      )}
      {error && (
        <div className="harness-message error">
          <AlertCircle size={13} /> {error}
        </div>
      )}
      {(answer || busy) && (
        <article className="codex-answer" aria-live="polite">
          <header>
            <Sparkles size={13} /> Codex 分析
          </header>
          {busy && !answer ? (
            <div className="answer-loading">
              <span />
              <span />
              <span />
            </div>
          ) : (
            <pre>{answer}</pre>
          )}
        </article>
      )}

      {!playerMode && <div className="saved-analyses">
        <h3>已保存分析 <span>{analyses.length}</span></h3>
        {!analyses.length && <p>分析完成后自动附在原始局面快照上。</p>}
        {[...analyses].reverse().map((analysis) => {
          const seat = analysis.snapshot.seats.find((item) => item.id === analysis.selected_seat_id);
          return <details key={analysis.id} className="saved-analysis">
            <summary>{analysis.question}</summary>
            <div className="analysis-meta">
              <time dateTime={analysis.created_at}>{new Date(analysis.created_at).toLocaleString("zh-CN")}</time>
              <span>{analysis.snapshot.name} · {phaseLabel(analysis.snapshot)} · {analysis.perspective === "player" ? "玩家分析" : "说书人分析"}</span>
              <span>{seat ? `${seat.position} 号 ${seat.player_name}` : "未选玩家"} · {(analysis.duration_ms / 1000).toFixed(1)} 秒</span>
              {analysis.model && <span>{analysis.model}</span>}
              <span>{currentEventId === analysis.event_id ? "当前显示的快照" : "来自历史快照"} · AI 分析，非官方裁定</span>
            </div>
            <button type="button" disabled={disabled} onClick={() => onViewSnapshot(analysis)}>查看原始局面</button>
            <pre>{analysis.answer}</pre>
          </details>;
        })}
      </div>}

      <div className="source-links">
        <a href={`/api/scripts/${script.id}/qa`} target="_blank" rel="noreferrer">
          <BookMarked size={12} /> 本地问答整理
        </a>
        <a href={script.sources.edition} target="_blank" rel="noreferrer">
          官方剧本页 ↗
        </a>
      </div>
    </section>
  );
}
