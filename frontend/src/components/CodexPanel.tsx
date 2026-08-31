import {
  AlertCircle,
  BookMarked,
  LoaderCircle,
  Send,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useState } from "react";
import type { HarnessStatus, Script, Seat } from "../types";

interface CodexPanelProps {
  script: Script;
  selectedSeat: Seat | null;
  status: HarnessStatus | null;
  answer: string;
  busy: boolean;
  error: string | null;
  onAsk: (question: string) => Promise<void>;
}
const quickQuestions = [
  ["检查配比", "检查当前角色配比、已分配角色与角色配置修正，列出需要说书人确认的问题。"],
  ["检查冲突", "检查当前局面的角色、状态与座位是否存在规则冲突或容易遗漏的互动。"],
  ["今晚顺序", "根据当前阶段、真实角色与状态，给出今晚需要关注的行动顺序和说书人提醒。"],
] as const;

export function CodexPanel({
  script,
  selectedSeat,
  status,
  answer,
  busy,
  error,
  onAsk,
}: CodexPanelProps) {
  const [question, setQuestion] = useState("");

  const submit = async () => {
    const value = question.trim();
    if (!value || busy || !status?.available) return;
    await onAsk(value);
  };

  return (
    <section className="codex-section">
      <div className="codex-heading">
        <div className="codex-icon">
          <Sparkles size={16} />
        </div>
        <div>
          <span className="eyebrow">LOCAL CODEX HARNESS</span>
          <h2>说书人辅助</h2>
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
        {quickQuestions.map(([label, prompt]) => (
          <button
            type="button"
            key={label}
            disabled={busy || !status?.available}
            onClick={() => {
              setQuestion(prompt);
              void onAsk(prompt);
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <label className="codex-input">
        <textarea
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") void submit();
          }}
          maxLength={4000}
          rows={3}
          placeholder="询问配比、角色互动、夜间结算或局面矛盾…"
        />
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!question.trim() || busy || !status?.available}
        >
          {busy ? <LoaderCircle size={15} className="spin" /> : <Send size={15} />}
          {busy ? "推理中" : "触发本地 Codex"}
        </button>
      </label>

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
