import { BookOpenText, ShieldCheck, Skull, UserRound } from "lucide-react";
import { allRoles } from "../game";
import { phaseLabel } from "../timeline";
import type { PlayerView as PlayerViewData, Script } from "../types";

interface PlayerViewProps {
  view: PlayerViewData;
  script: Script;
}

/** This component accepts only the backend projection, never a storyteller snapshot. */
export function PlayerView({ view, script }: PlayerViewProps) {
  const role = allRoles(script).find((item) => item.id === view.you.shown_role_id);
  const viewer = view.seats.find((seat) => seat.id === view.you.seat_id);
  const alignment = { good: "善良", evil: "邪恶", unknown: "未告知 / 未记录" };
  return (
    <main className="player-view panel-shell">
      <header className="player-view-heading">
        <div>
          <span className="eyebrow">PLAYER PERSPECTIVE</span>
          <h1>{viewer?.position} 号 · {viewer?.player_name}</h1>
          <p>{script.name.zh_hans} · {script.name.en} · {phaseLabel(view)}</p>
        </div>
        <ShieldCheck size={24} />
      </header>
      <div className="player-knowledge-grid">
        <section className="player-information">
          <h2>你的身份信息</h2>
          <p>展示角色：<strong>{role ? `${role.name.zh_hans} · ${role.name.en}` : "未告知 / 未记录"}</strong></p>
          <p>告知阵营：{alignment[view.you.shown_alignment]}</p>
          {role && (
            <article className={`ability-card ${role.team}`}>
              <div><BookOpenText size={14} /><strong>{role.name.zh_hans}</strong></div>
              <p>{role.ability.zh_hans}</p>
              <p lang="en">{role.ability.en}</p>
            </article>
          )}
        </section>
        <section className="player-information">
          <h2>你收到的私人信息</h2>
          <p className="recorded-information">{view.you.private_information || "尚未记录"}</p>
        </section>
      </div>
      <section className="player-information">
        <h2>公开信息</h2>
        <p className="recorded-information">{view.public_information || "尚未记录"}</p>
      </section>
      <section className="public-players">
        <h2>玩家与公开声明</h2>
        <p className="field-hint">公开声明是玩家的说法，可能包含伪装或错误信息。</p>
        <div className="public-seat-grid">
          {view.seats.map((seat) => (
            <article key={seat.id} className={`public-seat ${seat.id === view.you.seat_id ? "is-you" : ""}`}>
              <header>
                <b>{seat.position} 号 · {seat.player_name}{seat.id === view.you.seat_id ? "（你）" : ""}</b>
                <span>{seat.alive ? <UserRound size={13} /> : <Skull size={13} />}{seat.alive ? "存活" : "死亡"}</span>
              </header>
              <p className="recorded-information">{seat.public_claim || "尚未公开声明"}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
